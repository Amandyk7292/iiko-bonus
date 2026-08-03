const {
  makeWASocket,
  DisconnectReason,
  initAuthCreds,
  BufferJSON,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const qrImage = require('qrcode');
const { supabase } = require('../config/supabase');
const crypto = require('crypto');
const { isDirectWhatsAppChat, resolveWhatsAppSenderDigits } = require('../utils/whatsapp.util');
const { consumeCourierBotRequest } = require('./courier.service');
const { consumeAdminBotRequest } = require('./admin-phone-auth.service');
const {
  clearConversation,
  customerErrorMessage,
  replyToCustomer,
} = require('./gemini-assistant.service');
const { warmBulkaKnowledge } = require('./bulka-assistant-knowledge.service');
const {
  getAssistantProviderConfiguration,
  getAssistantRuntime,
  recordConversationMessage,
  resetConversationContext,
} = require('./whatsapp-assistant-console.service');
const { normalizeVoiceNoteDuration, transcodeVoiceNote } = require('./voice-note.service');
const {
  deliverWhatsAppOutbox,
  enqueueWhatsAppText,
  enqueueWhatsAppVoice,
  whatsappOutboxDedupeKey,
} = require('./whatsapp-outbox.service');
const realtime = require('./realtime.service');

const WHATSAPP_AUTH_KEY_TYPES = Object.freeze([
  'pre-key',
  'session',
  'sender-key',
  'sender-key-memory',
  'app-state-sync-key',
  'app-state-sync-version',
  'lid-mapping',
  'device-list',
  'tctoken',
  'identity-key',
]);
const WHATSAPP_AUTH_DELETE_FILTER = [
  'id.eq.creds',
  ...WHATSAPP_AUTH_KEY_TYPES.map((type) => `id.like.${type}-*`),
].join(',');

/**
 * Адаптер для сохранения сессии Baileys в Supabase
 */
async function useSupabaseAuthState() {
  const writeData = async (data, id) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await supabase
      .from('whatsapp_sessions')
      .upsert({ id, data: JSON.parse(json) }, { onConflict: 'id' });
  };

  const readData = async (id) => {
    const { data, error } = await supabase
      .from('whatsapp_sessions')
      .select('data')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (data && data.data) {
      return JSON.parse(JSON.stringify(data.data), BufferJSON.reviver);
    }
    return null;
  };

  const removeData = async (id) => {
    await supabase.from('whatsapp_sessions').delete().eq('id', id);
  };

  let creds = await readData('creds');
  if (!creds) {
    creds = initAuthCreds();
    await writeData(creds, 'creds');
  }

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData(`${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value =
                  require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(
                    value,
                  );
              }
              data[id] = value;
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks = [];
          for (const category in data) {
            for (const id in data[category]) {
              const value = data[category][id];
              const key = `${category}-${id}`;
              if (value) {
                tasks.push(writeData(value, key));
              } else {
                tasks.push(removeData(key));
              }
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: () => {
      return writeData(creds, 'creds');
    },
  };
}

function isWhatsAppAuthStorageId(value) {
  const id = String(value || '');
  return id === 'creds' || WHATSAPP_AUTH_KEY_TYPES.some((type) => id.startsWith(`${type}-`));
}

async function resetSupabaseWhatsAppAuth(client = supabase) {
  const { error, count } = await client
    .from('whatsapp_sessions')
    .delete({ count: 'exact' })
    .or(WHATSAPP_AUTH_DELETE_FILTER);
  if (error) {
    throw Object.assign(new Error('Не удалось подготовить новую привязку WhatsApp'), {
      code: 'WHATSAPP_AUTH_RESET_FAILED',
      cause: error,
    });
  }
  return Number(count) || 0;
}

let sock = null;
let reconnectTimer = null;
let loggedOutRecovery = null;
let whatsappGeneration = 0;
let runtimeWhatsAppDependencies = null;
let assistantConfigurationLogged = false;
let outboxFlushPromise = null;
const whatsappConnection = {
  state: 'starting',
  connectedAt: null,
  updatedAt: new Date().toISOString(),
  phone: '',
  qrDataUrl: '',
  qrReceivedAt: null,
  lastError: '',
};

function updateWhatsAppConnection(patch) {
  Object.assign(whatsappConnection, patch, { updatedAt: new Date().toISOString() });
  realtime.publish(
    'whatsapp.connection.updated',
    {
      state: whatsappConnection.state,
      connected: whatsappConnection.state === 'connected',
      updatedAt: whatsappConnection.updatedAt,
      lastError: whatsappConnection.lastError || '',
    },
    { adminOnly: true },
  );
}

function maskWhatsAppPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  return digits.length > 4 ? `+${digits.slice(0, 2)} ••• ••• ${digits.slice(-4)}` : `••${digits}`;
}

function getWhatsAppStatus(settings = null) {
  const provider = settings?.provider || 'gemini';
  return {
    state: whatsappConnection.state,
    connected: whatsappConnection.state === 'connected',
    connectedAt: whatsappConnection.connectedAt,
    updatedAt: whatsappConnection.updatedAt,
    phone: maskWhatsAppPhone(whatsappConnection.phone),
    qrDataUrl: whatsappConnection.qrDataUrl,
    qrReceivedAt: whatsappConnection.qrReceivedAt,
    lastError: whatsappConnection.lastError,
    assistant: {
      environmentEnabled: process.env.GEMINI_ASSISTANT_ENABLED === 'true',
      provider,
      keyConfigured:
        settings?.keyConfigured ?? Boolean(String(process.env.GEMINI_API_KEY || '').trim()),
      model: settings?.model || String(process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite'),
    },
  };
}

const whatsappUnavailableError = () =>
  Object.assign(new Error('WhatsApp сейчас не подключён'), {
    statusCode: 503,
    code: 'WHATSAPP_NOT_CONNECTED',
  });

function getWhatsAppDisconnectStatusCode(lastDisconnect) {
  const error = lastDisconnect?.error;
  const candidates = [
    lastDisconnect?.statusCode,
    error?.output?.statusCode,
    error?.output?.payload?.statusCode,
    error?.statusCode,
    error?.data?.statusCode,
    error?.cause?.output?.statusCode,
    error?.cause?.output?.payload?.statusCode,
    error?.cause?.statusCode,
    error?.cause?.data?.statusCode,
  ];
  for (const candidate of candidates) {
    const statusCode = Number(candidate);
    if (Number.isInteger(statusCode) && statusCode > 0) return statusCode;
  }

  const message = String(error?.message || error?.cause?.message || '');
  if (/\blogged[\s_-]*out\b|device (?:was )?removed/i.test(message)) {
    return DisconnectReason.loggedOut;
  }
  if (/\bbad[\s_-]*session\b/i.test(message)) return DisconnectReason.badSession;
  if (/multi[\s_-]*device mismatch/i.test(message)) {
    return DisconnectReason.multideviceMismatch;
  }
  if (/\bforbidden\b/i.test(message)) return DisconnectReason.forbidden;
  if (/connection replaced/i.test(message)) return DisconnectReason.connectionReplaced;
  return null;
}

function getWhatsAppDisconnectAction(lastDisconnect) {
  const statusCode = getWhatsAppDisconnectStatusCode(lastDisconnect);
  if (
    [
      DisconnectReason.loggedOut,
      DisconnectReason.badSession,
      DisconnectReason.multideviceMismatch,
      DisconnectReason.forbidden,
    ].includes(statusCode)
  ) {
    return { action: 'reset_auth', statusCode };
  }
  if (statusCode === DisconnectReason.connectionReplaced) {
    return { action: 'stop', statusCode };
  }
  return { action: 'reconnect', statusCode };
}

function cancelWhatsAppReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = null;
}

function detachWhatsAppSocket(currentSocket) {
  if (!currentSocket) return;
  currentSocket.ev?.removeAllListeners?.('creds.update');
  currentSocket.ev?.removeAllListeners?.('connection.update');
  currentSocket.ev?.removeAllListeners?.('messages.upsert');
  if (sock === currentSocket) sock = null;
  try {
    currentSocket.end?.(new Error('WhatsApp pairing reset'));
  } catch (_error) {
    // Socket may already be closed. Auth cleanup below remains authoritative.
  }
}

async function sendClaimedOutboxMessage(message) {
  if (!sock || whatsappConnection.state !== 'connected') throw whatsappUnavailableError();
  const options = { messageId: message.providerDedupeId };
  if (message.messageType === 'voice') {
    return sock.sendMessage(
      message.chatJid,
      {
        audio: message.audio,
        mimetype: 'audio/ogg; codecs=opus',
        ptt: true,
        seconds: message.durationSeconds,
      },
      options,
    );
  }
  return sock.sendMessage(message.chatJid, { text: message.text }, options);
}

function flushWhatsAppOutbox({ messageId = null, limit = 25 } = {}) {
  if (!sock || whatsappConnection.state !== 'connected') return Promise.resolve([]);
  if (outboxFlushPromise && !messageId) return outboxFlushPromise;
  const operation = deliverWhatsAppOutbox({
    sendMessage: sendClaimedOutboxMessage,
    messageId,
    limit,
  });
  if (messageId) return operation;
  outboxFlushPromise = operation.finally(() => {
    outboxFlushPromise = null;
  });
  return outboxFlushPromise;
}

async function queueWhatsAppText(
  remoteJid,
  text,
  { dedupeKey, sourceType = 'system', metadata = {} } = {},
) {
  const queued = await enqueueWhatsAppText({
    chatJid: remoteJid,
    text,
    dedupeKey,
    sourceType,
    metadata,
  });
  if (queued.status === 'sent') {
    return {
      key: { id: queued.providerMessageId },
      outboxId: queued.id,
      deliveryStatus: 'sent',
      queued: false,
    };
  }
  const [delivery] = await flushWhatsAppOutbox({ messageId: queued.id, limit: 1 });
  const sent = delivery?.status === 'sent';
  const failed = delivery?.status === 'failed' || queued.status === 'failed';
  return {
    key: { id: sent ? delivery.providerMessageId : null },
    outboxId: queued.id,
    deliveryStatus: sent ? 'sent' : failed ? 'failed' : 'pending',
    queued: !sent,
  };
}

async function logAssistantConfiguration() {
  if (assistantConfigurationLogged) return null;
  assistantConfigurationLogged = true;
  try {
    const config = await getAssistantProviderConfiguration();
    if (config.enabled && config.apiKey) {
      console.log(`[AI] Консультант Bulka включён: ${config.provider}/${config.model}.`);
      return config;
    }
    console.warn('[AI] Консультант выключен или API-ключ не задан.');
  } catch (error) {
    console.warn(
      '[AI] Не удалось загрузить конфигурацию консультанта:',
      error.code || error.message,
    );
  }
  return null;
}

function recoverLoggedOutWhatsApp(
  currentSocket = sock,
  otpStore = runtimeWhatsAppDependencies?.otpStore,
  getOrCreateCustomerByPhone = runtimeWhatsAppDependencies?.getOrCreateCustomerByPhone,
) {
  if (loggedOutRecovery) return loggedOutRecovery;
  loggedOutRecovery = (async () => {
    if (!otpStore || typeof getOrCreateCustomerByPhone !== 'function') {
      throw Object.assign(new Error('Сервис WhatsApp ещё не запущен'), {
        statusCode: 503,
        code: 'WHATSAPP_NOT_INITIALIZED',
      });
    }
    cancelWhatsAppReconnect();
    whatsappGeneration += 1;
    updateWhatsAppConnection({
      state: 'connecting',
      connectedAt: null,
      phone: '',
      qrDataUrl: '',
      qrReceivedAt: null,
      lastError: '',
    });
    try {
      detachWhatsAppSocket(currentSocket);
      const removedCount = await resetSupabaseWhatsAppAuth();
      console.log(
        `[WHATSAPP] Отозванная привязка очищена (${removedCount} ключей). Создаётся новый QR-код.`,
      );
      await initWhatsApp(otpStore, getOrCreateCustomerByPhone);
    } catch (error) {
      updateWhatsAppConnection({
        state: 'error',
        qrDataUrl: '',
        qrReceivedAt: null,
        lastError: 'Не удалось создать новый QR-код',
      });
      console.error('[WHATSAPP] Не удалось автоматически создать новый QR-код:', {
        code: error.code || 'WHATSAPP_QR_RECOVERY_FAILED',
        message: error.message,
      });
    }
  })().finally(() => {
    loggedOutRecovery = null;
  });
  return loggedOutRecovery;
}

async function resetWhatsAppPairing() {
  await recoverLoggedOutWhatsApp();
  const status = getWhatsAppStatus();
  if (status.state === 'error') {
    throw Object.assign(new Error(status.lastError || 'Не удалось создать новый QR-код'), {
      statusCode: 503,
      code: 'WHATSAPP_PAIRING_RESET_FAILED',
    });
  }
  return status;
}

async function initWhatsApp(otpStore, getOrCreateCustomerByPhone) {
  runtimeWhatsAppDependencies = { otpStore, getOrCreateCustomerByPhone };
  const generation = ++whatsappGeneration;
  try {
    updateWhatsAppConnection({ state: 'connecting', lastError: '' });
    const assistantConfig = await logAssistantConfiguration();
    if (assistantConfig) warmBulkaKnowledge();
    const { state, saveCreds } = await useSupabaseAuthState();
    if (generation !== whatsappGeneration) return null;

    const currentSocket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });
    if (generation !== whatsappGeneration) {
      detachWhatsAppSocket(currentSocket);
      return null;
    }
    sock = currentSocket;

    currentSocket.ev.on('creds.update', () => {
      if (sock !== currentSocket) return undefined;
      return saveCreds();
    });

    currentSocket.ev.on('connection.update', async (update) => {
      if (sock !== currentSocket) return;
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        const qrReceivedAt = new Date().toISOString();
        updateWhatsAppConnection({
          state: 'awaiting_scan',
          qrDataUrl: '',
          qrReceivedAt,
          lastError: '',
        });
        try {
          const qrDataUrl = await qrImage.toDataURL(qr, {
            margin: 1,
            width: 320,
            errorCorrectionLevel: 'M',
          });
          if (whatsappConnection.qrReceivedAt === qrReceivedAt) {
            updateWhatsAppConnection({ qrDataUrl });
            console.log('[WHATSAPP] Новый QR-код доступен владельцу в админ-панели.');
          }
        } catch (error) {
          console.warn('[WHATSAPP] Не удалось подготовить QR для админ-панели:', error.message);
        }
        if (process.env.ALLOW_WHATSAPP_QR_IN_LOGS === 'true') {
          console.warn('[WHATSAPP] QR-код будет показан в логах по явному разрешению оператора.');
          qrcode.generate(qr, { small: true });
        } else {
          console.warn(
            '[WHATSAPP] Требуется сопряжение. Временно задайте ALLOW_WHATSAPP_QR_IN_LOGS=true в защищённой среде.',
          );
        }
      }

      if (connection === 'close') {
        const { action, statusCode } = getWhatsAppDisconnectAction(lastDisconnect);
        const shouldReconnect = action === 'reconnect';
        const shouldResetAuth = action === 'reset_auth';
        updateWhatsAppConnection({
          state: shouldReconnect ? 'reconnecting' : shouldResetAuth ? 'logged_out' : 'error',
          connectedAt: shouldReconnect ? whatsappConnection.connectedAt : null,
          phone: shouldReconnect ? whatsappConnection.phone : '',
          qrDataUrl: '',
          qrReceivedAt: null,
          lastError: shouldReconnect
            ? 'Соединение потеряно, выполняется переподключение'
            : shouldResetAuth
              ? ''
              : 'Сессия WhatsApp уже используется другим процессом',
        });
        console.log('[WHATSAPP] Соединение закрыто.', {
          action,
          reason: statusCode == null ? 'unknown' : DisconnectReason[statusCode] || statusCode,
        });
        if (shouldReconnect && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            initWhatsApp(otpStore, getOrCreateCustomerByPhone);
          }, 5000);
          reconnectTimer.unref?.();
        } else if (shouldResetAuth) {
          console.log('[WHATSAPP] Привязка отозвана. Автоматически готовится новый QR-код.');
          void recoverLoggedOutWhatsApp(currentSocket, otpStore, getOrCreateCustomerByPhone);
        }
      } else if (connection === 'open') {
        cancelWhatsAppReconnect();
        updateWhatsAppConnection({
          state: 'connected',
          connectedAt: new Date().toISOString(),
          phone: currentSocket.user?.id || '',
          qrDataUrl: '',
          qrReceivedAt: null,
          lastError: '',
        });
        console.log('[WHATSAPP] Успешно подключено к WhatsApp!');
        void flushWhatsAppOutbox().catch((error) => {
          console.error('[WHATSAPP OUTBOX] Не удалось обработать очередь после подключения:', {
            code: error?.code || 'OUTBOX_FLUSH_FAILED',
          });
        });
      }
    });

    currentSocket.ev.on('messages.upsert', async (m) => {
      if (sock !== currentSocket) return;
      if (m.type !== 'notify') return;
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;
      const inboundMessageId = String(msg.key.id || crypto.randomUUID());
      const sendReplyText = (text, sourceType = 'bot') =>
        queueWhatsAppText(remoteJid, text, {
          dedupeKey: whatsappOutboxDedupeKey(
            `inbound-${sourceType}`,
            remoteJid,
            inboundMessageId,
            text,
          ),
          sourceType,
          metadata: { inboundMessageId },
        });

      // Надежное извлечение текста (в т.ч. исчезающие сообщения)
      let textMessage = '';
      const messageContent = msg.message;
      if (messageContent) {
        textMessage =
          messageContent.conversation ||
          messageContent.extendedTextMessage?.text ||
          messageContent.imageMessage?.caption ||
          messageContent.videoMessage?.caption ||
          '';

        if (!textMessage && messageContent.ephemeralMessage?.message) {
          const em = messageContent.ephemeralMessage.message;
          textMessage =
            em.conversation || em.extendedTextMessage?.text || em.imageMessage?.caption || '';
        }

        if (!textMessage && messageContent.viewOnceMessage?.message) {
          const vom = messageContent.viewOnceMessage.message;
          textMessage =
            vom.conversation || vom.extendedTextMessage?.text || vom.imageMessage?.caption || '';
        }

        if (!textMessage && messageContent.viewOnceMessageV2?.message) {
          const vom2 = messageContent.viewOnceMessageV2.message;
          textMessage =
            vom2.conversation || vom2.extendedTextMessage?.text || vom2.imageMessage?.caption || '';
        }
      }

      console.log('[WHATSAPP] Получено входящее сообщение.');

      if (!textMessage) return;

      // Обработка команд для задач
      if (textMessage.toLowerCase().startsWith('/задача ')) {
        const taskText = textMessage.substring(8).trim();
        if (taskText) {
          const taskId = Date.now().toString();
          const sessionId = `task_${remoteJid}_${taskId}`;
          try {
            await supabase.from('whatsapp_sessions').upsert({
              id: sessionId,
              data: JSON.stringify({
                text: taskText,
                sender: msg.key.participant || remoteJid,
                createdAt: Date.now(),
                status: 'pending',
              }),
            });
            await sendReplyText('Задача сохранена.', 'task');
          } catch (e) {
            console.error('[WHATSAPP] Ошибка сохранения задачи:', e);
            await sendReplyText('Ошибка при сохранении задачи.', 'task');
          }
        }
        return;
      }

      if (
        textMessage.toLowerCase() === '/задачи' ||
        textMessage.toLowerCase().startsWith('/задачи ')
      ) {
        try {
          // Ищем все ключи, начинающиеся с task_chatId
          const { data, error } = await supabase
            .from('whatsapp_sessions')
            .select('id, data')
            .like('id', `task_${remoteJid}_%`)
            .order('id', { ascending: true });

          if (error) throw error;

          if (!data || data.length === 0) {
            await sendReplyText('В этой группе нет активных задач.', 'task');
            return;
          }

          let reply = `*Список задач:*\n\n`;
          data.forEach((row, index) => {
            try {
              const task = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
              reply += `${index + 1}. ${task.text}\n`;
            } catch (_error) {
              // Skip malformed task rows.
            }
          });

          await sendReplyText(reply, 'task');
        } catch (e) {
          console.error('[WHATSAPP] Ошибка получения задач:', e);
          await sendReplyText('Ошибка при получении списка задач.', 'task');
        }
        return;
      }

      if (textMessage.toLowerCase().startsWith('/готово ')) {
        const taskNumStr = textMessage.substring(8).trim();
        const taskNum = parseInt(taskNumStr, 10);

        if (!isNaN(taskNum) && taskNum > 0) {
          try {
            // Fetch tasks in the exact same order as /задачи
            const { data, error } = await supabase
              .from('whatsapp_sessions')
              .select('id, data')
              .like('id', `task_${remoteJid}_%`)
              .order('id', { ascending: true });

            if (error) throw error;

            if (!data || data.length === 0 || taskNum > data.length) {
              await sendReplyText(`Задача под номером ${taskNum} не найдена.`, 'task');
              return;
            }

            // Get the specific task to delete
            const taskToDelete = data[taskNum - 1];
            let taskDesc = 'Задача';
            try {
              const taskData =
                typeof taskToDelete.data === 'string'
                  ? JSON.parse(taskToDelete.data)
                  : taskToDelete.data;
              taskDesc = `"${taskData.text}"`;
            } catch (_error) {
              // Keep the generic task label for malformed rows.
            }

            // Delete from database
            await supabase.from('whatsapp_sessions').delete().eq('id', taskToDelete.id);

            await sendReplyText(`${taskDesc} выполнена и удалена из списка.`, 'task');
          } catch (e) {
            console.error('[WHATSAPP] Ошибка при удалении задачи:', e);
            await sendReplyText('Ошибка при удалении задачи.', 'task');
          }
        }
        return;
      }

      if (textMessage.toLowerCase().startsWith('код')) {
        const parts = textMessage.trim().split(/\s+/);

        // If no token provided — tell the user they need it
        if (parts.length < 2 || parts[1].length < 8) {
          await sendReplyText(
            'Для получения кода нужен идентификатор из формы Bulka.\n\nВернитесь к форме, нажмите «Продолжить через WhatsApp» и отправьте подготовленное сообщение.',
            'authentication',
          );
          return;
        }

        const token = parts[1];
        const senderDigits = await resolveWhatsAppSenderDigits(
          msg.key,
          sock.signalRepository?.lidMapping,
        );

        try {
          const courierRequest = await consumeCourierBotRequest(token, senderDigits);
          if (courierRequest.status !== 'not_courier') {
            const courierReplies = {
              expired:
                'Идентификатор курьера недействителен или истёк.\n\nВернитесь на страницу входа и запросите новый.',
              phone_mismatch:
                'Номер WhatsApp не совпадает с номером курьера, указанным на странице входа.',
              unavailable: 'Учётная запись курьера недоступна. Обратитесь к управляющему.',
            };
            if (courierRequest.status === 'success') {
              await sendReplyText(
                `*Bulka · вход курьера*\n\nКод: *${courierRequest.code}*\n\n_Код действует 5 минут. Никому его не сообщайте._`,
                'authentication',
              );
              console.log('[WHATSAPP] Код входа курьера выдан по входящему запросу');
            } else {
              await sendReplyText(
                courierReplies[courierRequest.status] || 'Не удалось подтвердить вход курьера.',
                'authentication',
              );
            }
            return;
          }
        } catch (error) {
          console.error('[WHATSAPP] Ошибка входа курьера:', error.message);
          await sendReplyText(
            'Не удалось выдать код курьера. Вернитесь на страницу входа и попробуйте снова.',
            'authentication',
          );
          return;
        }

        try {
          const adminRequest = await consumeAdminBotRequest(token, senderDigits);
          if (adminRequest.status !== 'not_admin') {
            const adminReplies = {
              expired:
                'Идентификатор входа недействителен или истёк. Вернитесь в админ-панель и запросите новый.',
              phone_mismatch:
                'Номер WhatsApp не совпадает с номером сотрудника, указанным на странице входа.',
              unavailable: 'Учётная запись сотрудника отключена. Обратитесь к владельцу.',
            };
            if (adminRequest.status === 'success') {
              await sendReplyText(
                `*Bulka · вход сотрудника*\n\nКод: *${adminRequest.code}*\n\n_Код действует 5 минут. Никому его не сообщайте._`,
                'authentication',
              );
              console.log('[WHATSAPP] Код входа сотрудника выдан по входящему запросу');
            } else {
              await sendReplyText(
                adminReplies[adminRequest.status] || 'Не удалось подтвердить вход сотрудника.',
                'authentication',
              );
            }
            return;
          }
        } catch (error) {
          console.error('[WHATSAPP] Ошибка входа сотрудника:', error.message);
          await sendReplyText(
            'Не удалось выдать код сотрудника. Вернитесь в админ-панель и попробуйте снова.',
            'authentication',
          );
          return;
        }

        // Look up the token to find the phone number
        let phone = null;
        let customerAuthRequest = null;
        try {
          const { data } = await supabase
            .from('whatsapp_sessions')
            .select('data')
            .eq('id', `token_${token}`)
            .maybeSingle();
          if (data && data.data) {
            const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
            if (parsed.phone && parsed.expires > Date.now()) {
              const requestedDigits = String(parsed.phone).replace(/[^0-9]/g, '');
              if (!senderDigits || senderDigits.slice(-10) !== requestedDigits.slice(-10)) {
                await sendReplyText(
                  'Номер WhatsApp не совпадает с номером, указанным в форме.',
                  'authentication',
                );
                return;
              }
              phone = parsed.phone;
              customerAuthRequest = parsed;

              // Delete used token so it can't be reused
              await supabase.from('whatsapp_sessions').delete().eq('id', `token_${token}`);
            }
          }
        } catch (e) {
          console.error('[WHATSAPP] Error resolving token:', e.message);
        }

        if (!phone) {
          await sendReplyText(
            'Идентификатор недействителен или истёк.\n\nВернитесь к форме Bulka и запросите код заново.',
            'authentication',
          );
          return;
        }

        try {
          // Generate OTP code (4 digits)
          let code;
          const purpose = String(customerAuthRequest?.purpose || 'customer_legacy_login');
          const flowId = String(customerAuthRequest?.flowId || token);
          const existing = await otpStore.get(phone);
          if (
            existing &&
            existing.expires > Date.now() &&
            existing.purpose === purpose &&
            existing.flowId === flowId
          ) {
            code = existing.code;
          } else {
            code = crypto.randomInt(1000, 10000).toString();
            await otpStore.set(phone, {
              code,
              attempts: 0,
              expires: Date.now() + 5 * 60 * 1000,
              purpose,
              flowId,
              ...(customerAuthRequest?.passwordHash
                ? { passwordHash: customerAuthRequest.passwordHash }
                : {}),
            });
          }

          const action =
            purpose === 'customer_registration'
              ? 'регистрации'
              : purpose === 'customer_password_reset'
                ? 'восстановления пароля'
                : 'входа';
          const replyText = `*Код Bulka для ${action}:*\n\n*${code}*\n\n_Код действует 5 минут. Никому его не сообщайте._`;
          await sendReplyText(replyText, 'authentication');
          console.log('[WHATSAPP] Код подтверждения отправлен');
        } catch (err) {
          console.error('[WHATSAPP] Ошибка обработки запроса кода:', err);
          await sendReplyText('Произошла ошибка. Попробуйте позже.', 'authentication');
        }
        return;
      }

      if (!isDirectWhatsAppChat(remoteJid)) return;

      if (['/сброс', '/reset', 'новый диалог'].includes(textMessage.trim().toLowerCase())) {
        clearConversation(remoteJid);
        await resetConversationContext(remoteJid, { bestEffort: true }).catch((error) => {
          console.warn('[WHATSAPP] Не удалось сбросить сохранённый контекст:', error.message);
        });
        await sendReplyText(
          'Диалог очищен. Чем помочь по меню, филиалам, доставке или бонусам Bulka?',
          'assistant',
        );
        return;
      }

      const senderDigits = await resolveWhatsAppSenderDigits(
        msg.key,
        sock.signalRepository?.lidMapping,
      ).catch(() => '');
      const conversationIdentity = {
        chatJid: remoteJid,
        phone: senderDigits ? `+${senderDigits}` : '',
        displayName: msg.pushName || '',
      };
      await recordConversationMessage(
        {
          ...conversationIdentity,
          whatsappMessageId: msg.key.id || null,
          direction: 'inbound',
          senderType: 'customer',
          content: textMessage,
          deliveryStatus: 'received',
        },
        { bestEffort: true },
      ).catch((error) => {
        console.warn('[WHATSAPP] Не удалось сохранить входящее сообщение:', error.message);
      });

      let assistantRuntime = {
        shouldReply: true,
        settings: { fallbackMessage: '' },
      };
      try {
        assistantRuntime = await getAssistantRuntime(remoteJid);
      } catch (error) {
        console.warn('[WHATSAPP] Настройки автоответа временно недоступны:', error.message);
      }

      if (!assistantRuntime.shouldReply) return;

      try {
        if (typeof sock.sendPresenceUpdate === 'function') {
          await sock.sendPresenceUpdate('composing', remoteJid).catch(() => {});
        }
        const reply = await replyToCustomer({ chatId: remoteJid, message: textMessage });
        const sent = await sendReplyText(reply, 'assistant');
        await recordConversationMessage(
          {
            ...conversationIdentity,
            whatsappMessageId: sent?.key?.id || null,
            outboxId: sent.outboxId,
            direction: 'outbound',
            senderType: 'assistant',
            content: reply,
            deliveryStatus: sent.deliveryStatus,
          },
          { bestEffort: true },
        ).catch((error) => {
          console.warn('[WHATSAPP] Не удалось сохранить ответ ассистента:', error.message);
        });
      } catch (error) {
        console.error('[AI] Не удалось ответить клиенту:', {
          code: error?.code || 'GEMINI_UNKNOWN',
          statusCode: error?.statusCode || null,
        });
        const fallbackText =
          assistantRuntime.settings?.fallbackMessage || customerErrorMessage(error);
        const sent = await sendReplyText(fallbackText, 'assistant');
        await recordConversationMessage(
          {
            ...conversationIdentity,
            whatsappMessageId: sent?.key?.id || null,
            outboxId: sent.outboxId,
            direction: 'outbound',
            senderType: 'assistant',
            content: fallbackText,
            deliveryStatus: sent.deliveryStatus,
            metadata: { fallback: true },
          },
          { bestEffort: true },
        ).catch(() => {});
      } finally {
        if (typeof sock.sendPresenceUpdate === 'function') {
          await sock.sendPresenceUpdate('paused', remoteJid).catch(() => {});
        }
      }
    });
    return currentSocket;
  } catch (err) {
    if (generation !== whatsappGeneration) return null;
    updateWhatsAppConnection({ state: 'error', lastError: 'Не удалось подключиться к WhatsApp' });
    console.error('[WHATSAPP] Ошибка инициализации:', err);
    return null;
  }
}

async function sendWhatsAppChatMessage(
  remoteJid,
  text,
  { dedupeKey, sourceType = 'operator', metadata = {} } = {},
) {
  if (!isDirectWhatsAppChat(remoteJid)) {
    throw Object.assign(new Error('Можно писать только в личный WhatsApp-диалог'), {
      statusCode: 400,
      code: 'WHATSAPP_INVALID_CHAT',
    });
  }
  const message = String(text || '').trim();
  if (!message || message.length > 10_000) {
    throw Object.assign(new Error('Сообщение должно содержать от 1 до 10000 символов'), {
      statusCode: 400,
      code: 'WHATSAPP_INVALID_MESSAGE',
    });
  }
  try {
    return await queueWhatsAppText(remoteJid, message, {
      dedupeKey,
      sourceType,
      metadata,
    });
  } catch (err) {
    console.error('[WHATSAPP ERROR] Не удалось поставить сообщение в очередь', {
      code: err?.code || 'WHATSAPP_QUEUE_FAILED',
    });
    throw Object.assign(new Error('Не удалось сохранить сообщение WhatsApp для отправки'), {
      statusCode: 503,
      code: 'WHATSAPP_QUEUE_FAILED',
      cause: err,
    });
  }
}

async function sendWhatsAppVoiceMessage(
  remoteJid,
  audioBuffer,
  {
    declaredMimeType = '',
    durationSeconds,
    dedupeKey,
    sourceType = 'operator',
    metadata = {},
    transcode = transcodeVoiceNote,
  } = {},
) {
  if (!isDirectWhatsAppChat(remoteJid)) {
    throw Object.assign(new Error('Можно писать только в личный WhatsApp-диалог'), {
      statusCode: 400,
      code: 'WHATSAPP_INVALID_CHAT',
    });
  }
  const seconds = normalizeVoiceNoteDuration(durationSeconds);
  const normalizedAudio = await transcode(audioBuffer, { declaredMimeType });
  try {
    const queued = await enqueueWhatsAppVoice({
      chatJid: remoteJid,
      audio: normalizedAudio,
      durationSeconds: seconds,
      dedupeKey,
      sourceType,
      metadata,
    });
    if (queued.status === 'sent') {
      return {
        key: { id: queued.providerMessageId },
        outboxId: queued.id,
        deliveryStatus: 'sent',
        queued: false,
      };
    }
    const [delivery] = await flushWhatsAppOutbox({ messageId: queued.id, limit: 1 });
    const sent = delivery?.status === 'sent';
    const failed = delivery?.status === 'failed' || queued.status === 'failed';
    return {
      key: { id: sent ? delivery.providerMessageId : null },
      outboxId: queued.id,
      deliveryStatus: sent ? 'sent' : failed ? 'failed' : 'pending',
      queued: !sent,
    };
  } catch (error) {
    console.error('[WHATSAPP ERROR] Не удалось поставить голосовое в очередь', {
      code: error?.code || 'WHATSAPP_VOICE_QUEUE_FAILED',
    });
    throw Object.assign(new Error('Не удалось сохранить голосовое WhatsApp для отправки'), {
      statusCode: 503,
      code: 'WHATSAPP_VOICE_QUEUE_FAILED',
      cause: error,
    });
  }
}

/** Отправка сообщения через активную QR-сессию Baileys. */
async function sendWhatsAppMessage(phone, text) {
  const cleanPhone = String(phone || '').replace(/[^0-9]/g, '');
  if (!cleanPhone) return false;
  try {
    await sendWhatsAppChatMessage(`${cleanPhone}@s.whatsapp.net`, text);
    return true;
  } catch (_error) {
    return false;
  }
}

module.exports = {
  flushWhatsAppOutbox,
  getWhatsAppDisconnectAction,
  getWhatsAppDisconnectStatusCode,
  getWhatsAppStatus,
  initWhatsApp,
  isWhatsAppAuthStorageId,
  resetWhatsAppPairing,
  resetSupabaseWhatsAppAuth,
  sendWhatsAppChatMessage,
  sendWhatsAppVoiceMessage,
  sendWhatsAppMessage,
};

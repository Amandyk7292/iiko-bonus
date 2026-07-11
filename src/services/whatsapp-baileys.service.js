const {
  makeWASocket,
  DisconnectReason,
  initAuthCreds,
  BufferJSON,
} = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { supabase } = require('../config/supabase');
const crypto = require('crypto');
const { resolveWhatsAppSenderDigits } = require('../utils/whatsapp.util');

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

let sock = null;
let reconnectTimer = null;

async function initWhatsApp(otpStore, getOrCreateCustomerByPhone) {
  try {
    const { state, saveCreds } = await useSupabaseAuthState();

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
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
        const shouldReconnect =
          lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[WHATSAPP] Соединение закрыто. Переподключение:', shouldReconnect);
        if (shouldReconnect && !reconnectTimer) {
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            initWhatsApp(otpStore, getOrCreateCustomerByPhone);
          }, 5000);
          reconnectTimer.unref?.();
        } else if (!shouldReconnect) {
          console.log(
            '[WHATSAPP] Вы вышли из аккаунта. Удалите сессии из Supabase и запустите заново.',
          );
        }
      } else if (connection === 'open') {
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = null;
        console.log('[WHATSAPP] Успешно подключено к WhatsApp!');
      }
    });

    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;
      const msg = m.messages[0];
      if (!msg.message || msg.key.fromMe) return;

      const remoteJid = msg.key.remoteJid;

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
            await sock.sendMessage(remoteJid, { text: `Задача сохранена.` });
          } catch (e) {
            console.error('[WHATSAPP] Ошибка сохранения задачи:', e);
            await sock.sendMessage(remoteJid, { text: `Ошибка при сохранении задачи.` });
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
            await sock.sendMessage(remoteJid, { text: `В этой группе нет активных задач.` });
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

          await sock.sendMessage(remoteJid, { text: reply });
        } catch (e) {
          console.error('[WHATSAPP] Ошибка получения задач:', e);
          await sock.sendMessage(remoteJid, { text: `Ошибка при получении списка задач.` });
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
              await sock.sendMessage(remoteJid, {
                text: `Задача под номером ${taskNum} не найдена.`,
              });
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

            await sock.sendMessage(remoteJid, {
              text: `${taskDesc} выполнена и удалена из списка.`,
            });
          } catch (e) {
            console.error('[WHATSAPP] Ошибка при удалении задачи:', e);
            await sock.sendMessage(remoteJid, { text: `Ошибка при удалении задачи.` });
          }
        }
        return;
      }

      if (textMessage.toLowerCase().startsWith('код')) {
        const parts = textMessage.trim().split(/\s+/);

        // If no token provided — tell the user they need it
        if (parts.length < 2 || parts[1].length < 8) {
          await sock.sendMessage(remoteJid, {
            text: 'Для получения кода нужен идентификатор из приложения.\n\nОткройте приложение Bulka, введите номер и нажмите "Получить код в WhatsApp" — сообщение отправится автоматически.',
          });
          return;
        }

        const token = parts[1];

        // Look up the token to find the phone number
        let phone = null;
        try {
          const { data } = await supabase
            .from('whatsapp_sessions')
            .select('data')
            .eq('id', `token_${token}`)
            .maybeSingle();
          if (data && data.data) {
            const parsed = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;
            if (parsed.phone && parsed.expires > Date.now()) {
              const senderDigits = await resolveWhatsAppSenderDigits(
                msg.key,
                sock.signalRepository?.lidMapping,
              );
              const requestedDigits = String(parsed.phone).replace(/[^0-9]/g, '');
              if (!senderDigits || senderDigits.slice(-10) !== requestedDigits.slice(-10)) {
                await sock.sendMessage(remoteJid, {
                  text: 'Номер WhatsApp не совпадает с номером, указанным в приложении.',
                });
                return;
              }
              phone = parsed.phone;

              // Delete used token so it can't be reused
              await supabase.from('whatsapp_sessions').delete().eq('id', `token_${token}`);
            }
          }
        } catch (e) {
          console.error('[WHATSAPP] Error resolving token:', e.message);
        }

        if (!phone) {
          await sock.sendMessage(remoteJid, {
            text: 'Идентификатор недействителен или истёк.\n\nВернитесь в приложение и запросите код заново.',
          });
          return;
        }

        try {
          // Generate OTP code (4 digits)
          let code;
          const existing = await otpStore.get(phone);
          if (existing && existing.expires > Date.now()) {
            code = existing.code;
          } else {
            code = crypto.randomInt(1000, 10000).toString();
            await otpStore.set(phone, { code, attempts: 0, expires: Date.now() + 5 * 60 * 1000 });
          }

          const replyText = `*Ваш код для входа в приложение:*\n\n*${code}*\n\n_Код действителен 5 минут._`;
          await sock.sendMessage(remoteJid, { text: replyText });
          console.log('[WHATSAPP] Код подтверждения отправлен');
        } catch (err) {
          console.error('[WHATSAPP] Ошибка обработки запроса кода:', err);
          await sock.sendMessage(remoteJid, { text: 'Произошла ошибка. Попробуйте позже.' });
        }
      }
    });
  } catch (err) {
    console.error('[WHATSAPP] Ошибка инициализации:', err);
  }
}

/** Отправка сообщения через активную QR-сессию Baileys. */
async function sendWhatsAppMessage(phone, text) {
  if (!sock) {
    console.warn('[WHATSAPP] Message was not sent because the client is not initialized.');
    return false;
  }
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const remoteJid = `${cleanPhone}@s.whatsapp.net`;
  try {
    await sock.sendMessage(remoteJid, { text });
    return true;
  } catch (err) {
    console.error('[WHATSAPP ERROR] Не удалось отправить сообщение', err);
    return false;
  }
}

module.exports = { initWhatsApp, sendWhatsAppMessage };

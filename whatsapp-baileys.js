const { makeWASocket, DisconnectReason, initAuthCreds, BufferJSON } = require('@whiskeysockets/baileys');
const pino = require('pino');
const qrcode = require('qrcode-terminal');
const { supabase } = require('./supabase');

/**
 * Адаптер для сохранения сессии Baileys в Supabase
 */
async function useSupabaseAuthState() {
  const writeData = async (data, id) => {
    const json = JSON.stringify(data, BufferJSON.replacer);
    await supabase.from('whatsapp_sessions').upsert(
      { id, data: JSON.parse(json) }, 
      { onConflict: 'id' }
    );
  };
  
  const readData = async (id) => {
    const { data, error } = await supabase.from('whatsapp_sessions').select('data').eq('id', id).maybeSingle();
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
          await Promise.all(ids.map(async id => {
            let value = await readData(`${type}-${id}`);
            if (type === 'app-state-sync-key' && value) {
              value = require('@whiskeysockets/baileys').proto.Message.AppStateSyncKeyData.fromObject(value);
            }
            data[id] = value;
          }));
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
        }
      }
    },
    saveCreds: () => {
      return writeData(creds, 'creds');
    }
  };
}

let sock = null;

async function initWhatsApp(otpStore, getOrCreateCustomerByPhone) {
  try {
    const { state, saveCreds } = await useSupabaseAuthState();
    
    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' })
    });
    
    sock.ev.on('creds.update', saveCreds);
    
    sock.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update;
      
      if (qr) {
        console.log('\n======================================================');
        console.log('[WHATSAPP] Пожалуйста, отсканируйте этот QR-код в WhatsApp:');
        qrcode.generate(qr, { small: true });
        console.log('\nЕСЛИ В ЛОГАХ QR-КОД ОТОБРАЖАЕТСЯ КРИВО, ОТКРОЙТЕ ЭТУ ССЫЛКУ:');
        console.log(`https://api.qrserver.com/v1/create-qr-code/?size=400x400&data=${encodeURIComponent(qr)}`);
        console.log('======================================================\n');
      }
      
      if (connection === 'close') {
        const shouldReconnect = lastDisconnect.error?.output?.statusCode !== DisconnectReason.loggedOut;
        console.log('[WHATSAPP] Соединение закрыто. Переподключение:', shouldReconnect);
        if (shouldReconnect) {
          initWhatsApp(otpStore, getOrCreateCustomerByPhone);
        } else {
          console.log('[WHATSAPP] Вы вышли из аккаунта. Удалите сессии из Supabase и запустите заново.');
        }
      } else if (connection === 'open') {
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
          textMessage = messageContent.conversation || 
                        messageContent.extendedTextMessage?.text || 
                        messageContent.imageMessage?.caption ||
                        messageContent.videoMessage?.caption || '';
          
          if (!textMessage && messageContent.ephemeralMessage?.message) {
              const em = messageContent.ephemeralMessage.message;
              textMessage = em.conversation || em.extendedTextMessage?.text || em.imageMessage?.caption || '';
          }
          
          if (!textMessage && messageContent.viewOnceMessage?.message) {
              const vom = messageContent.viewOnceMessage.message;
              textMessage = vom.conversation || vom.extendedTextMessage?.text || vom.imageMessage?.caption || '';
          }
          
          if (!textMessage && messageContent.viewOnceMessageV2?.message) {
              const vom2 = messageContent.viewOnceMessageV2.message;
              textMessage = vom2.conversation || vom2.extendedTextMessage?.text || vom2.imageMessage?.caption || '';
          }
      }
      
      console.log(`[WHATSAPP] Получено сообщение от ${remoteJid}: "${textMessage}"`);
      
      if (!textMessage) return;

      if (textMessage.toLowerCase().startsWith('код')) {
        if (remoteJid.endsWith('@lid')) {
            console.log(`[WHATSAPP] LID MESSAGE DUMP:`, JSON.stringify(msg, null, 2));
        }
        
        let phone = remoteJid.split('@')[0];
        
        // Extract token if present (e.g., "Код 123456")
        const parts = textMessage.trim().split(/\s+/);
        if (parts.length > 1) {
            const token = parts[1];
            try {
                const { data } = await supabase.from('whatsapp_sessions').select('data').eq('id', `token_${token}`).maybeSingle();
                if (data && data.data) {
                    const parsed = JSON.parse(data.data);
                    if (parsed.phone && parsed.expires > Date.now()) {
                        phone = parsed.phone;
                        console.log(`[WHATSAPP] Resolved token ${token} to phone ${phone}`);
                    }
                }
            } catch (e) {
                console.error('[WHATSAPP] Error resolving token:', e.message);
            }
        }
        
        try {
          const customer = await getOrCreateCustomerByPhone(phone, 'Гость (WhatsApp)');
          
          // Re-use existing OTP if present, otherwise generate a new one
          let code;
          const existing = await otpStore.get(phone);
          if (existing && existing.expires > Date.now()) {
              code = existing.code;
          } else {
              code = Math.floor(1000 + Math.random() * 9000).toString();
              await otpStore.set(phone, { code, expires: Date.now() + 5 * 60 * 1000 }); // 5 min expiry
          }
          
          const replyText = `*Ваш код для входа в приложение:*\n\n${code}\n\n_Код действителен 5 минут._`;
          await sock.sendMessage(remoteJid, { text: replyText });
          console.log(`[WHATSAPP] Отправлен код ${code} пользователю ${phone}`);
        } catch (err) {
          console.error('[WHATSAPP] Ошибка обработки запроса кода:', err);
        }
      }
    });
    
  } catch (err) {
    console.error('[WHATSAPP] Ошибка инициализации:', err);
  }
}

/**
 * Вспомогательная функция для программной отправки сообщений, 
 * если нужно заменить старую sendWhatsAppMessage
 */
async function sendWhatsAppMessage(phone, text) {
    if (!sock) {
        console.log(`[WHATSAPP MOCK] Отправка недоступна (не инициализировано). Сообщение: ${text}`);
        return;
    }
    const cleanPhone = phone.replace(/[^0-9]/g, '');
    const remoteJid = `${cleanPhone}@s.whatsapp.net`;
    try {
        await sock.sendMessage(remoteJid, { text });
    } catch (err) {
        console.error(`[WHATSAPP ERROR] Не удалось отправить сообщение на ${phone}`, err);
    }
}

module.exports = { initWhatsApp, sendWhatsAppMessage };

const fetch = require('node-fetch') || global.fetch;
const { getCustomerByPhone, getOrCreateCustomerByPhone } = require('./customers');
const { getSettings } = require('./settings');

// Токен бота по умолчанию (от пользователя) или из переменных окружения
const TOKEN = process.env.TELEGRAM_BOT_TOKEN || '8786019464:AAHjKVN6mHF5un4ZedUpaxbCg32Q5PC4wbw';
// URL для WebApp (ваш продакшен на Render по умолчанию)
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://iiko-bonus.onrender.com/app';

let offset = 0;
let isRunning = false;

async function callApi(method, data = {}) {
  try {
    const url = `https://api.telegram.org/bot${TOKEN}/${method}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    return await res.json();
  } catch (err) {
    console.error(`Telegram API error (${method}):`, err.message);
    return null;
  }
}

async function sendMessage(chatId, text, replyMarkup = null) {
  const payload = {
    chat_id: chatId,
    text: text,
    parse_mode: 'HTML'
  };
  if (replyMarkup) {
    payload.reply_markup = replyMarkup;
  }
  return await callApi('sendMessage', payload);
}

async function handleUpdate(update) {
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text || '';
  const contact = msg.contact;

  const keyboard = {
    keyboard: [
      [{ text: 'Отправить мой номер телефона', request_contact: true }],
      [{ text: 'Моя карта (Mini App)', web_app: { url: WEBAPP_URL } }],
      [{ text: 'Мой баланс и статус' }, { text: 'Правила программы' }]
    ],
    resize_keyboard: true
  };

  const inlineCardButton = {
    inline_keyboard: [
      [
        {
          text: 'Открыть виртуальную карту (QR)',
          web_app: { url: WEBAPP_URL }
        }
      ]
    ]
  };

  if (text.startsWith('/start') || text.startsWith('/help')) {
    const welcome = `<b>Добро пожаловать в клуб привилегий iiko Bonus!</b>\n\nЗдесь вы можете контролировать свой баланс баллов, следить за начислением кэшбэка и предъявлять электронный QR-код официанту или кассиру при оплате счета.\n\n<b>Защита аккаунта:</b> Ввод чужих номеров запрещен. Доступ к виртуальной карте привязывается строго к вашему Telegram-аккаунту.\n\nНажмите кнопку <b>«Отправить мой номер телефона»</b> внизу экрана, чтобы авторизоваться в системе.`;
    await sendMessage(chatId, welcome, keyboard);
    return;
  }

  if (contact && contact.phone_number) {
    const phone = contact.phone_number;
    const name = `${msg.from.first_name || ''} ${msg.from.last_name || ''}`.trim() || 'Гость Telegram';
    
    try {
      // Регистрируем или находим клиента (строго без подарка +300 бонусов!)
      const customer = await getOrCreateCustomerByPhone(phone, name);
      const { supabase } = require('./supabase');
      await supabase.from('customers').update({ telegram_id: chatId }).eq('id', customer.id);
      
      const settings = await getSettings();
      const { getTierInfo } = require('./index');
      const tier = getTierInfo(customer.total_spent, settings);
      
      let statusStr = `<b>${tier.name} (${tier.percent}%)</b>`;
      let nextStr = tier.nextTier ? `\n<b>До статуса "${tier.nextTier}":</b> осталось ${tier.remaining.toLocaleString()} тнг` : '';

      const replyText = `<b>Вы успешно авторизованы!</b>\n\n<b>Гость:</b> ${customer.name || name}\n<b>Телефон:</b> ${customer.phone}\n<b>Баланс:</b> <code>${customer.balance || 0}</code> бонусов\n<b>Уровень:</b> ${statusStr}\n<b>Всего покупок:</b> ${(customer.total_spent || 0).toLocaleString()} тнг${nextStr}\n\nЧтобы показать ваш статический QR-код на кассе, откройте виртуальную карту ниже:`;
      
      // Генерируем одноразовый токен для Apple Wallet
      let walletUrl = '';
      try {
        const tokenRes = await fetch(`${WEBAPP_URL.replace('/app', '')}/api/wallet/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: customer.phone })
        });
        const tokenData = await tokenRes.json();
        walletUrl = tokenData.url;
      } catch (e) {
        console.error('Wallet token error:', e.message);
      }

      const userCardButton = {
        inline_keyboard: [
          [
            {
              text: 'Открыть мою виртуальную карту (QR)',
              web_app: { url: `${WEBAPP_URL}?phone=${encodeURIComponent(customer.phone)}` }
            }
          ],
          ...(walletUrl ? [[
            {
              text: ' Добавить в Apple Wallet',
              url: walletUrl
            }
          ]] : [])
        ]
      };

      await sendMessage(chatId, replyText, userCardButton);
    } catch (err) {
      await sendMessage(chatId, `Ошибка при поиске клиента: ${err.message}`);
    }
    return;
  }

  if (text.includes('Мой баланс') || text.includes('баланс')) {
    await sendMessage(chatId, `Чтобы проверить баланс, пожалуйста, нажмите кнопку <b>«Отправить мой номер телефона»</b> в меню внизу. Так система определит ваш профиль в базе ресторана.`);
    return;
  }

  if (text.includes('Правила')) {
    const rules = `<b>Правила нашей программы лояльности:</b>\n\n<b>Кэшбэк с заказов:</b> С каждого счета вам возвращается от 3% до 5% баллами. 1 бонус = 1 тенге.\n\n<b>VIP Уровень:</b> При достижении общей суммы покупок от 300 000 тнг ваш кэшбэк автоматически повышается до VIP уровня!\n\n<b>Оплата бонусами:</b> Вы можете оплатить накопленными баллами часть вашего счета на кассе.\n\n<b>Срок действия:</b> Бонусы не сгорают, если вы посещаете наш ресторан хотя бы раз в 90 дней!`;
    await sendMessage(chatId, rules, inlineCardButton);
    return;
  }

  // Если пользователь ввел номер телефона вручную текстом
  if (/^[+0-9]{10,15}$/.test(text.replace(/[^0-9+]/g, ''))) {
    await sendMessage(chatId, `<b>Ручной ввод чужих номеров запрещен</b>\n\nДля защиты баланса баллов от несанкционированного доступа, определение аккаунта происходит строго через подтверждение контакта в Telegram.\n\nПожалуйста, нажмите кнопку <b>«Отправить мой номер телефона»</b> внизу экрана.`);
    return;
  }

  await sendMessage(chatId, `Я вас не понял Воспользуйтесь кнопками меню или отправьте команду /start`);
}

async function startPolling() {
  if (isRunning) return;
  isRunning = true;
  console.log('Telegram Bot polling started successfully...');

  // Удаляем вебхуки на случай, если они были установлены ранее
  await callApi('deleteWebhook', { drop_pending_updates: true });

  const poll = async () => {
    while (isRunning) {
      try {
        const res = await callApi('getUpdates', {
          offset: offset,
          timeout: 30
        });

        if (res && res.ok && res.result) {
          for (const update of res.result) {
            offset = update.update_id + 1;
            await handleUpdate(update);
          }
        }
      } catch (err) {
        console.error('Polling loop error:', err.message);
        await new Promise(r => setTimeout(r, 3000));
      }
    }
  };

  poll();
}

function stopPolling() {
  isRunning = false;
}

async function setWebhook(url) {
  return await callApi('setWebhook', { url: url });
}

module.exports = { startPolling, stopPolling, sendMessage, handleUpdate, setWebhook };

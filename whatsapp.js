
require('dotenv').config();

const GREEN_API_URL = process.env.GREEN_API_URL || 'https://api.green-api.com';
const ID_INSTANCE = process.env.GREEN_API_ID_INSTANCE;
const API_TOKEN_INSTANCE = process.env.GREEN_API_TOKEN_INSTANCE;

/**
 * Отправка сообщения в WhatsApp через Green API
 * @param {string} phone Номер телефона (формат: 77771234567, без плюса)
 * @param {string} message Текст сообщения
 */
async function sendWhatsAppMessage(phone, message) {
  // Проверяем, настроен ли Green API
  if (!ID_INSTANCE || !API_TOKEN_INSTANCE) {
    console.log(`[WHATSAPP MOCK] Ключи Green API не заданы. Сообщение для ${phone}:\n${message}`);
    return;
  }

  // Green API требует формат номера <номер>@c.us
  const cleanPhone = phone.replace(/[^0-9]/g, '');
  const chatId = `${cleanPhone}@c.us`;

  try {
    const url = `${GREEN_API_URL}/waInstance${ID_INSTANCE}/sendMessage/${API_TOKEN_INSTANCE}`;
    const payload = {
      chatId,
      message
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(JSON.stringify(data));
    }
    console.log(`[WHATSAPP SUCCESS] Сообщение отправлено на ${phone}. Receipt:`, data);
  } catch (error) {
    console.error(`[WHATSAPP ERROR] Ошибка отправки на ${phone}:`, error.message);
  }
}

module.exports = { sendWhatsAppMessage };

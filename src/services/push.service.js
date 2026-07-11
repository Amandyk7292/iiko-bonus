const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { supabase } = require('../config/supabase');

let initialized = false;
let messagingInstance = null;

function initFirebase() {
  if (initialized) return;
  try {
    let serviceAccount = null;
    const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS_JSON;
    if (rawAccount) {
      try {
        serviceAccount =
          typeof rawAccount === 'string' ? JSON.parse(rawAccount.trim()) : rawAccount;
        if (serviceAccount && typeof serviceAccount.private_key === 'string') {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
      } catch (e) {
        console.error(
          'Error parsing FIREBASE_SERVICE_ACCOUNT/GOOGLE_CREDENTIALS_JSON env:',
          e.message,
        );
      }
    }
    if (serviceAccount) {
      const app = initializeApp({
        credential: cert(serviceAccount),
      });
      messagingInstance = getMessaging(app);
      initialized = true;
      console.log('Firebase Admin SDK initialized successfully for Push Notifications!');
    } else {
      console.warn(
        'No Firebase Service Account found. Push notifications will not be sent via FCM.',
      );
    }
  } catch (e) {
    console.error('Failed to initialize Firebase Admin SDK:', e);
  }
}

initFirebase();

async function sendPushNotification(fcmToken, title, body, data = {}) {
  if (!fcmToken) return false;
  if (!initialized || !messagingInstance) {
    initFirebase();
  }
  if (!initialized || !messagingInstance) {
    console.log('[PUSH PREVIEW] Уведомление не отправлено: Firebase не настроен. Токен:', fcmToken);
    return false;
  }
  try {
    const message = {
      token: fcmToken,
      notification: {
        title: String(title),
        body: String(body),
      },
      data: {
        ...data,
        click_action: 'FLUTTER_NOTIFICATION_CLICK',
      },
      android: {
        priority: 'high',
        notification: {
          sound: 'default',
          channelId: 'bulka_bonus_notifications',
          priority: 'high',
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };
    const response = await messagingInstance.send(message);
    console.log('Successfully sent push notification to Android:', response);
    return true;
  } catch (error) {
    console.error('Error sending push notification:', error.message);
    return false;
  }
}

async function notifyBonusChange({
  customerId,
  fcmToken,
  language = 'ru',
  amount = 0,
  balance = 0,
  reason = '',
  isOrder = false,
  total = 0,
  discount = 0,
  earnedBonus = 0,
}) {
  const lang = ['kk', 'kz'].includes(String(language).toLowerCase())
    ? 'kk'
    : String(language).toLowerCase() === 'en'
      ? 'en'
      : 'ru';

  let title = '';
  let body = '';

  if (isOrder) {
    if (lang === 'kk') {
      title = 'Тапсырыс рәсімделді! ☕';
      body = `Есепшот: ${total} ₸.`;
      if (discount > 0) body += ` Жұмсалды: ${discount} б.`;
      if (earnedBonus > 0) body += ` Қосылды: +${earnedBonus} б.`;
      body += ` Баланс: ${balance} б.`;
    } else if (lang === 'en') {
      title = 'Order completed! ☕';
      body = `Bill: ${total} ₸.`;
      if (discount > 0) body += ` Spent: ${discount} b.`;
      if (earnedBonus > 0) body += ` Earned: +${earnedBonus} b.`;
      body += ` Balance: ${balance} b.`;
    } else {
      title = 'Ваш заказ оформлен! ☕';
      body = `Счет: ${total} ₸.`;
      if (discount > 0) body += ` Списано: ${discount} б.`;
      if (earnedBonus > 0) body += ` Начислено: +${earnedBonus} б.`;
      body += ` Баланс: ${balance} б.`;
    }
  } else {
    const isPositive = Number(amount) >= 0;
    const absAmount = Math.abs(Number(amount));
    if (lang === 'kk') {
      title = isPositive ? 'Бонустар қосылды ✨' : 'Бонустар жұмсалды 💳';
      body = isPositive
        ? `Сізге +${absAmount} бонус қосылды! Ағымдағы баланс: ${balance} бон.`
        : `${absAmount} бонус есептен шығарылды. Ағымдағы баланс: ${balance} бон.`;
      if (reason) body += ` (Себебі: ${reason})`;
    } else if (lang === 'en') {
      title = isPositive ? 'Bonuses earned ✨' : 'Bonuses spent 💳';
      body = isPositive
        ? `You received +${absAmount} bonuses! Current balance: ${balance} bon.`
        : `${absAmount} bonuses redeemed. Current balance: ${balance} bon.`;
      if (reason) body += ` (Reason: ${reason})`;
    } else {
      title = isPositive ? 'Начисление бонусов ✨' : 'Списание бонусов 💳';
      body = isPositive
        ? `Вам начислено +${absAmount} бонусов! Текущий баланс: ${balance} бон.`
        : `Списано ${absAmount} бонусов. Текущий баланс: ${balance} бон.`;
      if (reason) body += ` (Причина: ${reason})`;
    }
  }

  let savedNotificationId = '';
  if (customerId) {
    try {
      const { data: saved } = await supabase
        .from('customer_notifications')
        .insert({
          customer_id: customerId,
          title: String(title).slice(0, 160),
          body: String(body).slice(0, 2000),
          type: 'bonus',
        })
        .select('id')
        .single();
      if (saved) savedNotificationId = saved.id;
    } catch (dbErr) {
      console.error('Failed to insert customer_notification for bonus:', dbErr.message);
    }
  }

  if (fcmToken) {
    await sendPushNotification(fcmToken, title, body, {
      notificationId: String(savedNotificationId || ''),
      type: 'bonus',
    });
  }

  return { title, body, savedNotificationId };
}

module.exports = {
  sendPushNotification,
  notifyBonusChange,
  initFirebase,
};

const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');

let initialized = false;
let messagingInstance = null;

function initFirebase() {
  if (initialized) return;
  try {
    let serviceAccount = null;
    const rawAccount = process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS_JSON;
    if (rawAccount) {
      try {
        serviceAccount = typeof rawAccount === 'string' ? JSON.parse(rawAccount.trim()) : rawAccount;
        if (serviceAccount && typeof serviceAccount.private_key === 'string') {
          serviceAccount.private_key = serviceAccount.private_key.replace(/\\n/g, '\n');
        }
      } catch (e) {
        console.error('Error parsing FIREBASE_SERVICE_ACCOUNT/GOOGLE_CREDENTIALS_JSON env:', e.message);
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

module.exports = {
  sendPushNotification,
  initFirebase,
};

const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const { supabase } = require('../config/supabase');
const { notificationAllowed } = require('./notification-preferences.service');
const {
  PUSH_OUTBOX_SCHEMA_MISSING_CODES,
  deliverPushOutbox,
  enqueuePushNotification,
} = require('./push-outbox.service');

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

function getPushStatus() {
  return {
    configured: Boolean(
      String(
        process.env.FIREBASE_SERVICE_ACCOUNT || process.env.GOOGLE_CREDENTIALS_JSON || '',
      ).trim(),
    ),
    initialized,
  };
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/invalid-registration-token',
  'messaging/registration-token-not-registered',
]);
const PUSH_SCHEMA_MISSING_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);
const AMBIGUOUS_FIREBASE_APP_CODES = new Set([
  'app/internal-error',
  'app/network-error',
  'app/network-timeout',
  'app/unable-to-parse-response',
]);
const PRE_ACCEPT_TRANSPORT_CODES = new Set([
  'CERT_HAS_EXPIRED',
  'DEPTH_ZERO_SELF_SIGNED_CERT',
  'EAI_AGAIN',
  'ECONNREFUSED',
  'ENOTFOUND',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_URL',
  'ERR_TLS_CERT_ALTNAME_INVALID',
  'SELF_SIGNED_CERT_IN_CHAIN',
  'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
]);
const AMBIGUOUS_TRANSPORT_CODES = new Set([
  'ECONNABORTED',
  'ECONNRESET',
  'ENETRESET',
  'EPIPE',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_STREAM_CANCEL',
  'ERR_HTTP2_STREAM_ERROR',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

const normalizedErrorCode = (error) => String(error?.code || '').trim();

function nestedTransportCode(error) {
  let current = error;
  const seen = new Set();
  for (let depth = 0; current && depth < 5 && !seen.has(current); depth += 1) {
    seen.add(current);
    const code = normalizedErrorCode(current);
    if (code && !code.startsWith('app/') && !code.startsWith('messaging/')) return code;
    current = current.cause;
  }
  return '';
}

function classifyPushSendError(error) {
  const code = normalizedErrorCode(error);
  const transportCode = nestedTransportCode(error);
  const hasProviderResponse = Boolean(
    error?.httpResponse || error?.response || error?.cause?.response,
  );

  // A structured FCM response (including 4xx/5xx) proves that this attempt was
  // rejected without a message id. Firebase Messaging client codes are only
  // constructed from such responses or local pre-send validation failures.
  if (hasProviderResponse || code.startsWith('messaging/')) {
    return { outcomeUnknown: false, error: code || 'messaging/rejected' };
  }

  // DNS, connection-refused, certificate and local argument failures prove the
  // request could not have reached FCM. Everything else is fail-closed because
  // the provider may have accepted the POST before its response was lost.
  if (PRE_ACCEPT_TRANSPORT_CODES.has(transportCode || code)) {
    return { outcomeUnknown: false, error: transportCode || code };
  }
  if (code.startsWith('app/') && !AMBIGUOUS_FIREBASE_APP_CODES.has(code)) {
    return { outcomeUnknown: false, error: code };
  }
  const ambiguousCode = AMBIGUOUS_TRANSPORT_CODES.has(transportCode || code)
    ? transportCode || code
    : code.startsWith('app/')
      ? code
      : 'push/transport-outcome-unknown';
  return {
    outcomeUnknown: true,
    error: ambiguousCode,
  };
}

function normalizePushData(data = {}) {
  return Object.fromEntries(
    Object.entries(data)
      .filter(([, value]) => value !== undefined && value !== null)
      .map(([key, value]) => [
        String(key),
        typeof value === 'string'
          ? value
          : typeof value === 'object'
            ? JSON.stringify(value)
            : String(value),
      ]),
  );
}

function webPushLink(data) {
  const publicBase = String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(
    /\/$/,
    '',
  );
  const candidate = String(data.deepLink || `${publicBase}/app/`).trim();
  if (/^https:\/\//i.test(candidate)) return candidate;
  if (candidate.startsWith('/')) return `${publicBase}${candidate}`;
  return `${publicBase}/app/`;
}

async function removeInvalidPushToken(fcmToken) {
  try {
    const { error } = await supabase.rpc('remove_invalid_customer_push_token', {
      p_token: fcmToken,
    });
    if (!error) return;
    if (!PUSH_SCHEMA_MISSING_CODES.has(String(error.code || ''))) throw error;
    const { error: fallbackError } = await supabase
      .from('customers')
      .update({ fcm_token: null })
      .eq('fcm_token', fcmToken);
    if (fallbackError) throw fallbackError;
  } catch (error) {
    console.error('Failed to remove invalid push token:', error.message);
  }
}

async function sendPushNotificationDetailed(fcmToken, title, body, data = {}) {
  const token = String(fcmToken || '').trim();
  if (!token) {
    return { delivered: false, terminal: true, error: 'Push token is missing' };
  }
  if (!initialized || !messagingInstance) {
    initFirebase();
  }
  if (!initialized || !messagingInstance) {
    console.log('[PUSH PREVIEW] Уведомление не отправлено: Firebase не настроен.');
    return { delivered: false, terminal: false, error: 'Firebase is not configured' };
  }
  try {
    const normalizedData = {
      ...normalizePushData(data),
      click_action: 'FLUTTER_NOTIFICATION_CLICK',
    };
    const isOrderStatus = ['order', 'delivery'].includes(normalizedData.type);
    const isStaffOrder = ['staff.order.new', 'staff.order.test'].includes(normalizedData.type);
    const closedStatuses = new Set(['completed', 'cancelled', 'delivered']);
    const closedOrder =
      closedStatuses.has(String(normalizedData.orderStatus || '').toLowerCase()) ||
      closedStatuses.has(String(normalizedData.deliveryStatus || '').toLowerCase());
    const message = {
      token,
      notification: {
        title: String(title),
        body: String(body),
      },
      data: normalizedData,
      android: {
        priority: isOrderStatus ? 'normal' : 'high',
        ...(normalizedData.pushDedupeKey
          ? { collapseKey: `bulka-${normalizedData.pushDedupeKey}`.slice(0, 64) }
          : {}),
        notification: {
          ...(isOrderStatus
            ? {
                channelId: 'bulka_order_status',
                priority: 'default',
                sticky: !closedOrder,
                tag: normalizedData.orderId
                  ? `bulka-order-${normalizedData.orderId}`
                  : 'bulka-active-order',
              }
            : {
                sound: 'default',
                channelId: isStaffOrder ? 'bulka_staff_orders' : 'bulka_bonus_notifications',
                priority: 'high',
                defaultSound: true,
                ...(normalizedData.pushDedupeKey
                  ? { tag: `bulka-${normalizedData.pushDedupeKey}`.slice(0, 160) }
                  : {}),
              }),
        },
      },
      apns: {
        ...(normalizedData.pushDedupeKey
          ? {
              headers: {
                'apns-collapse-id': `bulka-${normalizedData.pushDedupeKey}`.slice(0, 64),
              },
            }
          : {}),
        payload: {
          aps: {
            sound: 'default',
            contentAvailable: true,
          },
        },
      },
      webpush: {
        notification: {
          icon: '/icons/Icon-192.png',
          badge: '/icons/Icon-192.png',
          ...(normalizedData.pushDedupeKey
            ? { tag: `bulka-${normalizedData.pushDedupeKey}`.slice(0, 160) }
            : {}),
        },
        fcmOptions: {
          link: webPushLink(normalizedData),
        },
      },
    };
    const response = await messagingInstance.send(message);
    console.log('Successfully sent push notification:', response);
    return { delivered: true, terminal: true, providerMessageId: response };
  } catch (error) {
    const failure = classifyPushSendError(error);
    console.error('Error sending push notification:', failure.error);
    const terminal = INVALID_TOKEN_CODES.has(String(error.code || ''));
    if (terminal) {
      await removeInvalidPushToken(token);
    }
    return {
      delivered: false,
      terminal,
      outcomeUnknown: failure.outcomeUnknown,
      error: failure.error.slice(0, 120),
    };
  }
}

async function sendPushNotification(fcmToken, title, body, data = {}) {
  const result = await sendPushNotificationDetailed(fcmToken, title, body, data);
  return result.delivered;
}

async function getCustomerPushTokens(customerId, fallbackToken = null) {
  const tokens = new Set();
  if (customerId) {
    const { data, error } = await supabase
      .from('customer_push_tokens')
      .select('token')
      .eq('customer_id', customerId)
      .order('last_seen_at', { ascending: false });
    if (!error) {
      for (const row of data || []) {
        const token = String(row.token || '').trim();
        if (token) tokens.add(token);
      }
    } else if (!PUSH_SCHEMA_MISSING_CODES.has(String(error.code || ''))) {
      console.error('Failed to read customer push tokens:', error.message);
    }
  }
  const fallback = String(fallbackToken || '').trim();
  if (fallback) tokens.add(fallback);
  return [...tokens];
}

async function sendPushToCustomer(customerId, title, body, data = {}, fallbackToken = null) {
  if (!(await notificationAllowed(customerId, data))) {
    return { attempted: 0, delivered: 0, failed: 0, skipped: 'preferences' };
  }
  const tokens = await getCustomerPushTokens(customerId, fallbackToken);
  if (!tokens.length) return { attempted: 0, delivered: 0, failed: 0 };
  if (customerId) {
    let queued;
    try {
      queued = await enqueuePushNotification({
        customerId,
        title,
        body,
        data,
        tokens,
        dedupeKey: data?.pushDedupeKey,
      });
    } catch (outboxError) {
      const schemaUnavailable = PUSH_OUTBOX_SCHEMA_MISSING_CODES.has(
        String(outboxError?.code || ''),
      );
      if (!schemaUnavailable) throw outboxError;
      console.error('Push outbox migration is not installed; using immediate delivery.');
    }
    if (queued) {
      if (!queued.id) return { attempted: 0, delivered: 0, failed: 0, queued: false };
      try {
        const [outcome] = await deliverPushOutbox({
          sendToken: sendPushNotificationDetailed,
          isAllowed: notificationAllowed,
          limit: 1,
          messageId: queued.id,
        });
        if (outcome) return outcome;
        return {
          attempted: queued.attemptedTokens,
          delivered: queued.deliveredTokens,
          failed: Math.max(0, queued.attemptedTokens - queued.deliveredTokens),
          queued: ['queued', 'processing', 'retry'].includes(queued.status),
          outboxId: queued.id,
          status: queued.status,
        };
      } catch (outboxError) {
        console.error(
          'Push remains queued after immediate delivery attempt:',
          outboxError?.message,
        );
        return {
          attempted: queued.attemptedTokens,
          delivered: queued.deliveredTokens,
          failed: Math.max(0, queued.attemptedTokens - queued.deliveredTokens),
          queued: true,
          outboxId: queued.id,
          status: 'queued',
        };
      }
    }
  }
  const results = await Promise.all(
    tokens.map((token) => sendPushNotificationDetailed(token, title, body, data)),
  );
  const delivered = results.filter((result) => result.delivered).length;
  return {
    attempted: tokens.length,
    delivered,
    failed: tokens.length - delivered,
  };
}

async function flushPushOutbox(limit = 50) {
  return deliverPushOutbox({
    sendToken: sendPushNotificationDetailed,
    isAllowed: notificationAllowed,
    limit,
  });
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

  const baseCopy = (copyLanguage) => {
    let title;
    let body;
    if (isOrder && copyLanguage === 'kk') {
      title = 'Тапсырыс рәсімделді!';
      body = `Есепшот: ${total} ₸.`;
      if (discount > 0) body += ` Жұмсалды: ${discount} б.`;
      if (earnedBonus > 0) body += ` Қосылды: +${earnedBonus} б.`;
      body += ` Баланс: ${balance} б.`;
    } else if (isOrder && copyLanguage === 'en') {
      title = 'Order completed!';
      body = `Bill: ${total} ₸.`;
      if (discount > 0) body += ` Spent: ${discount} b.`;
      if (earnedBonus > 0) body += ` Earned: +${earnedBonus} b.`;
      body += ` Balance: ${balance} b.`;
    } else if (isOrder) {
      title = 'Ваш заказ оформлен!';
      body = `Счет: ${total} ₸.`;
      if (discount > 0) body += ` Списано: ${discount} б.`;
      if (earnedBonus > 0) body += ` Начислено: +${earnedBonus} б.`;
      body += ` Баланс: ${balance} б.`;
    } else {
      const isPositive = Number(amount) >= 0;
      const absAmount = Math.abs(Number(amount));
      if (copyLanguage === 'kk') {
        title = isPositive ? 'Бонустар қосылды' : 'Бонустар жұмсалды';
        body = isPositive
          ? `Сізге +${absAmount} бонус қосылды! Ағымдағы баланс: ${balance} бон.`
          : `${absAmount} бонус есептен шығарылды. Ағымдағы баланс: ${balance} бон.`;
        if (reason) body += ` (Себебі: ${reason})`;
      } else if (copyLanguage === 'en') {
        title = isPositive ? 'Bonuses earned' : 'Bonuses spent';
        body = isPositive
          ? `You received +${absAmount} bonuses! Current balance: ${balance} bon.`
          : `${absAmount} bonuses redeemed. Current balance: ${balance} bon.`;
        if (reason) body += ` (Reason: ${reason})`;
      } else {
        title = isPositive ? 'Начисление бонусов' : 'Списание бонусов';
        body = isPositive
          ? `Вам начислено +${absAmount} бонусов! Текущий баланс: ${balance} бон.`
          : `Списано ${absAmount} бонусов. Текущий баланс: ${balance} бон.`;
        if (reason) body += ` (Причина: ${reason})`;
      }
    }
    return { title, body };
  };

  const copies = Object.fromEntries(
    ['ru', 'kk', 'en'].map((copyLanguage) => [copyLanguage, baseCopy(copyLanguage)]),
  );
  let { title, body } = copies[lang];

  if (!isOrder && Number(amount) > 0) {
    try {
      const { data: automation, error } = await supabase
        .from('marketing_automations')
        .select('active,title_translations,body_translations')
        .eq('trigger_type', 'bonus_awarded')
        .maybeSingle();
      if (!error && automation) {
        if (automation.active === false)
          return { title: null, body: null, savedNotificationId: '' };
        const render = (value) =>
          String(value || '')
            .replaceAll('{{amount}}', String(Math.abs(Number(amount))))
            .replaceAll('{{balance}}', String(Number(balance || 0)))
            .replaceAll('{{reason}}', String(reason || ''));
        for (const copyLanguage of ['ru', 'kk', 'en']) {
          copies[copyLanguage] = {
            title: render(
              automation.title_translations?.[copyLanguage] ||
                automation.title_translations?.ru ||
                copies[copyLanguage].title,
            ),
            body: render(
              automation.body_translations?.[copyLanguage] ||
                automation.body_translations?.ru ||
                copies[copyLanguage].body,
            ),
          };
        }
        ({ title, body } = copies[lang]);
      }
    } catch (automationError) {
      console.error('Failed to read bonus automation:', automationError.message);
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
          payload: {
            messageKey: Number(amount) >= 0 && !isOrder ? 'bonus_awarded' : 'bonus_change',
            amount: Number(amount || 0),
            balance: Number(balance || 0),
            i18n: {
              titles: Object.fromEntries(
                Object.entries(copies).map(([code, copy]) => [code, copy.title]),
              ),
              bodies: Object.fromEntries(
                Object.entries(copies).map(([code, copy]) => [code, copy.body]),
              ),
            },
          },
        })
        .select('id')
        .single();
      if (saved) savedNotificationId = saved.id;
    } catch (dbErr) {
      console.error('Failed to insert customer_notification for bonus:', dbErr.message);
    }
  }

  if (customerId || fcmToken) {
    await sendPushToCustomer(
      customerId,
      title,
      body,
      {
        notificationId: String(savedNotificationId || ''),
        type: 'bonus',
        balance: Number(balance || 0),
      },
      fcmToken,
    );
  }

  return { title, body, savedNotificationId };
}

module.exports = {
  classifyPushSendError,
  getCustomerPushTokens,
  flushPushOutbox,
  sendPushNotification,
  sendPushNotificationDetailed,
  sendPushToCustomer,
  notifyBonusChange,
  getPushStatus,
  initFirebase,
};

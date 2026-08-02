const { supabase } = require('../config/supabase');

const SCHEMA_MISSING = new Set(['42P01', '42703', 'PGRST204', 'PGRST205']);
const DEFAULTS = Object.freeze({
  ordersEnabled: true,
  bonusEnabled: true,
  promosEnabled: true,
  supportEnabled: true,
  quietHoursEnabled: false,
  quietStart: '22:00',
  quietEnd: '08:00',
  timezone: 'Asia/Aqtau',
});

const preferenceError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const asTime = (value, fallback) => {
  const clean = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(clean)) {
    if (fallback) return fallback;
    throw preferenceError('Время должно быть в формате ЧЧ:ММ');
  }
  return clean;
};

const normalize = (row = {}) => ({
  ordersEnabled: row.orders_enabled ?? DEFAULTS.ordersEnabled,
  bonusEnabled: row.bonus_enabled ?? DEFAULTS.bonusEnabled,
  promosEnabled: row.promos_enabled ?? DEFAULTS.promosEnabled,
  supportEnabled: row.support_enabled ?? DEFAULTS.supportEnabled,
  quietHoursEnabled: row.quiet_hours_enabled ?? DEFAULTS.quietHoursEnabled,
  quietStart: String(row.quiet_start || DEFAULTS.quietStart).slice(0, 5),
  quietEnd: String(row.quiet_end || DEFAULTS.quietEnd).slice(0, 5),
  timezone: row.timezone || DEFAULTS.timezone,
  updatedAt: row.updated_at || null,
});

async function getNotificationPreferences(customerId, { failOpen = false } = {}) {
  const { data, error } = await supabase
    .from('customer_notification_preferences')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) {
    if (failOpen && SCHEMA_MISSING.has(String(error.code || ''))) return { ...DEFAULTS };
    throw error;
  }
  return normalize(data || {});
}

async function updateNotificationPreferences(customerId, payload = {}) {
  const booleanKeys = [
    ['ordersEnabled', 'orders_enabled'],
    ['bonusEnabled', 'bonus_enabled'],
    ['promosEnabled', 'promos_enabled'],
    ['supportEnabled', 'support_enabled'],
    ['quietHoursEnabled', 'quiet_hours_enabled'],
  ];
  const row = {
    customer_id: customerId,
    updated_at: new Date().toISOString(),
  };
  for (const [input, column] of booleanKeys) {
    if (payload[input] === undefined) continue;
    if (typeof payload[input] !== 'boolean') {
      throw preferenceError('Некорректное значение настройки');
    }
    row[column] = payload[input];
  }
  if (payload.quietStart !== undefined) row.quiet_start = asTime(payload.quietStart);
  if (payload.quietEnd !== undefined) row.quiet_end = asTime(payload.quietEnd);
  if (payload.timezone !== undefined) {
    const timezone = String(payload.timezone || '').trim();
    try {
      new Intl.DateTimeFormat('en', { timeZone: timezone }).format(new Date());
    } catch (_) {
      throw preferenceError('Некорректный часовой пояс');
    }
    row.timezone = timezone.slice(0, 80);
  }
  const { data, error } = await supabase
    .from('customer_notification_preferences')
    .upsert(row, { onConflict: 'customer_id' })
    .select('*')
    .single();
  if (error) throw error;
  return normalize(data);
}

function notificationCategory(data = {}) {
  const type = String(data.type || data.category || '').toLowerCase();
  if (type.includes('support')) return 'support';
  if (type.includes('bonus') || type.includes('loyalty') || type.includes('wallet')) {
    return 'bonus';
  }
  if (type.includes('promo') || type.includes('marketing') || type.includes('news')) {
    return 'promos';
  }
  if (
    type.includes('order') ||
    type.includes('delivery') ||
    type.includes('courier') ||
    type.includes('kitchen') ||
    type.includes('refund')
  ) {
    return 'orders';
  }
  // Broadcasts without an explicit type are marketing, never transactional.
  return 'promos';
}

function localMinutes(timezone, now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  return hour * 60 + minute;
}

function inQuietHours(preferences, now = new Date()) {
  if (!preferences.quietHoursEnabled) return false;
  const toMinutes = (value) => {
    const [hour, minute] = asTime(value, '00:00').split(':').map(Number);
    return hour * 60 + minute;
  };
  const current = localMinutes(preferences.timezone || DEFAULTS.timezone, now);
  const start = toMinutes(preferences.quietStart);
  const end = toMinutes(preferences.quietEnd);
  if (start === end) return true;
  return start < end ? current >= start && current < end : current >= start || current < end;
}

async function notificationAllowed(customerId, data = {}, now = new Date()) {
  if (!customerId) return true;
  let preferences;
  try {
    preferences = await getNotificationPreferences(customerId, { failOpen: true });
  } catch (error) {
    console.error('Failed to read notification preferences:', error.message);
    return true;
  }
  const category = notificationCategory(data);
  const enabled = preferences[`${category}Enabled`] !== false;
  if (!enabled) return false;
  // Order and support updates are transactional and must not be delayed by quiet hours.
  if (category === 'orders' || category === 'support') return true;
  return !inQuietHours(preferences, now);
}

module.exports = {
  DEFAULTS,
  getNotificationPreferences,
  inQuietHours,
  notificationAllowed,
  notificationCategory,
  updateNotificationPreferences,
};

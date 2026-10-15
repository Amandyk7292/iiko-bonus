const { supabase } = require('../config/supabase');

const BONUS_EXPIRY_REMINDER_TYPE = 'bonus_expiry_reminder';
const REMINDER_DAYS = Object.freeze([30, 15, 7]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function reminderCopy({ amount, daysLeft, expiresOn, language }) {
  const lang = ['kk', 'kz'].includes(language) ? 'kk' : language === 'en' ? 'en' : 'ru';
  const value = new Intl.NumberFormat(lang === 'kk' ? 'kk-KZ' : lang, {
    maximumFractionDigits: 2,
  }).format(amount);
  const date = expiresOn.split('-').reverse().join('.');
  if (lang === 'kk') {
    return {
      title: 'Бонустарыңызды пайдаланыңыз',
      body: `${daysLeft} күннен кейін ${value} ₸ бонус жойылады. ${date} күніне дейін пайдаланыңыз.`,
      language: lang,
    };
  }
  if (lang === 'en') {
    return {
      title: 'Use your bonuses soon',
      body: `${value} ₸ in bonuses expire in ${daysLeft} days. Use them before ${date}.`,
      language: lang,
    };
  }
  const mod100 = daysLeft % 100;
  const mod10 = daysLeft % 10;
  const days =
    mod100 >= 11 && mod100 <= 14
      ? 'дней'
      : mod10 === 1
        ? 'день'
        : mod10 >= 2 && mod10 <= 4
          ? 'дня'
          : 'дней';
  return {
    title: 'Успейте потратить бонусы',
    body: `Через ${daysLeft} ${days} сгорят ${value} ₸ бонусов. Используйте их до ${date}.`,
    language: lang,
  };
}

async function runBonusExpiryReminders({
  db = supabase,
  now = new Date(),
  limit = 500,
  maxBatches = 20,
} = {}) {
  const batchSize = Math.min(2000, Math.max(1, Math.floor(Number(limit) || 500)));
  const batches = Math.min(20, Math.max(1, Math.floor(Number(maxBatches) || 20)));
  let queued = 0;
  for (let batch = 0; batch < batches; batch++) {
    const { data, error } = await db.rpc('enqueue_bonus_expiry_reminders', {
      p_now: now.toISOString(),
      p_limit: batchSize,
    });
    if (error) throw error;
    const count = Number(data || 0);
    queued += count;
    if (count < batchSize) break;
  }
  return { queued };
}

// Every delivery attempt, including a durable retry, refreshes the exact dated
// tranche. A later accrual never becomes part of an earlier expiry warning.
async function prepareBonusExpiryReminder(row, { db = supabase, now = new Date() } = {}) {
  if (row.data?.type !== BONUS_EXPIRY_REMINDER_TYPE) return row;
  const payload = row.data;
  const days = Number(payload.reminderDays);
  if (
    !UUID.test(String(row.customerId || '')) ||
    !/^\d{4}-\d{2}-\d{2}$/.test(String(payload.bonusExpiresOn || '')) ||
    !REMINDER_DAYS.includes(days) ||
    payload.reminderVersion !== 'credit-lots-v1'
  )
    return null;
  const { data, error } = await db.rpc('bonus_expiry_reminder_state', {
    p_customer_id: row.customerId,
    p_expires_on: payload.bonusExpiresOn,
    p_reminder_days: days,
    p_now: now.toISOString(),
  });
  if (error) throw error;
  const state = data;
  const amount = Number(state?.amount || 0);
  const daysLeft = Number(state?.daysLeft);
  if (
    !state?.eligible ||
    !Number.isFinite(amount) ||
    amount <= 0 ||
    !Number.isInteger(daysLeft) ||
    daysLeft <= 0 ||
    state.expiresOn !== payload.bonusExpiresOn ||
    !Number.isFinite(Date.parse(state.deliveryExpiresAt)) ||
    Date.parse(state.deliveryExpiresAt) <= now.getTime()
  )
    return null;
  const copy = reminderCopy({
    amount,
    daysLeft,
    expiresOn: state.expiresOn,
    language: state.language,
  });
  return {
    ...row,
    title: copy.title,
    body: copy.body,
    data: {
      ...payload,
      language: copy.language,
      amount,
      daysLeft,
      bonusExpiresAt: state.expiresAt,
      reminderExpiresAt: state.deliveryExpiresAt,
    },
  };
}

function bonusExpiryReminderTiming(data, now = new Date()) {
  const expiresMs = Date.parse(String(data.reminderExpiresAt || ''));
  const valid =
    data.reminderVersion === 'credit-lots-v1' &&
    REMINDER_DAYS.includes(Number(data.reminderDays)) &&
    Number(data.amount) > 0 &&
    Number.isFinite(expiresMs) &&
    expiresMs > now.getTime();
  return { state: valid ? 'ready' : 'expired', expiresMs };
}

module.exports = {
  BONUS_EXPIRY_REMINDER_TYPE,
  REMINDER_DAYS,
  bonusExpiryReminderTiming,
  prepareBonusExpiryReminder,
  reminderCopy,
  runBonusExpiryReminders,
};

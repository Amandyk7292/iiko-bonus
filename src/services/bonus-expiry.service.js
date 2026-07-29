const { supabase } = require('../config/supabase');
const { getSettings } = require('./settings.service');

const DAY_MS = 24 * 60 * 60 * 1000;
const CREDIT_TYPES = new Set([
  'deposit',
  'pending_deposit',
  'manual_deposit',
  'manual',
  'refund_bonus_restore',
]);
const DEBIT_TYPES = new Set(['withdrawal', 'manual_withdrawal', 'expiration', 'refund_reversal']);

const transactionTime = (transaction) => {
  const value = transaction?.activated_at || transaction?.available_at || transaction?.timestamp;
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

const consumeLots = (lots, requestedAmount) => {
  let remaining = Math.max(0, Number(requestedAmount) || 0);
  lots.sort((left, right) => {
    const leftExpiry = left.expiresAt ? Date.parse(left.expiresAt) : Number.POSITIVE_INFINITY;
    const rightExpiry = right.expiresAt ? Date.parse(right.expiresAt) : Number.POSITIVE_INFINITY;
    return leftExpiry - rightExpiry || left.createdAt - right.createdAt;
  });
  for (const lot of lots) {
    if (remaining <= 0) break;
    const consumed = Math.min(lot.amount, remaining);
    lot.amount -= consumed;
    remaining -= consumed;
  }
};

const buildExpirySummary = ({
  balance,
  transactions,
  days = 30,
  now = new Date(),
  fallbackExpiryAt = null,
}) => {
  const nowMs = now.getTime();
  const horizonMs = nowMs + days * DAY_MS;
  const lots = [];
  let hasExplicitExpiry = false;
  for (const transaction of [...transactions].sort(
    (left, right) => transactionTime(left) - transactionTime(right),
  )) {
    const rawAmount = Number(transaction.amount || 0);
    const amount = Math.abs(rawAmount);
    if (!Number.isFinite(amount) || amount === 0) continue;
    const type = String(transaction.type || '').toLowerCase();
    const availableValue = transaction.available_at || transaction.activated_at;
    const availableAt = availableValue ? Date.parse(availableValue) : Number.NaN;
    const isCredit = CREDIT_TYPES.has(type) || (!type && rawAmount > 0);
    const isDebit = DEBIT_TYPES.has(type) || (!type && rawAmount < 0);
    if (isCredit && Number.isFinite(availableAt) && availableAt > nowMs) continue;
    if (isCredit && !transaction.expired_at) {
      if (transaction.expires_at) hasExplicitExpiry = true;
      lots.push({
        amount,
        expiresAt: transaction.expires_at || null,
        createdAt: transactionTime(transaction),
      });
    } else if (isDebit) {
      consumeLots(lots, amount);
    }
  }

  const liveTotal = lots.reduce((total, lot) => total + Math.max(0, lot.amount), 0);
  const currentBalance = Math.max(0, Number(balance) || 0);
  if (liveTotal > currentBalance) consumeLots(lots, liveTotal - currentBalance);

  const grouped = new Map();
  for (const lot of lots) {
    const expiresAtMs = Date.parse(lot.expiresAt || '');
    if (
      lot.amount <= 0 ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= nowMs ||
      expiresAtMs > horizonMs
    ) {
      continue;
    }
    const date = new Date(expiresAtMs).toISOString().slice(0, 10);
    const current = grouped.get(date) || {
      expiresAt: new Date(expiresAtMs).toISOString(),
      amount: 0,
    };
    current.amount += lot.amount;
    if (expiresAtMs < Date.parse(current.expiresAt)) {
      current.expiresAt = new Date(expiresAtMs).toISOString();
    }
    grouped.set(date, current);
  }
  const fallbackExpiryMs = Date.parse(fallbackExpiryAt || '');
  if (
    !hasExplicitExpiry &&
    currentBalance > 0 &&
    Number.isFinite(fallbackExpiryMs) &&
    fallbackExpiryMs > nowMs &&
    fallbackExpiryMs <= horizonMs
  ) {
    const date = new Date(fallbackExpiryMs).toISOString().slice(0, 10);
    grouped.set(date, {
      expiresAt: new Date(fallbackExpiryMs).toISOString(),
      amount: currentBalance,
    });
  }
  const buckets = [...grouped.values()]
    .sort((left, right) => Date.parse(left.expiresAt) - Date.parse(right.expiresAt))
    .map((bucket) => ({
      expiresAt: bucket.expiresAt,
      amount: Number(bucket.amount.toFixed(2)),
      daysRemaining: Math.max(1, Math.ceil((Date.parse(bucket.expiresAt) - nowMs) / DAY_MS)),
    }));
  return {
    currentBalance,
    totalExpiring: Number(buckets.reduce((total, bucket) => total + bucket.amount, 0).toFixed(2)),
    nextExpiryAt: buckets[0]?.expiresAt || null,
    buckets,
  };
};

async function getBonusExpirySummary(customerId, { days = 30 } = {}) {
  const [customerResult, transactionResult, settings] = await Promise.all([
    supabase.from('customers').select('id,balance,created_at').eq('id', customerId).maybeSingle(),
    supabase
      .from('transactions')
      .select('amount,type,timestamp,available_at,activated_at,expires_at,expired_at')
      .eq('customer_id', customerId)
      .order('timestamp', { ascending: true })
      .limit(5000),
    getSettings(),
  ]);
  if (customerResult.error) throw customerResult.error;
  if (!customerResult.data) {
    throw Object.assign(new Error('Клиент не найден'), { statusCode: 404 });
  }
  if (transactionResult.error) throw transactionResult.error;
  const transactions = transactionResult.data || [];
  const expiration = settings?.bonus_expiration || {};
  const latestActivity = [...transactions]
    .reverse()
    .find((transaction) => !['churn_reminder', 'expiration'].includes(transaction.type));
  const lastActivityAt =
    transactionTime(latestActivity || {}) ||
    Date.parse(customerResult.data.created_at || '') ||
    Date.now();
  const expirationDays = Math.max(1, Number(expiration.expiration_days || 90));
  const fallbackExpiryAt =
    expiration.enabled === false
      ? null
      : new Date(lastActivityAt + expirationDays * DAY_MS).toISOString();
  return buildExpirySummary({
    balance: customerResult.data.balance,
    transactions,
    days,
    fallbackExpiryAt,
  });
}

module.exports = { buildExpirySummary, getBonusExpirySummary };

const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');
const { parseMoney } = require('../utils/money.util');
const { getSettings } = require('./settings.service');
const { getActiveLoyaltyTiers } = require('./tier.service');
const { getTierInfo } = require('../utils/tier.util');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const POS_LIMIT_DEFAULTS = Object.freeze({
  maxOrderTotal: 250_000,
  maxDiscountAmount: 100_000,
  maxEarnedBonus: 25_000,
  branchRollingOrderCount: 2_000,
  branchRollingOrderTotal: 25_000_000,
  branchRollingDiscountAmount: 2_000_000,
  branchRollingEarnedBonus: 1_250_000,
});
const posSafetyCounters = { rolling: 0, transaction: 0 };

const reservationError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const customerId = (value) => {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw reservationError('customerId must be a valid UUID');
  return normalized;
};

const reservationId = (value) => {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) throw reservationError('reservationId must be a valid UUID');
  return normalized;
};

const branchId = (value) => {
  const normalized = String(value || '').trim();
  if (!UUID_PATTERN.test(normalized)) {
    throw reservationError('Branch POS authentication is required', 401);
  }
  return normalized.toLowerCase();
};

const orderId = (value) => {
  const normalized = String(value || '').trim();
  if (
    !normalized ||
    normalized.length > 200 ||
    [...normalized].some((character) => character.charCodeAt(0) < 32)
  ) {
    throw reservationError('orderId must contain 1-200 printable characters');
  }
  return normalized;
};

const scopedOrder = (rawOrderId, rawBranchId, { allowLegacy = false } = {}) => {
  const original = orderId(rawOrderId);
  if (!rawBranchId && allowLegacy) {
    return { branch: null, original, scoped: original, legacy: true };
  }
  const branch = branchId(rawBranchId);
  const digest = crypto.createHash('sha256').update(`${branch}\0${original}`, 'utf8').digest('hex');
  return { branch, original, scoped: `bp1:${branch}:${digest}`, legacy: false };
};

const boundedLimit = (value, fallback, { integer = false, maximum = 100_000_000 } = {}) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0 || parsed > maximum) return fallback;
  return integer ? Math.floor(parsed) : Number(parsed.toFixed(2));
};

const posLoyaltyLimits = (env = process.env) => ({
  maxOrderTotal: boundedLimit(env.LOYALTY_POS_MAX_ORDER_TOTAL, POS_LIMIT_DEFAULTS.maxOrderTotal),
  maxDiscountAmount: boundedLimit(
    env.LOYALTY_POS_MAX_DISCOUNT_AMOUNT,
    POS_LIMIT_DEFAULTS.maxDiscountAmount,
  ),
  maxEarnedBonus: boundedLimit(env.LOYALTY_POS_MAX_EARNED_BONUS, POS_LIMIT_DEFAULTS.maxEarnedBonus),
  branchRollingOrderCount: boundedLimit(
    env.LOYALTY_POS_BRANCH_ROLLING_ORDER_COUNT,
    POS_LIMIT_DEFAULTS.branchRollingOrderCount,
    { integer: true, maximum: 100_000 },
  ),
  branchRollingOrderTotal: boundedLimit(
    env.LOYALTY_POS_BRANCH_ROLLING_ORDER_TOTAL,
    POS_LIMIT_DEFAULTS.branchRollingOrderTotal,
  ),
  branchRollingDiscountAmount: boundedLimit(
    env.LOYALTY_POS_BRANCH_ROLLING_DISCOUNT_AMOUNT,
    POS_LIMIT_DEFAULTS.branchRollingDiscountAmount,
  ),
  branchRollingEarnedBonus: boundedLimit(
    env.LOYALTY_POS_BRANCH_ROLLING_EARNED_BONUS,
    POS_LIMIT_DEFAULTS.branchRollingEarnedBonus,
  ),
});

const recordPosSafetyRejection = (kind, branch) => {
  posSafetyCounters[kind] += 1;
  logger.warn(
    {
      event: 'loyalty_pos_safety_limit_rejected',
      kind,
      branchId: branch || null,
    },
    'POS loyalty safety limit rejected a request',
  );
};

const posLoyaltySafetySnapshot = () => ({ ...posSafetyCounters });

const assertPosTransactionLimits = (
  { orderTotal, discountAmount = 0, earnedBonus = 0 },
  limits = posLoyaltyLimits(),
  { branch = null } = {},
) => {
  if (Number(orderTotal) > limits.maxOrderTotal) {
    recordPosSafetyRejection('transaction', branch);
    throw reservationError('Order total exceeds the POS safety limit', 422);
  }
  if (Number(discountAmount) > limits.maxDiscountAmount) {
    recordPosSafetyRejection('transaction', branch);
    throw reservationError('Discount exceeds the POS safety limit', 422);
  }
  if (Number(earnedBonus) > limits.maxEarnedBonus) {
    recordPosSafetyRejection('transaction', branch);
    throw reservationError('Earned bonus exceeds the POS safety limit', 422);
  }
};

const assertItemTotals = (items, orderTotal, discountAmount) => {
  if (!Array.isArray(items) || items.length === 0) return;
  let itemTotal = 0;
  for (const item of items) {
    const quantity = Number(item.amount);
    const price = Number(item.price);
    const total = Number(item.total);
    const lineTolerance = Math.max(0.05, Math.abs(quantity) * 0.02);
    if (
      !Number.isFinite(quantity) ||
      !Number.isFinite(price) ||
      !Number.isFinite(total) ||
      Math.abs(quantity * price - total) > lineTolerance
    ) {
      throw reservationError('Order item totals do not match', 409);
    }
    itemTotal += total;
  }
  const total = Number(orderTotal);
  const paidAfterLoyalty = Math.max(0, total - Number(discountAmount || 0));
  const orderTolerance = Math.max(1, items.length * 0.05);
  if (
    Math.abs(itemTotal - total) > orderTolerance &&
    Math.abs(itemTotal - paidAfterLoyalty) > orderTolerance
  ) {
    throw reservationError('Order items do not match the reserved total', 409);
  }
};

const mapRpcError = (error, { branch = null } = {}) => {
  const message = String(error?.message || 'Loyalty reservation failed');
  if (message.includes('customer not found')) return reservationError('Customer not found', 404);
  if (message.includes('reservation not found'))
    return reservationError('Reservation not found', 404);
  if (
    message.includes('already belongs') ||
    message.includes('already committed') ||
    message.includes('committed reservation') ||
    message.includes('is not active')
  ) {
    return reservationError(message, 409);
  }
  if (message.includes('discount exceeds')) {
    return reservationError('discountAmount exceeds available balance', 409);
  }
  if (message.includes('branch loyalty claim conflict')) {
    return reservationError('Branch loyalty claim does not match the reservation', 409);
  }
  if (message.includes('branch loyalty rolling limit exceeded')) {
    recordPosSafetyRejection('rolling', branch);
    return reservationError('Branch loyalty rolling safety limit exceeded', 429);
  }
  if (message.includes('branch loyalty transaction limit exceeded')) {
    recordPosSafetyRejection('transaction', branch);
    return reservationError('Loyalty transaction exceeds the POS safety limit', 422);
  }
  if (message.includes('invalid loyalty')) return reservationError('Invalid reservation values');
  return error;
};

async function reserveLoyalty(
  payload = {},
  { branchId: authenticatedBranchId, allowLegacy = false } = {},
) {
  const normalizedCustomerId = customerId(payload.customerId);
  const normalizedOrder = scopedOrder(payload.orderId, authenticatedBranchId, { allowLegacy });
  const total = parseMoney(payload.orderTotal, 'orderTotal');
  const discount = parseMoney(payload.discountAmount || 0, 'discountAmount');
  const limits = posLoyaltyLimits();
  assertPosTransactionLimits({ orderTotal: total, discountAmount: discount }, limits, {
    branch: normalizedOrder.branch,
  });
  const settings = await getSettings();
  const maxDiscountPercent = Number(settings.max_discount_percent || 0);
  const rpcName = normalizedOrder.legacy
    ? 'reserve_loyalty_balance'
    : 'reserve_branch_loyalty_balance';
  const { data, error } = await supabase.rpc(rpcName, {
    p_customer_id: normalizedCustomerId,
    p_order_id: normalizedOrder.scoped,
    p_order_total: total,
    p_discount_amount: discount,
    p_max_discount_percent: maxDiscountPercent,
    p_ttl_hours: 24,
    ...(!normalizedOrder.legacy && {
      p_branch_id: normalizedOrder.branch,
      p_max_order_total: limits.maxOrderTotal,
      p_max_discount_amount: limits.maxDiscountAmount,
      p_rolling_order_count: limits.branchRollingOrderCount,
      p_rolling_order_total: limits.branchRollingOrderTotal,
      p_rolling_discount_amount: limits.branchRollingDiscountAmount,
    }),
  });
  if (error) throw mapRpcError(error, { branch: normalizedOrder.branch });
  return {
    success: true,
    reservationId: data.reservation_id,
    orderId: normalizedOrder.original,
    customerId: data.customer_id,
    discountAmount: Number(data.discount_amount || 0),
    availableBalance: Number(data.available_balance || 0),
    maxDiscountPercent: Number(data.max_discount_percent || maxDiscountPercent),
    expiresAt: data.expires_at,
    duplicate: Boolean(data.duplicate),
  };
}

async function commitLoyalty(
  payload = {},
  { branchId: authenticatedBranchId, allowLegacy = false } = {},
) {
  const normalizedCustomerId = customerId(payload.customerId);
  const normalizedOrder = scopedOrder(payload.orderId, authenticatedBranchId, { allowLegacy });
  const normalizedReservationId = reservationId(payload.reservationId);
  const total = parseMoney(payload.orderTotal, 'orderTotal');
  if (payload.items !== undefined && payload.items !== null && !Array.isArray(payload.items)) {
    throw reservationError('items must be an array');
  }
  if (Array.isArray(payload.items) && payload.items.length > 500) {
    throw reservationError('items must not contain more than 500 entries');
  }
  const [{ data: customer, error: customerError }, settings] = await Promise.all([
    supabase.from('customers').select('total_spent').eq('id', normalizedCustomerId).maybeSingle(),
    getSettings(),
  ]);
  if (customerError) throw customerError;
  if (!customer) throw reservationError('Customer not found', 404);
  const tiers = await getActiveLoyaltyTiers(settings);
  const tier = getTierInfo(customer.total_spent, tiers, settings);

  const { data: reservation, error: reservationReadError } = await supabase
    .from('loyalty_reservations')
    .select('discount_amount,order_total,status')
    .eq('id', normalizedReservationId)
    .eq('customer_id', normalizedCustomerId)
    .eq('order_id', normalizedOrder.scoped)
    .maybeSingle();
  if (reservationReadError) throw reservationReadError;
  if (!reservation) throw reservationError('Reservation not found', 404);
  if (Math.abs(Number(reservation.order_total) - total) > 0.001) {
    throw reservationError('Order total does not match the reservation', 409);
  }
  const discount = Number(reservation.discount_amount || 0);
  if (
    !normalizedOrder.legacy &&
    total > 0 &&
    (!Array.isArray(payload.items) || !payload.items.length)
  ) {
    throw reservationError('Order items are required for branch-authenticated commits', 409);
  }
  assertItemTotals(payload.items, total, discount);
  const paid = Math.max(0, total - discount);
  const earnedBonus = Number((paid * (Number(tier.percent || 0) / 100)).toFixed(2));
  const limits = posLoyaltyLimits();
  assertPosTransactionLimits({ orderTotal: total, discountAmount: discount, earnedBonus }, limits, {
    branch: normalizedOrder.branch,
  });
  const activationDelayDays =
    settings.bonus_activation?.enabled === false
      ? 0
      : Number(settings.bonus_activation?.delay_days || 0);
  const rpcName = normalizedOrder.legacy
    ? 'commit_loyalty_reservation'
    : 'commit_branch_loyalty_reservation';
  const { data, error } = await supabase.rpc(rpcName, {
    p_customer_id: normalizedCustomerId,
    p_order_id: normalizedOrder.scoped,
    p_reservation_id: normalizedReservationId,
    p_order_total: total,
    p_earned_bonus: earnedBonus,
    p_activation_delay_days: activationDelayDays,
    p_items: payload.items || [],
    ...(!normalizedOrder.legacy && {
      p_branch_id: normalizedOrder.branch,
      p_max_order_total: limits.maxOrderTotal,
      p_max_discount_amount: limits.maxDiscountAmount,
      p_max_earned_bonus: limits.maxEarnedBonus,
      p_rolling_earned_bonus: limits.branchRollingEarnedBonus,
    }),
  });
  if (error) throw mapRpcError(error, { branch: normalizedOrder.branch });
  return {
    success: true,
    newBalance: Number(data.balance || 0),
    discountApplied: Number(data.discount_applied || 0),
    earnedBonus: Number(data.earned_bonus || 0),
    duplicate: Boolean(data.duplicate),
  };
}

async function cancelLoyalty(
  payload = {},
  { branchId: authenticatedBranchId, allowLegacy = false } = {},
) {
  const normalizedCustomerId = customerId(payload.customerId);
  const normalizedOrder = scopedOrder(payload.orderId, authenticatedBranchId, { allowLegacy });
  const normalizedReservationId = reservationId(payload.reservationId);
  const rpcName = normalizedOrder.legacy
    ? 'cancel_loyalty_reservation'
    : 'cancel_branch_loyalty_reservation';
  const { data, error } = await supabase.rpc(rpcName, {
    p_customer_id: normalizedCustomerId,
    p_order_id: normalizedOrder.scoped,
    p_reservation_id: normalizedReservationId,
    ...(!normalizedOrder.legacy && { p_branch_id: normalizedOrder.branch }),
  });
  if (error) throw mapRpcError(error, { branch: normalizedOrder.branch });
  return { success: true, duplicate: Boolean(data.duplicate), status: data.status };
}

module.exports = {
  assertPosTransactionLimits,
  assertItemTotals,
  cancelLoyalty,
  commitLoyalty,
  posLoyaltyLimits,
  posLoyaltySafetySnapshot,
  reserveLoyalty,
  scopedOrder,
};

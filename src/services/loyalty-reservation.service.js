const { supabase } = require('../config/supabase');
const { parseMoney } = require('../utils/money.util');
const { getSettings } = require('./settings.service');
const { getActiveLoyaltyTiers } = require('./tier.service');
const { getTierInfo } = require('../utils/tier.util');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

const mapRpcError = (error) => {
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
  if (message.includes('invalid loyalty')) return reservationError('Invalid reservation values');
  return error;
};

async function reserveLoyalty(payload = {}) {
  const normalizedCustomerId = customerId(payload.customerId);
  const normalizedOrderId = orderId(payload.orderId);
  const total = parseMoney(payload.orderTotal, 'orderTotal');
  const discount = parseMoney(payload.discountAmount || 0, 'discountAmount');
  const settings = await getSettings();
  const maxDiscountPercent = Number(settings.max_discount_percent || 0);
  const { data, error } = await supabase.rpc('reserve_loyalty_balance', {
    p_customer_id: normalizedCustomerId,
    p_order_id: normalizedOrderId,
    p_order_total: total,
    p_discount_amount: discount,
    p_max_discount_percent: maxDiscountPercent,
    p_ttl_hours: 24,
  });
  if (error) throw mapRpcError(error);
  return {
    success: true,
    reservationId: data.reservation_id,
    orderId: data.order_id,
    customerId: data.customer_id,
    discountAmount: Number(data.discount_amount || 0),
    availableBalance: Number(data.available_balance || 0),
    maxDiscountPercent: Number(data.max_discount_percent || maxDiscountPercent),
    expiresAt: data.expires_at,
    duplicate: Boolean(data.duplicate),
  };
}

async function commitLoyalty(payload = {}) {
  const normalizedCustomerId = customerId(payload.customerId);
  const normalizedOrderId = orderId(payload.orderId);
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
    .select('discount_amount,status')
    .eq('id', normalizedReservationId)
    .eq('customer_id', normalizedCustomerId)
    .eq('order_id', normalizedOrderId)
    .maybeSingle();
  if (reservationReadError) throw reservationReadError;
  if (!reservation) throw reservationError('Reservation not found', 404);
  const discount = Number(reservation.discount_amount || 0);
  const paid = Math.max(0, total - discount);
  const earnedBonus = Number((paid * (Number(tier.percent || 0) / 100)).toFixed(2));
  const activationDelayDays =
    settings.bonus_activation?.enabled === false
      ? 0
      : Number(settings.bonus_activation?.delay_days || 0);
  const { data, error } = await supabase.rpc('commit_loyalty_reservation', {
    p_customer_id: normalizedCustomerId,
    p_order_id: normalizedOrderId,
    p_reservation_id: normalizedReservationId,
    p_order_total: total,
    p_earned_bonus: earnedBonus,
    p_activation_delay_days: activationDelayDays,
    p_items: payload.items || null,
  });
  if (error) throw mapRpcError(error);
  return {
    success: true,
    newBalance: Number(data.balance || 0),
    discountApplied: Number(data.discount_applied || 0),
    earnedBonus: Number(data.earned_bonus || 0),
    duplicate: Boolean(data.duplicate),
  };
}

async function cancelLoyalty(payload = {}) {
  const normalizedCustomerId = customerId(payload.customerId);
  const normalizedOrderId = orderId(payload.orderId);
  const normalizedReservationId = reservationId(payload.reservationId);
  const { data, error } = await supabase.rpc('cancel_loyalty_reservation', {
    p_customer_id: normalizedCustomerId,
    p_order_id: normalizedOrderId,
    p_reservation_id: normalizedReservationId,
  });
  if (error) throw mapRpcError(error);
  return { success: true, duplicate: Boolean(data.duplicate), status: data.status };
}

module.exports = { cancelLoyalty, commitLoyalty, reserveLoyalty };

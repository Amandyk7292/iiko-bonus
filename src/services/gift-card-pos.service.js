const { supabase } = require('../config/supabase');
const { giftHash } = require('./gift-certificate-purchase.service');

const posError = (message, statusCode = 400, code = 'GIFT_CARD_POS_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

async function assertActiveBranch(branchId) {
  const { data, error } = await supabase
    .from('bulka_locations')
    .select('id')
    .eq('id', branchId)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw posError('Branch not found', 404, 'GIFT_CARD_BRANCH_NOT_FOUND');
}

async function validateGiftCardForPos({ code, branchId }) {
  await assertActiveBranch(branchId);
  const { data: card, error } = await supabase
    .from('gift_cards')
    .select('id,code_last4,balance,active,expires_at')
    .eq('code_hash', giftHash(code))
    .maybeSingle();
  if (error) throw error;
  if (
    !card ||
    card.active !== true ||
    Number(card.balance || 0) <= 0 ||
    (card.expires_at && Date.parse(card.expires_at) <= Date.now())
  ) {
    throw posError('Gift card not found or unavailable', 404, 'GIFT_CARD_NOT_AVAILABLE');
  }
  const { data: reservations, error: reservationError } = await supabase
    .from('gift_card_pos_reservations')
    .select('amount')
    .eq('gift_card_id', card.id)
    .eq('status', 'active')
    .gt('expires_at', new Date().toISOString());
  if (reservationError) throw reservationError;
  const reserved = (reservations || []).reduce(
    (total, reservation) => total + Number(reservation.amount || 0),
    0,
  );
  return {
    id: String(card.id),
    last4: card.code_last4,
    balance: Number(card.balance),
    availableBalance: Math.max(0, Number(card.balance) - reserved),
    currency: 'KZT',
    expiresAt: card.expires_at || null,
  };
}

const mapPosError = (error) => {
  const message = String(error.message || '');
  if (
    error?.code === '23505' ||
    /duplicate key.*(?:request_id|commit_request_id|cancel_request_id)/i.test(message) ||
    /idempotency.*(used|conflict)/i.test(message)
  ) {
    return posError(
      'Idempotency key already belongs to another operation',
      409,
      'GIFT_CARD_IDEMPOTENCY_CONFLICT',
    );
  }
  if (/insufficient balance/i.test(message)) {
    return posError('Gift card balance is insufficient', 409, 'GIFT_CARD_INSUFFICIENT_BALANCE');
  }
  if (/reservation expired/i.test(message)) {
    return posError('Gift card reservation expired', 409, 'GIFT_CARD_RESERVATION_EXPIRED');
  }
  if (/already committed/i.test(message)) {
    return posError(
      'Gift card reservation is already committed',
      409,
      'GIFT_CARD_ALREADY_COMMITTED',
    );
  }
  if (/reservation not found/i.test(message)) {
    return posError('Gift card reservation not found', 404, 'GIFT_CARD_RESERVATION_NOT_FOUND');
  }
  if (/expired/i.test(message)) {
    return posError('Gift card expired', 409, 'GIFT_CARD_EXPIRED');
  }
  if (/not found/i.test(message)) {
    return posError('Gift card not found or unavailable', 404, 'GIFT_CARD_NOT_AVAILABLE');
  }
  return error;
};

async function reserveGiftCardForPos({
  code,
  branchId,
  iikoOrderId,
  amount,
  idempotencyKey,
  ttlMinutes = 20,
}) {
  await assertActiveBranch(branchId);
  const { data, error } = await supabase.rpc('reserve_gift_card_for_iiko', {
    p_code_hash: giftHash(code),
    p_branch_id: branchId,
    p_iiko_order_id: iikoOrderId,
    p_amount: amount,
    p_request_id: idempotencyKey,
    p_ttl_minutes: ttlMinutes,
  });
  if (error) throw mapPosError(error);
  return {
    id: String(data.reservationId),
    status: data.status,
    duplicate: data.duplicate === true,
    giftCardId: String(data.giftCardId),
    amount: Number(data.amount),
    availableBalance: Number(data.availableBalance),
    expiresAt: data.expiresAt,
    branchId: String(branchId),
    iikoOrderId: String(iikoOrderId),
  };
}

async function commitGiftCardForPos({ reservationId, idempotencyKey }) {
  const { data, error } = await supabase.rpc('commit_gift_card_for_iiko', {
    p_reservation_id: reservationId,
    p_request_id: idempotencyKey,
  });
  if (error) throw mapPosError(error);
  return {
    id: String(data.reservationId),
    status: data.status,
    duplicate: data.duplicate === true,
    giftCardId: String(data.giftCardId),
    amount: Number(data.amount),
    balanceAfter: Number(data.balanceAfter),
    committedAt: data.committedAt,
  };
}

async function cancelGiftCardForPos({ reservationId, idempotencyKey }) {
  const { data, error } = await supabase.rpc('cancel_gift_card_for_iiko', {
    p_reservation_id: reservationId,
    p_request_id: idempotencyKey,
  });
  if (error) throw mapPosError(error);
  return {
    id: String(data.reservationId),
    status: data.status,
    duplicate: data.duplicate === true,
    cancelledAt: data.cancelledAt,
  };
}

module.exports = {
  cancelGiftCardForPos,
  commitGiftCardForPos,
  reserveGiftCardForPos,
  validateGiftCardForPos,
};

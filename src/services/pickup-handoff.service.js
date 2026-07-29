const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { credentialHash, decryptSecret, encryptSecret } = require('../utils/secret-envelope.util');
const { effectiveFulfillmentType } = require('../utils/fulfillment.util');
const { releaseOrderReservations } = require('./inventory.service');
const realtime = require('./realtime.service');

const HANDOFF_TTL_MS = 4 * 60 * 60 * 1000;

const handoffError = (message, statusCode = 400, code = 'PICKUP_HANDOFF_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

const handoffAad = (orderId, handoffId) => `pickup:${orderId}:${handoffId}`;
const tokenHash = (value) => credentialHash(value, 'pickup-token');
const pinHash = (value) => credentialHash(value, 'pickup-pin');

const eligibility = (order) => {
  if (!order) return { eligible: false, reason: 'not_found' };
  if (order.order_kind && order.order_kind !== 'product') {
    return { eligible: false, reason: 'not_pickup_order' };
  }
  if (effectiveFulfillmentType(order) === 'delivery') {
    return { eligible: false, reason: 'delivery_order' };
  }
  if (order.status !== 'paid') {
    return { eligible: false, reason: 'not_paid' };
  }
  if (order.fulfillment_status === 'completed') {
    return { eligible: false, reason: 'already_collected' };
  }
  if (order.fulfillment_status !== 'ready') {
    return { eligible: false, reason: 'not_ready' };
  }
  return { eligible: true, reason: null };
};

const buildSecrets = (orderId, handoffId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const pin = crypto.randomInt(0, 1_000_000).toString().padStart(6, '0');
  const aad = handoffAad(orderId, handoffId);
  return {
    token,
    pin,
    token_hash: tokenHash(token),
    pin_hash: pinHash(pin),
    token_ciphertext: encryptSecret(token, { purpose: 'pickup-token', aad }),
    pin_ciphertext: encryptSecret(pin, { purpose: 'pickup-pin', aad }),
  };
};

const serializeHandoff = (row) => {
  const aad = handoffAad(row.order_id, row.id);
  const token = decryptSecret(row.token_ciphertext, { purpose: 'pickup-token', aad });
  const pin = decryptSecret(row.pin_ciphertext, { purpose: 'pickup-pin', aad });
  return {
    orderId: String(row.order_id),
    qrPayload: `bulka:pickup:${row.order_id}:${token}`,
    pin,
    expiresAt: row.expires_at,
    usedAt: row.used_at || null,
  };
};

async function getPickupHandoff(customerId, orderId) {
  const { data: order, error } = await supabase
    .from('kaspi_orders')
    .select(
      'id,customer_id,status,order_kind,fulfillment_type,preorder_fulfillment_type,fulfillment_status',
    )
    .eq('id', orderId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!order) {
    throw handoffError('Заказ не найден', 404, 'PICKUP_ORDER_NOT_FOUND');
  }
  const state = eligibility(order);
  if (!state.eligible) {
    return { ...state, handoff: null };
  }

  const { data: existing, error: existingError } = await supabase
    .from('pickup_order_handoffs')
    .select('*')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing?.used_at) {
    return { eligible: false, reason: 'already_collected', handoff: null };
  }
  if (existing && Date.parse(existing.expires_at) > Date.now()) {
    return { eligible: true, reason: null, handoff: serializeHandoff(existing) };
  }

  const handoffId = existing?.id || crypto.randomUUID();
  const secrets = buildSecrets(orderId, handoffId);
  const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS).toISOString();
  let saved;
  if (existing) {
    const { data, error: updateError } = await supabase
      .from('pickup_order_handoffs')
      .update({
        ...secrets,
        expires_at: expiresAt,
        pin_failed_attempts: 0,
        pin_locked_until: null,
        last_pin_attempt_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', handoffId)
      .is('used_at', null)
      .eq('updated_at', existing.updated_at)
      .select('*')
      .maybeSingle();
    if (updateError) throw updateError;
    if (data) {
      saved = data;
    } else {
      const { data: raced, error: racedError } = await supabase
        .from('pickup_order_handoffs')
        .select('*')
        .eq('id', handoffId)
        .single();
      if (racedError) throw racedError;
      if (raced.used_at) {
        return { eligible: false, reason: 'already_collected', handoff: null };
      }
      saved = raced;
    }
  } else {
    const { data, error: insertError } = await supabase
      .from('pickup_order_handoffs')
      .insert({
        id: handoffId,
        order_id: orderId,
        ...secrets,
        expires_at: expiresAt,
      })
      .select('*')
      .single();
    if (insertError?.code === '23505') {
      const { data: raced, error: racedError } = await supabase
        .from('pickup_order_handoffs')
        .select('*')
        .eq('order_id', orderId)
        .single();
      if (racedError) throw racedError;
      saved = raced;
    } else if (insertError) {
      throw insertError;
    } else {
      saved = data;
    }
  }
  return { eligible: true, reason: null, handoff: serializeHandoff(saved) };
}

const parseQrPayload = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/^bulka:pickup:([0-9a-f-]{36}):([A-Za-z0-9_-]{32,100})$/i);
  if (!match) {
    throw handoffError('Некорректный QR-код выдачи', 409, 'PICKUP_QR_INVALID');
  }
  return { orderId: match[1], token: match[2] };
};

const parseToken = (value, expectedOrderId) => {
  const raw = String(value || '').trim();
  if (!raw.startsWith('bulka:pickup:')) return raw;
  const parsed = parseQrPayload(raw);
  if (parsed.orderId.toLowerCase() !== String(expectedOrderId).toLowerCase()) {
    throw handoffError('QR-код относится к другому заказу', 409, 'PICKUP_QR_ORDER_MISMATCH');
  }
  return parsed.token;
};

async function verifyPickupHandoff({
  orderId,
  branchId = null,
  token = null,
  pin = null,
  verifiedBy,
}) {
  const { data: order, error: orderError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (orderError) throw orderError;
  if (!order || (branchId && String(order.branch_id || '') !== String(branchId))) {
    throw handoffError('Заказ не найден в выбранном филиале', 404, 'PICKUP_ORDER_NOT_FOUND');
  }
  const parsedToken = token ? parseToken(token, orderId) : null;
  const { data, error } = await supabase.rpc('verify_pickup_order_handoff', {
    p_order_id: orderId,
    p_token_hash: parsedToken ? tokenHash(parsedToken) : null,
    p_pin_hash: pin ? pinHash(pin) : null,
    p_verified_by: verifiedBy,
  });
  if (error) {
    const message = String(error.message || '');
    if (/already used/i.test(message)) {
      throw handoffError('Заказ уже был выдан', 409, 'PICKUP_HANDOFF_ALREADY_USED');
    }
    if (/expired/i.test(message)) {
      throw handoffError(
        'Код выдачи истёк. Клиенту нужно обновить экран.',
        409,
        'PICKUP_HANDOFF_EXPIRED',
      );
    }
    if (/invalid/i.test(message)) {
      throw handoffError('Неверный QR-код или PIN', 409, 'PICKUP_HANDOFF_INVALID');
    }
    if (/not ready/i.test(message)) {
      throw handoffError('Заказ ещё не готов к выдаче', 409, 'PICKUP_ORDER_NOT_READY');
    }
    throw error;
  }
  if (data?.status === 'locked') {
    const locked = handoffError(
      'Слишком много неверных попыток. Повторите через 15 минут.',
      429,
      'PICKUP_HANDOFF_PIN_LOCKED',
    );
    locked.retryAt = data.retryAt || null;
    throw locked;
  }
  if (data?.status === 'invalid') {
    const invalid = handoffError('Неверный QR-код или PIN', 409, 'PICKUP_HANDOFF_INVALID');
    invalid.attemptsRemaining =
      data.attemptsRemaining == null ? null : Number(data.attemptsRemaining);
    throw invalid;
  }
  if (data?.status !== 'verified') {
    throw handoffError(
      'Не удалось подтвердить выдачу. Обновите заказ и повторите.',
      409,
      'PICKUP_HANDOFF_CONFLICT',
    );
  }
  await releaseOrderReservations(orderId).catch((releaseError) =>
    console.error('Pickup handoff reservation release failed:', releaseError.message),
  );
  const { data: completed, error: completedError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .single();
  if (completedError) throw completedError;
  realtime.publish(
    'order.updated',
    {
      orderId,
      orderNumber: completed.order_number,
      orderStatus: 'completed',
      pickupVerifiedAt: data.verifiedAt,
    },
    {
      customerId: completed.customer_id,
      includeAdmins: true,
      branchId: completed.branch_id,
    },
  );
  const { notifyOrderStatus } = require('./customer-order.service');
  await notifyOrderStatus(completed).catch((notificationError) =>
    console.error('Pickup completion notification failed:', notificationError.message),
  );
  return {
    orderId: String(orderId),
    orderNumber: Number(completed.order_number),
    orderStatus: 'completed',
    verifiedAt: data.verifiedAt,
  };
}

async function verifyPluginPickupHandoff({
  branchId,
  token = null,
  pin = null,
  orderNumber = null,
  iikoOrderId = null,
}) {
  let orderId;
  if (token) {
    orderId = parseQrPayload(token).orderId;
  } else {
    const { data: order, error } = await supabase
      .from('kaspi_orders')
      .select('id')
      .eq('branch_id', branchId)
      .eq('order_number', orderNumber)
      .maybeSingle();
    if (error) throw error;
    if (!order) {
      throw handoffError('Заказ не найден в выбранном филиале', 404, 'PICKUP_ORDER_NOT_FOUND');
    }
    orderId = order.id;
  }
  return verifyPickupHandoff({
    orderId,
    branchId,
    token,
    pin,
    verifiedBy: `iiko:${iikoOrderId || branchId}`,
  });
}

module.exports = {
  eligibility,
  getPickupHandoff,
  parseQrPayload,
  parseToken,
  verifyPluginPickupHandoff,
  verifyPickupHandoff,
};

const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { decryptSecret, encryptSecret } = require('../utils/secret-envelope.util');
const { sendPushToCustomer } = require('./push.service');
const forteService = require('./forte.service');
const forteWidgetService = require('./forte-widget.service');
const paymentOperations = require('./payment-operations.service');

const giftError = (message, statusCode = 400, code = 'GIFT_CERTIFICATE_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

const normalizeCode = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');

const giftHash = (code, env = process.env) =>
  crypto
    .createHmac('sha256', String(env.BULKA_SECRET || env.CUSTOMER_JWT_SECRET || ''))
    .update(normalizeCode(code))
    .digest('hex');

const stableFingerprint = (payload) =>
  crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

const purchaseFingerprint = (customerId, payload) =>
  stableFingerprint({
    customerId: String(customerId),
    requestId: String(payload.requestId),
    amount: Number(payload.amount),
    recipientPhone: normalizeKazakhstanPhone(payload.recipient.phone),
    recipientName: payload.recipient.name || null,
    message: payload.recipient.message || null,
    deliveryAt: payload.deliveryAt || null,
    paymentMethod: payload.paymentMethod,
    locale: payload.locale || 'ru',
    savedPaymentMethodId: payload.savedPaymentMethodId || null,
  });

const paymentPayload = (provider, response) => ({
  provider,
  operationId: String(response.operationId || ''),
  checkoutUrl: response.redirectUrl || null,
  qrToken: response.qrToken || null,
  method: response.method || null,
  amount: Number(response.amount || 0),
});

const serializePurchase = (purchase, card, { includeCode = false } = {}) => ({
  id: String(purchase.id),
  requestId: String(purchase.request_id),
  status: purchase.status,
  amount: Number(purchase.amount),
  currency: purchase.currency || 'KZT',
  recipient: {
    phone: purchase.recipient_phone,
    name: purchase.recipient_name || null,
    message: purchase.message || null,
    registered: Boolean(card?.recipient_customer_id),
    deliveryMode: card?.recipient_customer_id ? 'in_app' : 'share_code',
  },
  deliveryAt: purchase.delivery_at || null,
  paymentProvider: purchase.payment_provider,
  paymentOrderId: purchase.payment_order_id || null,
  providerOperationId: purchase.provider_operation_id || null,
  createdAt: purchase.created_at,
  activatedAt: purchase.activated_at || null,
  giftCard:
    purchase.status === 'active' && card
      ? {
          id: String(card.id),
          last4: card.code_last4,
          balance: Number(card.balance),
          expiresAt: card.expires_at || null,
          ...(includeCode && {
            code: decryptSecret(purchase.code_ciphertext, {
              purpose: 'gift-card-code',
              aad: `gift-purchase:${purchase.id}`,
            }),
          }),
        }
      : null,
});

async function readPurchase(customerId, purchaseId) {
  const { data: purchase, error } = await supabase
    .from('gift_certificate_purchases')
    .select('*')
    .eq('id', purchaseId)
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!purchase) {
    throw giftError('Покупка сертификата не найдена', 404, 'GIFT_PURCHASE_NOT_FOUND');
  }
  const { data: card, error: cardError } = await supabase
    .from('gift_cards')
    .select('id,code_last4,balance,expires_at,active,recipient_customer_id')
    .eq('id', purchase.gift_card_id)
    .maybeSingle();
  if (cardError) throw cardError;
  return { purchase, card };
}

async function listGiftCertificatePurchases(customerId, { limit = 50 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  const { data: purchases, error } = await supabase
    .from('gift_certificate_purchases')
    .select('*')
    .eq('customer_id', customerId)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (error) throw error;
  const cardIds = (purchases || []).map((purchase) => purchase.gift_card_id).filter(Boolean);
  const { data: cards, error: cardsError } = cardIds.length
    ? await supabase
        .from('gift_cards')
        .select('id,code_last4,balance,expires_at,active,recipient_customer_id')
        .in('id', cardIds)
    : { data: [], error: null };
  if (cardsError) throw cardsError;
  const cardsById = new Map((cards || []).map((card) => [String(card.id), card]));
  return (purchases || []).map((purchase) =>
    serializePurchase(purchase, cardsById.get(String(purchase.gift_card_id)) || null, {
      includeCode: purchase.status === 'active',
    }),
  );
}

async function listReceivedGiftCards(customerId, { limit = 50 } = {}) {
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 50));
  const { data: cards, error: cardsError } = await supabase
    .from('gift_cards')
    .select(
      'id,code_last4,initial_balance,balance,expires_at,active,recipient_customer_id,purchaser_customer_id,recipient_name,message',
    )
    .eq('recipient_customer_id', customerId)
    .eq('active', true)
    .order('created_at', { ascending: false })
    .limit(safeLimit);
  if (cardsError) throw cardsError;
  const cardIds = (cards || []).map((card) => card.id);
  if (!cardIds.length) return [];
  const { data: purchases, error: purchasesError } = await supabase
    .from('gift_certificate_purchases')
    .select('*')
    .in('gift_card_id', cardIds)
    .eq('status', 'active');
  if (purchasesError) throw purchasesError;
  const now = Date.now();
  const visiblePurchases = (purchases || []).filter(
    (purchase) => !purchase.delivery_at || Date.parse(purchase.delivery_at) <= now,
  );
  const purchaserIds = [
    ...new Set((cards || []).map((card) => card.purchaser_customer_id).filter(Boolean)),
  ];
  const { data: purchasers, error: purchasersError } = purchaserIds.length
    ? await supabase.from('customers').select('id,name').in('id', purchaserIds)
    : { data: [], error: null };
  if (purchasersError) throw purchasersError;
  const cardsById = new Map((cards || []).map((card) => [String(card.id), card]));
  const purchasersById = new Map(
    (purchasers || []).map((customer) => [String(customer.id), customer]),
  );
  return visiblePurchases.map((purchase) => {
    const card = cardsById.get(String(purchase.gift_card_id));
    return {
      id: String(card.id),
      purchaseId: String(purchase.id),
      last4: card.code_last4,
      balance: Number(card.balance),
      initialBalance: Number(card.initial_balance),
      currency: purchase.currency || 'KZT',
      expiresAt: card.expires_at || null,
      code: decryptSecret(purchase.code_ciphertext, {
        purpose: 'gift-card-code',
        aad: `gift-purchase:${purchase.id}`,
      }),
      recipientName: purchase.recipient_name || card.recipient_name || null,
      message: purchase.message || card.message || null,
      senderName: purchasersById.get(String(card.purchaser_customer_id || ''))?.name || null,
      activatedAt: purchase.activated_at || null,
    };
  });
}

async function findOrCreatePurchase(customerId, payload) {
  const recipientPhone = normalizeKazakhstanPhone(payload.recipient.phone);
  if (!recipientPhone) {
    throw giftError(
      'Введите номер получателя в формате +7 700 000 00 00',
      400,
      'GIFT_RECIPIENT_PHONE_INVALID',
    );
  }
  const fingerprint = purchaseFingerprint(customerId, payload);
  const { data: existing, error: existingError } = await supabase
    .from('gift_certificate_purchases')
    .select('*')
    .eq('customer_id', customerId)
    .eq('request_id', payload.requestId)
    .maybeSingle();
  if (existingError) throw existingError;
  if (existing) {
    if (existing.request_fingerprint !== fingerprint) {
      throw giftError(
        'Этот идентификатор уже использован для другого сертификата',
        409,
        'GIFT_REQUEST_ALREADY_USED',
      );
    }
    return existing;
  }

  const purchaseId = crypto.randomUUID();
  const cardId = crypto.randomUUID();
  const code = `BLK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const codeCiphertext = encryptSecret(code, {
    purpose: 'gift-card-code',
    aad: `gift-purchase:${purchaseId}`,
  });
  const { data: recipientCustomer, error: recipientError } = await supabase
    .from('customers')
    .select('id')
    .eq('phone', recipientPhone)
    .is('deleted_at', null)
    .maybeSingle();
  if (recipientError) throw recipientError;

  const { error: cardError } = await supabase.from('gift_cards').insert({
    id: cardId,
    code_hash: giftHash(code),
    code_last4: code.slice(-4),
    initial_balance: payload.amount,
    balance: payload.amount,
    purchaser_customer_id: customerId,
    recipient_customer_id: recipientCustomer?.id || null,
    recipient_name: payload.recipient.name || null,
    message: payload.recipient.message || null,
    active: false,
  });
  if (cardError) throw cardError;

  const row = {
    id: purchaseId,
    customer_id: customerId,
    request_id: payload.requestId,
    request_fingerprint: fingerprint,
    amount: payload.amount,
    recipient_phone: recipientPhone,
    recipient_name: payload.recipient.name || null,
    message: payload.recipient.message || null,
    locale: payload.locale || 'ru',
    delivery_at: payload.deliveryAt || null,
    payment_provider: payload.paymentMethod,
    gift_card_id: cardId,
    code_ciphertext: codeCiphertext,
  };
  const { data, error } = await supabase
    .from('gift_certificate_purchases')
    .insert(row)
    .select('*')
    .single();
  if (error) {
    await supabase.from('gift_cards').delete().eq('id', cardId).eq('active', false);
    if (error.code === '23505') {
      const { data: raced, error: racedError } = await supabase
        .from('gift_certificate_purchases')
        .select('*')
        .eq('customer_id', customerId)
        .eq('request_id', payload.requestId)
        .maybeSingle();
      if (racedError) throw racedError;
      if (raced?.request_fingerprint === fingerprint) return raced;
      throw giftError(
        'Этот идентификатор уже использован для другого сертификата',
        409,
        'GIFT_REQUEST_ALREADY_USED',
      );
    }
    throw error;
  }
  return data;
}

const giftPricing = (purchase) => ({
  subtotal: Number(purchase.amount),
  discount: 0,
  deliveryFee: 0,
  total: Number(purchase.amount),
  promoCode: null,
  promotionId: null,
  preparationMinutes: 1,
  canonicalItems: [
    {
      id: `gift-${purchase.id}`,
      name: `Подарочный сертификат ${Number(purchase.amount).toLocaleString('ru-RU')} ₸`,
      quantity: 1,
      price: Number(purchase.amount),
      unitPrice: Number(purchase.amount),
      total: Number(purchase.amount),
    },
  ],
});

const giftCheckout = (purchase) => ({
  requestId: purchase.request_id,
  orderKind: 'gift_certificate',
  orderType: 'pickup',
  effectiveFulfillmentType: 'pickup',
  preorderFulfillmentType: null,
  branchId: null,
  branch: 'Цифровой сертификат',
  scheduledAt: null,
  pickupTime: null,
  deliveryAddress: null,
  deliveryZone: null,
  deliveryFee: 0,
  deliveryMinimumOrder: 0,
  additionalPhone: null,
  comment: `Сертификат для ${purchase.recipient_phone}`,
  substitutionPreference: 'call_customer',
});

async function createProviderPayment(purchase, phone, payload) {
  const pricing = giftPricing(purchase);
  const checkout = giftCheckout(purchase);
  if (purchase.payment_provider !== 'forte') {
    throw giftError(
      'Выбранный способ оплаты больше недоступен. Начните оформление заново.',
      410,
      'GIFT_PAYMENT_METHOD_UNAVAILABLE',
    );
  }

  const decision = await paymentOperations.getForteCheckoutDecision();
  let service = decision.effectiveIntegration === 'widget' ? forteWidgetService : forteService;
  const options = {
    language: purchase.locale,
    paymentMethodId: payload.savedPaymentMethodId || null,
  };
  let response;
  try {
    response = await service.createCheckout(
      phone,
      pricing,
      purchase.customer_id,
      checkout,
      options,
    );
  } catch (error) {
    if (
      service !== forteWidgetService ||
      !forteService.availability() ||
      !paymentOperations.isSafeWidgetFallbackError(error)
    ) {
      throw error;
    }
    await paymentOperations.recordWidgetFailure(error);
    service = forteService;
    response = await service.createCheckout(
      phone,
      pricing,
      purchase.customer_id,
      checkout,
      options,
    );
  }
  const order = await service.existingRequest(purchase.customer_id, purchase.request_id);
  return { response, order, service };
}

async function createGiftCertificatePurchase(customer, payload) {
  const purchase = await findOrCreatePurchase(customer.id, payload);
  if (purchase.status === 'active') {
    const { card } = await readPurchase(customer.id, purchase.id);
    return {
      purchase: serializePurchase(purchase, card, { includeCode: true }),
      payment: null,
    };
  }
  if (!['pending_payment'].includes(purchase.status)) {
    throw giftError(
      'Эту покупку сертификата нельзя оплатить повторно',
      409,
      'GIFT_PURCHASE_NOT_PAYABLE',
    );
  }

  let provider;
  try {
    provider = await createProviderPayment(purchase, customer.phone, payload);
  } catch (error) {
    await supabase
      .from('gift_certificate_purchases')
      .update({
        last_error: String(error.message || 'payment creation failed').slice(0, 1000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', purchase.id)
      .eq('status', 'pending_payment');
    throw error;
  }
  if (!provider.order?.id) {
    throw giftError(
      'Платёж создан, но его связь с сертификатом ещё проверяется',
      503,
      'GIFT_PAYMENT_LINK_PENDING',
    );
  }
  const { error: linkError } = await supabase
    .from('gift_certificate_purchases')
    .update({
      payment_order_id: provider.order.id,
      provider_operation_id: provider.order.operation_id,
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', purchase.id)
    .eq('status', 'pending_payment')
    .select('*')
    .single();
  if (linkError) throw linkError;

  if (provider.order.status === 'paid') {
    await activateGiftCertificateForPaidOrder(provider.order);
  }
  const current = await readPurchase(customer.id, purchase.id);
  return {
    purchase: serializePurchase(current.purchase, current.card, {
      includeCode: current.purchase.status === 'active',
    }),
    payment: paymentPayload(purchase.payment_provider, provider.response),
  };
}

async function notifyGiftRecipient(purchase, card) {
  if (
    purchase.recipient_notified_at ||
    (purchase.delivery_at && Date.parse(purchase.delivery_at) > Date.now())
  ) {
    return false;
  }
  let recipientCustomerId = card.recipient_customer_id || null;
  if (!recipientCustomerId) {
    const { data, error } = await supabase
      .from('customers')
      .select('id')
      .eq('phone', purchase.recipient_phone)
      .is('deleted_at', null)
      .maybeSingle();
    if (error) throw error;
    recipientCustomerId = data?.id || null;
  }
  if (!recipientCustomerId) return false;
  if (!card.recipient_customer_id) {
    const { error: recipientLinkError } = await supabase
      .from('gift_cards')
      .update({ recipient_customer_id: recipientCustomerId })
      .eq('id', card.id)
      .is('recipient_customer_id', null);
    if (recipientLinkError) throw recipientLinkError;
  }
  const claimedAt = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('gift_certificate_purchases')
    .update({ recipient_notified_at: claimedAt, updated_at: claimedAt })
    .eq('id', purchase.id)
    .is('recipient_notified_at', null)
    .select('id')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return false;
  const title = 'Вам подарили сертификат Bulka';
  const body = `${purchase.recipient_name || 'Для вас'} — сертификат на ${Number(
    purchase.amount,
  ).toLocaleString('ru-RU')} ₸ уже доступен.`;
  const { data: notification, error } = await supabase
    .from('customer_notifications')
    .insert({
      customer_id: recipientCustomerId,
      title,
      body,
      type: 'gift',
      payload: {
        messageKey: 'gift_certificate_received',
        giftPurchaseId: purchase.id,
        giftCardLast4: card.code_last4,
      },
    })
    .select('id')
    .maybeSingle();
  if (error) {
    await supabase
      .from('gift_certificate_purchases')
      .update({ recipient_notified_at: null, updated_at: new Date().toISOString() })
      .eq('id', purchase.id)
      .eq('recipient_notified_at', claimedAt);
    throw error;
  }
  await sendPushToCustomer(recipientCustomerId, title, body, {
    type: 'gift_certificate_received',
    giftPurchaseId: String(purchase.id),
    notificationId: String(notification?.id || ''),
    deepLink: '/profile?section=gift-cards',
  }).catch((pushError) => console.error('Gift certificate push failed:', pushError.message));
  return true;
}

async function activateGiftCertificateForPaidOrder(order) {
  if (!order?.id || order.order_kind !== 'gift_certificate' || order.status !== 'paid') return null;
  const { data, error } = await supabase.rpc('activate_gift_certificate_purchase', {
    p_order_id: order.id,
  });
  if (error) throw error;
  if (['active', 'already_active'].includes(data?.status)) {
    const { data: purchase, error: purchaseError } = await supabase
      .from('gift_certificate_purchases')
      .select('*')
      .eq('id', data.purchaseId)
      .single();
    if (purchaseError) throw purchaseError;
    const { data: card, error: cardError } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('id', purchase.gift_card_id)
      .single();
    if (cardError) throw cardError;
    await notifyGiftRecipient(purchase, card).catch((notificationError) =>
      console.error('Gift recipient notification failed:', notificationError.message),
    );
  }
  return data;
}

async function prepareGiftCertificateRefund(order) {
  if (order?.order_kind !== 'gift_certificate') return null;
  const { data, error } = await supabase.rpc('prepare_gift_certificate_refund', {
    p_order_id: order.id,
  });
  if (error) {
    if (/already been used/i.test(String(error.message || ''))) {
      throw giftError(
        'Сертификат уже использован или зарезервирован на кассе. Возврат всей покупки запрещён.',
        409,
        'GIFT_CERTIFICATE_ALREADY_USED',
      );
    }
    throw error;
  }
  return data;
}

async function rollbackGiftCertificateRefund(order) {
  if (order?.order_kind !== 'gift_certificate') return null;
  const { data, error } = await supabase.rpc('rollback_gift_certificate_refund', {
    p_order_id: order.id,
  });
  if (error) throw error;
  return data;
}

async function finalizeGiftCertificateRefund(order) {
  if (order?.order_kind !== 'gift_certificate') return null;
  const { data, error } = await supabase.rpc('finalize_gift_certificate_refund', {
    p_order_id: order.id,
  });
  if (error) throw error;
  return data;
}

async function syncGiftCertificatePurchaseForOrder(order) {
  if (!order?.id || order.order_kind !== 'gift_certificate') return false;
  if (order.status === 'paid') {
    await activateGiftCertificateForPaidOrder(order);
    return true;
  }
  if (order.status === 'refunded') {
    await finalizeGiftCertificateRefund(order);
    return true;
  }
  const nextStatus =
    order.status === 'expired' ? 'expired' : order.status === 'failed' ? 'failed' : null;
  if (!nextStatus) return false;
  const { data: purchase, error } = await supabase
    .from('gift_certificate_purchases')
    .update({
      status: nextStatus,
      failed_at: new Date().toISOString(),
      last_error: order.last_error || null,
      updated_at: new Date().toISOString(),
    })
    .eq('payment_order_id', order.id)
    .eq('status', 'pending_payment')
    .select('gift_card_id,status')
    .maybeSingle();
  if (error) throw error;
  if (purchase?.gift_card_id) {
    await supabase
      .from('gift_cards')
      .update({ active: false })
      .eq('id', purchase.gift_card_id)
      .eq('balance', order.amount);
  }
  return Boolean(purchase);
}

async function deliverDueGiftCertificates({ limit = 100 } = {}) {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('gift_certificate_purchases')
    .select('*')
    .eq('status', 'active')
    .is('recipient_notified_at', null)
    .or(`delivery_at.is.null,delivery_at.lte.${now}`)
    .order('delivery_at', { ascending: true })
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)));
  if (error) throw error;
  let delivered = 0;
  for (const purchase of data || []) {
    const { data: card, error: cardError } = await supabase
      .from('gift_cards')
      .select('*')
      .eq('id', purchase.gift_card_id)
      .maybeSingle();
    if (cardError) throw cardError;
    if (card && (await notifyGiftRecipient(purchase, card))) delivered += 1;
  }
  return delivered;
}

module.exports = {
  activateGiftCertificateForPaidOrder,
  createGiftCertificatePurchase,
  deliverDueGiftCertificates,
  giftHash,
  finalizeGiftCertificateRefund,
  listGiftCertificatePurchases,
  listReceivedGiftCards,
  prepareGiftCertificateRefund,
  purchaseFingerprint,
  readPurchase,
  rollbackGiftCertificateRefund,
  serializePurchase,
  syncGiftCertificatePurchaseForOrder,
};

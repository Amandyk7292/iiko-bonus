const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { sendPushToCustomer } = require('./push.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { decryptSecret, encryptSecret } = require('../utils/secret-envelope.util');

const commerceError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const MAX_PROMOTION_AMOUNT = 10000000;
const MAX_PROMOTION_AUDIENCE = 500;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const normalizeCode = (value) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '');
const giftHash = (code) =>
  crypto
    .createHmac('sha256', String(process.env.BULKA_SECRET || process.env.CUSTOMER_JWT_SECRET || ''))
    .update(normalizeCode(code))
    .digest('hex');

const normalizePromotionList = (value, maxLength = 160) => [
  ...new Set(
    (Array.isArray(value) ? value : [])
      .map((item) =>
        String(item || '')
          .trim()
          .slice(0, maxLength),
      )
      .filter(Boolean)
      .slice(0, MAX_PROMOTION_AUDIENCE),
  ),
];

function matchesPromotionAudience(promotion, customerId, customerTags = []) {
  const customerIds = normalizePromotionList(promotion?.customer_ids);
  const requiredTags = normalizePromotionList(promotion?.customer_tags, 64);
  if (customerIds.length === 0 && requiredTags.length === 0) return true;
  const normalizedCustomerTags = new Set(normalizePromotionList(customerTags, 64));
  return (
    customerIds.includes(String(customerId || '')) ||
    requiredTags.some((tag) => normalizedCustomerTags.has(tag))
  );
}

const promotionNumber = (value, label, { min = 0, max = MAX_PROMOTION_AMOUNT } = {}) => {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw commerceError(`Некорректное значение: ${label}`);
  }
  return number;
};

const promotionInteger = (value, label, options = {}) => {
  const number = promotionNumber(value, label, options);
  if (!Number.isSafeInteger(number)) throw commerceError(`${label}: укажите целое число`);
  return number;
};

const promotionDate = (value, label) => {
  const raw = String(value || '').trim();
  if (!raw) return null;
  const configuredOffset = Number.parseInt(process.env.ORDER_TIMEZONE_OFFSET_MINUTES || '300', 10);
  const offsetMinutes =
    Number.isInteger(configuredOffset) && Math.abs(configuredOffset) <= 840
      ? configuredOffset
      : 300;
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  const withTimezone = /(Z|[+-]\d{2}:?\d{2})$/i.test(raw) ? raw : `${raw}${offset}`;
  const date = new Date(withTimezone);
  if (Number.isNaN(date.getTime())) throw commerceError(`${label} указана некорректно`);
  return date;
};

async function resolveTargetedPromotion(subtotal, code, { customerId, branchId } = {}) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  const now = new Date().toISOString();
  const { data: promotion, error } = await supabase
    .from('targeted_promotions')
    .select('*')
    .eq('code', normalized)
    .eq('active', true)
    .lte('starts_at', now)
    .or(`ends_at.is.null,ends_at.gt.${now}`)
    .maybeSingle();
  if (error) throw error;
  if (!promotion) return null;
  if (!customerId) throw commerceError('Войдите в профиль для использования этого промокода');
  const { data: customer, error: customerError } = await supabase
    .from('customers')
    .select('id,tags')
    .eq('id', customerId)
    .maybeSingle();
  if (customerError) throw customerError;
  if (!customer) throw commerceError('Профиль не найден', 404);
  const customerTags = Array.isArray(customer.tags) ? customer.tags : [];
  if (!matchesPromotionAudience(promotion, customerId, customerTags)) {
    throw commerceError('Этот промокод предназначен другому клиенту');
  }
  const branchIds = Array.isArray(promotion.branch_ids) ? promotion.branch_ids.map(String) : [];
  if (branchIds.length && (!branchId || !branchIds.includes(String(branchId)))) {
    throw commerceError('Промокод не действует в выбранном филиале');
  }
  if (promotion.usage_limit && Number(promotion.used_count || 0) >= Number(promotion.usage_limit)) {
    throw commerceError('Лимит использования промокода исчерпан');
  }
  const { count, error: redemptionError } = await supabase
    .from('promotion_redemptions')
    .select('order_id', { count: 'exact', head: true })
    .eq('promotion_id', promotion.id)
    .eq('customer_id', customerId)
    .is('released_at', null);
  if (redemptionError) throw redemptionError;
  if (Number(count || 0) >= Number(promotion.per_customer_limit || 1)) {
    throw commerceError('Вы уже использовали этот промокод');
  }
  const minOrder = Number(promotion.min_order || 0);
  if (subtotal < minOrder) throw commerceError(`Промокод действует от ${Math.ceil(minOrder)} ₸`);
  const raw =
    promotion.discount_type === 'percent'
      ? (subtotal * Math.min(100, Number(promotion.discount_value))) / 100
      : Number(promotion.discount_value);
  const capped = promotion.max_discount ? Math.min(raw, Number(promotion.max_discount)) : raw;
  const discount = Math.min(subtotal - 1, Math.max(0, Math.round(capped)));
  return { promoCode: normalized, discount, total: subtotal - discount, promotionId: promotion.id };
}

const promotionReservationError = (error) => {
  const message = String(error?.message || '').toLowerCase();
  if (message.includes('customer limit')) {
    return commerceError('Вы уже использовали или оформляете заказ с этим промокодом', 409);
  }
  if (message.includes('usage limit')) {
    return commerceError('Лимит использования промокода исчерпан', 409);
  }
  if (message.includes('not active')) {
    return commerceError('Промокод больше не действует', 409);
  }
  if (message.includes('another promotion')) {
    return commerceError('Это оформление уже использует другой промокод', 409);
  }
  return error;
};

async function reservePromotionForCheckout(
  pricing,
  { customerId, requestId, ttlMinutes = 30 } = {},
) {
  if (!pricing?.promotionId) return { status: 'no_promotion' };
  const { data, error } = await supabase.rpc('reserve_order_promotion', {
    p_promotion_id: pricing.promotionId,
    p_customer_id: customerId,
    p_client_request_id: requestId,
    p_ttl_minutes: ttlMinutes,
  });
  if (error) throw promotionReservationError(error);
  return data || { status: 'active' };
}

async function attachPromotionReservation(customerId, requestId, orderId) {
  const { data, error } = await supabase.rpc('attach_order_promotion_reservation', {
    p_customer_id: customerId,
    p_client_request_id: requestId,
    p_order_id: orderId,
  });
  if (error) throw error;
  if (!data) {
    throw commerceError('Резерв промокода истёк. Повторите оформление.', 409);
  }
  return true;
}

async function releasePromotionReservation({
  orderId = null,
  customerId = null,
  requestId = null,
}) {
  const { data, error } = await supabase.rpc('release_order_promotion_reservation', {
    p_order_id: orderId,
    p_customer_id: customerId,
    p_client_request_id: requestId,
  });
  if (error) throw error;
  return Boolean(data);
}

async function recordPromotionRedemption(order) {
  const result = await consumePromotionReservation(order);
  return ['consumed', 'already_consumed', 'no_promotion'].includes(result.status);
}

async function consumePromotionReservation(order) {
  const code = normalizeCode(order?.promo_code);
  if (!code || !order?.customer_id) return { status: 'no_promotion' };
  const { data, error } = await supabase.rpc('consume_order_promotion_reservation', {
    p_order_id: order.id,
  });
  if (error) throw error;
  return data && typeof data === 'object' ? data : { status: 'unavailable' };
}

async function getOrCreateReferralCode(customerId) {
  const { data: existing, error: readError } = await supabase
    .from('referral_codes')
    .select('*')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (readError) throw readError;
  if (existing) return existing;
  const code = `BULKA-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
  const { data, error } = await supabase
    .from('referral_codes')
    .insert({ customer_id: customerId, code, reward_referrer: 500, reward_friend: 300 })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

async function redeemReferralCode(customerId, code) {
  const normalized = normalizeCode(code);
  const { data, error } = await supabase.rpc('redeem_referral_code', {
    p_customer_id: customerId,
    p_code: normalized,
  });
  if (error) {
    const message = String(error.message || '').toLowerCase();
    if (message.includes('own referral')) throw commerceError('Нельзя применить свой код');
    if (message.includes('expired')) throw commerceError('Код истёк');
    if (message.includes('limit')) throw commerceError('Лимит кода исчерпан');
    if (message.includes('first order'))
      throw commerceError('Реферальный код действует до первого заказа');
    if (message.includes('already redeemed'))
      throw commerceError('Вы уже применили реферальный код', 409);
    if (message.includes('not found')) throw commerceError('Реферальный код не найден');
    throw error;
  }
  return data;
}

async function qualifyReferralForOrder(order) {
  if (!order?.customer_id || order.status !== 'paid') return false;
  const { data, error } = await supabase.rpc('qualify_referral_for_order', {
    p_order_id: order.id,
  });
  if (error) throw error;
  if (!['rewarded', 'already_rewarded'].includes(String(data?.status || ''))) return false;
  for (const customerId of [data?.friendCustomerId, data?.ownerCustomerId].filter(Boolean)) {
    queueCustomerLoyaltySync(customerId);
  }
  return true;
}

async function issueGiftCard(payload = {}, requestedBy = 'admin') {
  const amount = Number(payload.amount);
  if (!Number.isSafeInteger(amount) || amount < 500 || amount > 1000000) {
    throw commerceError('Сумма сертификата должна быть от 500 до 1 000 000 ₸');
  }
  const expiresAt = promotionDate(payload.expiresAt, 'Срок действия');
  if (expiresAt && expiresAt <= new Date()) {
    throw commerceError('Срок действия сертификата должен быть в будущем');
  }
  const requestId = String(payload.idempotencyKey || '')
    .trim()
    .toLowerCase();
  if (!UUID_PATTERN.test(requestId)) {
    throw commerceError('Для выпуска сертификата нужен уникальный ключ запроса');
  }
  const issuer = String(requestedBy || 'admin')
    .trim()
    .slice(0, 160);
  const normalized = {
    requestId,
    amount,
    purchaserCustomerId: payload.purchaserCustomerId || null,
    recipientCustomerId: payload.recipientCustomerId || null,
    recipientName:
      String(payload.recipientName || '')
        .trim()
        .slice(0, 160) || null,
    message:
      String(payload.message || '')
        .trim()
        .slice(0, 500) || null,
    expiresAt: expiresAt?.toISOString() || null,
    issuer,
  };
  const payloadHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(normalized), 'utf8')
    .digest('hex');
  const code = `BLK-${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
  const codeCiphertext = encryptSecret(code, {
    purpose: 'admin-gift-card-code',
    aad: `admin-gift:${requestId}`,
  });
  const configuredAmountLimit = Number(process.env.ADMIN_GIFT_CARD_DAILY_AMOUNT_LIMIT || 2000000);
  const configuredCountLimit = Number(process.env.ADMIN_GIFT_CARD_DAILY_COUNT_LIMIT || 20);
  const dailyAmountLimit = Number.isSafeInteger(configuredAmountLimit)
    ? Math.min(100000000, Math.max(500, configuredAmountLimit))
    : 2000000;
  const dailyCountLimit = Number.isSafeInteger(configuredCountLimit)
    ? Math.min(1000, Math.max(1, configuredCountLimit))
    : 20;
  const { data, error } = await supabase.rpc('issue_admin_gift_card', {
    p_request_id: requestId,
    p_payload_hash: payloadHash,
    p_code_hash: giftHash(code),
    p_code_last4: code.slice(-4),
    p_code_ciphertext: codeCiphertext,
    p_amount: amount,
    p_purchaser_customer_id: normalized.purchaserCustomerId,
    p_recipient_customer_id: normalized.recipientCustomerId,
    p_recipient_name: normalized.recipientName,
    p_message: normalized.message,
    p_expires_at: normalized.expiresAt,
    p_issued_by: issuer,
    p_daily_amount_limit: dailyAmountLimit,
    p_daily_count_limit: dailyCountLimit,
  });
  if (error) {
    const message = String(error.message || '');
    if (/idempotency conflict/i.test(message)) {
      throw commerceError('Ключ запроса уже использован с другими данными', 409);
    }
    if (/daily limit exceeded/i.test(message)) {
      throw commerceError('Дневной лимит выпуска сертификатов исчерпан', 429);
    }
    if (/invalid admin gift card/i.test(message)) {
      throw commerceError('Некорректные данные выпуска сертификата');
    }
    throw error;
  }
  const card = data?.card;
  if (!card || !data?.codeCiphertext) {
    throw commerceError('Сервис выпуска вернул неполный результат', 503);
  }
  const issuedCode = decryptSecret(data.codeCiphertext, {
    purpose: 'admin-gift-card-code',
    aad: `admin-gift:${requestId}`,
  });
  return {
    ...card,
    code: issuedCode,
    requestedBy: issuer,
    duplicate: data.duplicate === true,
  };
}

async function redeemGiftCard(customerId, code) {
  const normalized = normalizeCode(code);
  if (normalized.length < 8) throw commerceError('Введите код сертификата');
  const { data, error } = await supabase.rpc('redeem_gift_card', {
    p_code_hash: giftHash(normalized),
    p_customer_id: customerId,
  });
  if (error) {
    if (/expired/i.test(error.message)) throw commerceError('Срок сертификата истёк', 409);
    if (/already used/i.test(error.message)) throw commerceError('Сертификат уже использован', 409);
    if (/not found/i.test(error.message)) throw commerceError('Сертификат не найден', 404);
    throw error;
  }
  queueCustomerLoyaltySync(customerId);
  return Number(data || 0);
}

async function listGiftCards() {
  const { data, error } = await supabase
    .from('gift_cards')
    .select(
      'id,code_last4,initial_balance,balance,recipient_name,active,expires_at,created_at,redeemed_at',
    )
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return data || [];
}

async function listPromotions() {
  const { data, error } = await supabase
    .from('targeted_promotions')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

async function savePromotion(payload = {}, id = null) {
  const code = normalizeCode(payload.code);
  if (code.length < 3) throw commerceError('Введите промокод');
  const discountType = payload.discountType === 'fixed' ? 'fixed' : 'percent';
  const discountValue = promotionNumber(payload.discountValue, 'Размер скидки', {
    min: 0.01,
    max: discountType === 'percent' ? 100 : MAX_PROMOTION_AMOUNT,
  });
  const minOrder = promotionNumber(payload.minOrder || 0, 'Минимальная сумма заказа');
  const maxDiscount = payload.maxDiscount
    ? promotionNumber(payload.maxDiscount, 'Максимальная скидка', { min: 0.01 })
    : null;
  const usageLimit = payload.usageLimit
    ? promotionInteger(payload.usageLimit, 'Общий лимит', { min: 1, max: 1000000 })
    : null;
  const perCustomerLimit = promotionInteger(payload.perCustomerLimit || 1, 'Лимит на клиента', {
    min: 1,
    max: 1000,
  });
  const startsAt = promotionDate(payload.startsAt, 'Дата начала') || new Date();
  const endsAt = promotionDate(payload.endsAt, 'Дата окончания');
  if (endsAt && endsAt <= startsAt) {
    throw commerceError('Дата окончания должна быть позже даты начала');
  }
  const record = {
    code,
    title: String(payload.title || code)
      .trim()
      .slice(0, 160),
    description:
      String(payload.description || '')
        .trim()
        .slice(0, 1000) || null,
    discount_type: discountType,
    discount_value: discountValue,
    min_order: minOrder,
    max_discount: maxDiscount,
    customer_ids: normalizePromotionList(payload.customerIds),
    customer_tags: normalizePromotionList(payload.customerTags, 64),
    branch_ids: normalizePromotionList(payload.branchIds),
    usage_limit: usageLimit,
    per_customer_limit: perCustomerLimit,
    active: payload.active !== false,
    starts_at: startsAt.toISOString(),
    ends_at: endsAt?.toISOString() || null,
    updated_at: new Date().toISOString(),
  };
  const query = id
    ? supabase.from('targeted_promotions').update(record).eq('id', id)
    : supabase.from('targeted_promotions').insert(record);
  const { data, error } = await query.select('*').maybeSingle();
  if (error?.code === '23505') throw commerceError('Такой промокод уже существует', 409);
  if (error) throw error;
  if (!data) throw commerceError('Промокод не найден', 404);
  return data;
}

async function enqueueAutomatedMessages() {
  const now = new Date();
  const { data: automations, error } = await supabase
    .from('marketing_automations')
    .select('*')
    .eq('active', true);
  if (error) throw error;
  let enqueued = 0;
  let customerCache = null;
  let orderCache = null;
  let transactionCache = null;

  const customers = async () => {
    if (customerCache) return customerCache;
    const { data, error: customerError } = await supabase
      .from('customers')
      .select('id,birth_date,balance,created_at,deleted_at')
      .is('deleted_at', null)
      .limit(5000);
    if (customerError) throw customerError;
    customerCache = data || [];
    return customerCache;
  };
  const recentOrders = async () => {
    if (orderCache) return orderCache;
    const { data, error: orderError } = await supabase
      .from('kaspi_orders')
      .select('customer_id,created_at')
      .in('status', ['paid', 'refunded'])
      .not('customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(10000);
    if (orderError) throw orderError;
    orderCache = data || [];
    return orderCache;
  };
  const recentTransactions = async () => {
    if (transactionCache) return transactionCache;
    const { data, error: transactionError } = await supabase
      .from('transactions')
      .select('customer_id,timestamp')
      .not('customer_id', 'is', null)
      .order('timestamp', { ascending: false })
      .limit(10000);
    if (transactionError) throw transactionError;
    transactionCache = data || [];
    return transactionCache;
  };
  const enqueue = async (automation, customerId, deduplicationKey, payload = {}) => {
    const { data, error: deliveryError } = await supabase
      .from('marketing_deliveries')
      .upsert(
        {
          automation_id: automation.id,
          customer_id: customerId,
          deduplication_key: deduplicationKey,
          channel: 'push',
          payload,
        },
        {
          onConflict: 'automation_id,customer_id,deduplication_key,channel',
          ignoreDuplicates: true,
        },
      )
      .select('id');
    if (deliveryError) throw deliveryError;
    if (data?.length) enqueued += 1;
  };
  const localParts = (date) =>
    Object.fromEntries(
      new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Aqtau',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .formatToParts(date)
        .filter((part) => part.type !== 'literal')
        .map((part) => [part.type, part.value]),
    );
  const birthdayParts = (value) => {
    const text = String(value || '');
    const iso = text.match(/^\d{4}-(\d{2})-(\d{2})/);
    if (iso) return { month: iso[1], day: iso[2] };
    const local = text.match(/^(\d{2})\.(\d{2})\.\d{4}/);
    return local ? { month: local[2], day: local[1] } : null;
  };
  for (const automation of automations || []) {
    if (automation.trigger_type === 'abandoned_cart') {
      const delayMinutes = Number(automation.config?.delayMinutes || 60);
      const threshold = new Date(now.getTime() - delayMinutes * 60000).toISOString();
      const { data: carts, error: cartError } = await supabase
        .from('customer_cart_snapshots')
        .select('customer_id,items,total,updated_at')
        .lte('updated_at', threshold)
        .is('converted_order_id', null)
        .is('abandoned_notified_at', null)
        .limit(500);
      if (cartError) throw cartError;
      for (const cart of carts || []) {
        await enqueue(
          automation,
          cart.customer_id,
          `cart:${new Date(cart.updated_at).toISOString().slice(0, 13)}`,
          { total: Number(cart.total || 0), itemCount: cart.items?.length || 0 },
        );
      }
      continue;
    }

    if (automation.trigger_type === 'birthday') {
      const daysBefore = Math.max(0, Math.min(30, Number(automation.config?.daysBefore || 0)));
      const target = new Date(now.getTime() + daysBefore * 86400000);
      const targetParts = localParts(target);
      for (const customer of await customers()) {
        const birth = birthdayParts(customer.birth_date);
        if (birth?.month === targetParts.month && birth?.day === targetParts.day) {
          await enqueue(automation, customer.id, `birthday:${targetParts.year}`, { daysBefore });
        }
      }
      continue;
    }

    if (automation.trigger_type === 'inactive') {
      const inactiveDays = Math.max(1, Number(automation.config?.inactiveDays || 45));
      const cooldownDays = Math.max(1, Number(automation.config?.cooldownDays || 30));
      const cutoff = now.getTime() - inactiveDays * 86400000;
      const latest = new Map();
      for (const order of await recentOrders()) {
        if (!latest.has(String(order.customer_id)))
          latest.set(String(order.customer_id), order.created_at);
      }
      const cooldownBucket = Math.floor(now.getTime() / (cooldownDays * 86400000));
      for (const customer of await customers()) {
        const activity = latest.get(String(customer.id)) || customer.created_at;
        if (activity && new Date(activity).getTime() <= cutoff) {
          await enqueue(automation, customer.id, `inactive:${cooldownBucket}`, { inactiveDays });
        }
      }
      continue;
    }

    if (automation.trigger_type === 'bonus_expiring') {
      const expirationDays = Math.max(2, Number(automation.config?.expirationDays || 90));
      const daysBefore = Math.max(
        1,
        Math.min(expirationDays - 1, Number(automation.config?.daysBefore || 7)),
      );
      const latest = new Map();
      for (const transaction of await recentTransactions()) {
        if (!latest.has(String(transaction.customer_id))) {
          latest.set(String(transaction.customer_id), transaction.timestamp);
        }
      }
      const targetStart = now.getTime() - (expirationDays - daysBefore) * 86400000;
      const expiry = now.getTime() - expirationDays * 86400000;
      const month = localParts(now);
      for (const customer of await customers()) {
        if (Number(customer.balance || 0) <= 0) continue;
        const activity = latest.get(String(customer.id)) || customer.created_at;
        const activityAt = activity ? new Date(activity).getTime() : 0;
        if (activityAt <= targetStart && activityAt > expiry) {
          await enqueue(automation, customer.id, `bonus-expiring:${month.year}-${month.month}`, {
            balance: Number(customer.balance || 0),
            daysBefore,
          });
        }
      }
    }
  }
  return enqueued;
}

async function deliverAutomatedMessages(limit = 100) {
  const { data: deliveries, error } = await supabase
    .from('marketing_deliveries')
    .select('*,marketing_automations(*)')
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at')
    .limit(Math.min(500, Math.max(1, Number(limit) || 100)));
  if (error) throw error;
  let sent = 0;
  for (const delivery of deliveries || []) {
    try {
      const { data: customer } = await supabase
        .from('customers')
        .select('fcm_token,preferred_language,deleted_at')
        .eq('id', delivery.customer_id)
        .maybeSingle();
      if (!customer || customer.deleted_at) {
        await supabase
          .from('marketing_deliveries')
          .update({ status: 'skipped' })
          .eq('id', delivery.id);
        continue;
      }
      const language = customer.preferred_language || 'ru';
      const automation = delivery.marketing_automations || {};
      const title =
        automation.title_translations?.[language] || automation.title_translations?.ru || 'Bulka';
      const body =
        automation.body_translations?.[language] || automation.body_translations?.ru || '';
      const pushResult = await sendPushToCustomer(
        delivery.customer_id,
        title,
        body,
        {
          type: automation.trigger_type,
        },
        customer.fcm_token,
      );
      if (pushResult.attempted === 0) {
        await supabase
          .from('marketing_deliveries')
          .update({ status: 'skipped', error: 'У клиента нет активных push-токенов' })
          .eq('id', delivery.id);
        continue;
      }
      if (pushResult.delivered === 0 && !pushResult.queued) {
        throw new Error('FCM отклонил все push-токены клиента');
      }
      await supabase
        .from('marketing_deliveries')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error: null })
        .eq('id', delivery.id);
      if (automation.trigger_type === 'abandoned_cart') {
        await supabase
          .from('customer_cart_snapshots')
          .update({ abandoned_notified_at: new Date().toISOString() })
          .eq('customer_id', delivery.customer_id);
      }
      sent += 1;
    } catch (deliveryError) {
      await supabase
        .from('marketing_deliveries')
        .update({ status: 'failed', error: String(deliveryError.message).slice(0, 1000) })
        .eq('id', delivery.id);
    }
  }
  return sent;
}

module.exports = {
  deliverAutomatedMessages,
  enqueueAutomatedMessages,
  getOrCreateReferralCode,
  issueGiftCard,
  listGiftCards,
  listPromotions,
  matchesPromotionAudience,
  qualifyReferralForOrder,
  consumePromotionReservation,
  releasePromotionReservation,
  reservePromotionForCheckout,
  attachPromotionReservation,
  recordPromotionRedemption,
  redeemGiftCard,
  redeemReferralCode,
  resolveTargetedPromotion,
  savePromotion,
};

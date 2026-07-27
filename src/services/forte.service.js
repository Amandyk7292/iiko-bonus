const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');
const kaspiService = require('./kaspi.service');
const { recordSystemEvent } = require('./analytics-event.service');
const { forecastOrderEta } = require('./eta.service');

const DEFAULT_CHECKOUT_BASE_URL = 'https://securepayments.fortebank.com';
const DEFAULT_GATEWAY_BASE_URL = 'https://gateway.fortebank.com';
const FORTE_PAYMENT_METHOD = 'forte_card';
const FINAL_PAYMENT_STATUSES = new Set(['paid', 'failed', 'expired', 'refunded']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,100}$/;

const cleanText = (value, maximum = 1000) =>
  String(value == null ? '' : value)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);

const digitsOnly = (value, maximum = 32) =>
  String(value == null ? '' : value)
    .replace(/\D/g, '')
    .slice(0, maximum);

const normalizePhone = (value) => {
  const digits = digitsOnly(value, 15);
  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;
  return null;
};

const normalizeLanguage = (value) => {
  const language = String(value || 'ru')
    .trim()
    .toLowerCase()
    .slice(0, 2);
  return ['ru', 'kk', 'en'].includes(language) ? language : 'ru';
};

const parseBoolean = (value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
};

const toMinorUnits = (amount) => {
  const numeric = Number(amount);
  const minor = Math.round(numeric * 100);
  if (
    !Number.isFinite(numeric) ||
    numeric <= 0 ||
    numeric > 10000000 ||
    !Number.isSafeInteger(minor)
  ) {
    throw forteError('Некорректная сумма платежа ForteBank', 400, 'FORTE_INVALID_AMOUNT');
  }
  return minor;
};

const forteError = (message, statusCode = 502, code = 'FORTE_REQUEST_FAILED', extra = {}) =>
  Object.assign(new Error(message), { statusCode, code, ...extra });

const trimBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');

const headerValue = (headers, name) => {
  if (typeof headers?.get === 'function') return headers.get(name);
  const target = String(name).toLowerCase();
  const key = Object.keys(headers || {}).find((entry) => entry.toLowerCase() === target);
  return key ? headers[key] : undefined;
};

const safeTextEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const normalizePublicKey = (value) => {
  const supplied = String(value || '')
    .trim()
    .replace(/\\r/g, '')
    .replace(/\\n/g, '\n');
  if (!supplied) throw forteError('ForteBank webhook public key is not configured', 503);
  if (supplied.includes('-----BEGIN')) return supplied;
  const compact = supplied.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(compact)) {
    throw forteError('ForteBank webhook public key has an invalid format', 503);
  }
  return `-----BEGIN PUBLIC KEY-----\n${compact.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
};

const verifyForteWebhook = ({ headers, rawBody, shopId, secretKey, publicKey }) => {
  if (!Buffer.isBuffer(rawBody)) {
    throw forteError('Webhook raw body is unavailable', 503, 'FORTE_WEBHOOK_NOT_CONFIGURED');
  }

  const expectedAuthorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`, 'utf8').toString(
    'base64',
  )}`;
  if (!safeTextEqual(headerValue(headers, 'authorization'), expectedAuthorization)) {
    throw forteError('Invalid webhook credentials', 401, 'FORTE_WEBHOOK_UNAUTHORIZED');
  }

  const signatureText = String(headerValue(headers, 'content-signature') || '').trim();
  if (
    !signatureText ||
    signatureText.length > 2048 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)
  ) {
    throw forteError('Invalid webhook signature', 403, 'FORTE_WEBHOOK_INVALID_SIGNATURE');
  }

  let verified;
  try {
    verified = crypto.verify(
      'RSA-SHA256',
      rawBody,
      crypto.createPublicKey(normalizePublicKey(publicKey)),
      Buffer.from(signatureText, 'base64'),
    );
  } catch (error) {
    throw forteError(
      'ForteBank webhook signature cannot be verified',
      503,
      'FORTE_WEBHOOK_KEY_ERROR',
      {
        cause: error,
      },
    );
  }
  if (!verified) {
    throw forteError('Invalid webhook signature', 403, 'FORTE_WEBHOOK_INVALID_SIGNATURE');
  }
  return true;
};

const firstDefined = (...values) =>
  values.find((value) => value !== undefined && value !== null && value !== '');

const normalizeFortePayload = (payload = {}) => {
  const checkout = payload.checkout || {};
  const gateway = checkout.gateway_response || payload.gateway_response || {};
  const transaction =
    payload.transaction ||
    checkout.transaction ||
    gateway.payment ||
    gateway.transaction ||
    checkout.payment ||
    payload.payment ||
    payload;
  const order = checkout.order || transaction.order || payload.order || {};
  const card =
    transaction.credit_card ||
    transaction.card ||
    gateway.credit_card ||
    gateway.card ||
    checkout.card ||
    payload.card ||
    {};
  const paymentDetails = transaction.payment || gateway.payment || {};
  const rawStatus = cleanText(
    firstDefined(transaction.status, paymentDetails.status, checkout.status, payload.status),
    40,
  ).toLowerCase();

  return {
    checkoutToken: cleanText(
      firstDefined(
        checkout.token,
        transaction.checkout_token,
        transaction.payment_token,
        payload.checkout_token,
        payload.token,
      ),
      100,
    ),
    trackingId: cleanText(
      firstDefined(
        transaction.tracking_id,
        paymentDetails.tracking_id,
        order.tracking_id,
        checkout.tracking_id,
        payload.tracking_id,
      ),
      100,
    ),
    transactionId: cleanText(
      firstDefined(transaction.uid, paymentDetails.uid, transaction.id, paymentDetails.id),
      100,
    ),
    parentTransactionId: cleanText(
      firstDefined(transaction.parent_uid, paymentDetails.parent_uid),
      100,
    ),
    transactionType: cleanText(
      firstDefined(transaction.type, transaction.transaction_type, checkout.transaction_type),
      40,
    ).toLowerCase(),
    status: rawStatus,
    amount: Number(
      firstDefined(transaction.amount, paymentDetails.amount, order.amount, checkout.amount),
    ),
    currency: cleanText(
      firstDefined(
        transaction.currency,
        paymentDetails.currency,
        order.currency,
        checkout.currency,
      ),
      3,
    ).toUpperCase(),
    test: parseBoolean(firstDefined(transaction.test, paymentDetails.test, checkout.test)),
    shopId: cleanText(
      firstDefined(transaction.shop_id, paymentDetails.shop_id, checkout.shop_id, payload.shop_id),
      100,
    ),
    paymentSystem: cleanText(
      firstDefined(
        card.brand,
        transaction.payment_method_type,
        paymentDetails.payment_method_type,
        checkout.payment_method_type,
      ),
      40,
    ),
    cardFirstSix: digitsOnly(firstDefined(card.bin, card.first_6, card.first_six), 6),
    cardLastFour: digitsOnly(firstDefined(card.last_4, card.last_four), 4),
    authorizationCode: cleanText(
      firstDefined(
        transaction.auth_code,
        transaction.authorization_code,
        transaction.payment?.auth_code,
        paymentDetails.auth_code,
        transaction.refund?.auth_code,
      ),
      100,
    ),
    settledAt: firstDefined(
      transaction.settled_at,
      paymentDetails.settled_at,
      transaction.psp_settled_at,
    ),
    paidAt: firstDefined(transaction.paid_at, paymentDetails.paid_at),
    message: cleanText(
      firstDefined(transaction.friendly_message, transaction.message, payload.message),
      500,
    ),
  };
};

const mapForteStatus = (status) => {
  const normalized = String(status || '').toLowerCase();
  if (['successful', 'success', 'succeeded', 'paid', 'captured'].includes(normalized)) {
    return 'paid';
  }
  if (['failed', 'declined', 'error', 'rejected'].includes(normalized)) return 'failed';
  if (['expired', 'cancelled', 'canceled'].includes(normalized)) return 'expired';
  if (['refunded'].includes(normalized)) return 'refunded';
  return 'pending';
};

const paymentResponse = (order) => ({
  success: true,
  method: FORTE_PAYMENT_METHOD,
  operationId: order.operation_id,
  redirectUrl: order.provider_redirect_url,
  amount: Number(order.amount),
  orderType: order.fulfillment_type || 'pickup',
  branchId: order.branch_id == null ? null : String(order.branch_id),
  scheduledAt: order.scheduled_at || null,
  orderId: order.id == null ? undefined : String(order.id),
});

const apiErrorMessage = (body, fallback) => {
  const message = cleanText(body?.message || body?.error || body?.friendly_message, 500);
  if (message) return message;
  if (body?.errors && typeof body.errors === 'object') {
    return cleanText(JSON.stringify(body.errors), 500) || fallback;
  }
  return fallback;
};

class ForteService {
  constructor({
    db = supabase,
    fetchImpl = fetch,
    orderService = kaspiService,
    env = process.env,
  } = {}) {
    this.db = db;
    this.fetchImpl = fetchImpl;
    this.orderService = orderService;
    this.env = env;
  }

  config() {
    return {
      enabled: this.env.FORTE_ENABLED === 'true',
      shopId: String(this.env.FORTE_SHOP_ID || this.env.FORTE_MERCHANT_ID || '').trim(),
      secretKey: String(this.env.FORTE_SECRET_KEY || '').trim(),
      publicKey: String(this.env.FORTE_WEBHOOK_PUBLIC_KEY || '').trim(),
      test: this.env.FORTE_TEST_MODE === 'true',
      checkoutBaseUrl: trimBaseUrl(this.env.FORTE_CHECKOUT_BASE_URL, DEFAULT_CHECKOUT_BASE_URL),
      gatewayBaseUrl: trimBaseUrl(this.env.FORTE_GATEWAY_BASE_URL, DEFAULT_GATEWAY_BASE_URL),
      publicBaseUrl: trimBaseUrl(this.env.PUBLIC_BASE_URL, 'https://bulka.com.kz'),
      timeoutMs: Math.min(60000, Math.max(1000, Number(this.env.FORTE_TIMEOUT_MS) || 15000)),
    };
  }

  isConfigured() {
    const config = this.config();
    return (
      config.enabled &&
      config.shopId.length > 0 &&
      config.secretKey.length >= 8 &&
      config.publicKey.length >= 64
    );
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw forteError('Оплата картой ForteBank временно недоступна', 503, 'FORTE_NOT_CONFIGURED');
    }
    return this.config();
  }

  availability() {
    return this.isConfigured();
  }

  basicAuthorization(config = this.assertConfigured()) {
    return `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`, 'utf8').toString('base64')}`;
  }

  verifyWebhookAuthentication(headers, rawBody) {
    const config = this.assertConfigured();
    return verifyForteWebhook({
      headers,
      rawBody,
      shopId: config.shopId,
      secretKey: config.secretKey,
      publicKey: config.publicKey,
    });
  }

  async request(url, { method = 'GET', body, apiVersion, requestId } = {}) {
    const config = this.assertConfigured();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: this.basicAuthorization(config),
          Accept: 'application/json',
          ...(body && { 'Content-Type': 'application/json' }),
          ...(apiVersion && { 'X-API-Version': String(apiVersion) }),
          ...(requestId && { RequestID: String(requestId) }),
        },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch (error) {
      throw forteError(
        'Ответ ForteBank не получен. Проверьте операцию перед повторной попыткой.',
        502,
        'FORTE_NETWORK_ERROR',
        { cause: error, retryable: true },
      );
    } finally {
      clearTimeout(timeout);
    }

    const text = await response.text().catch(() => '');
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { message: text };
      }
    }
    return { response, body: payload };
  }

  async existingRequest(customerId, requestId) {
    const { data, error } = await this.db
      .from('kaspi_orders')
      .select('*')
      .eq('customer_id', customerId)
      .eq('client_request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data || null;
  }

  async createCheckout(phone, pricing, customerId, checkout = {}, options = {}) {
    const config = this.assertConfigured();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      throw forteError('Некорректный номер телефона', 400, 'FORTE_INVALID_PHONE');
    }
    const existing = await this.existingRequest(customerId, checkout.requestId);
    if (existing) {
      if (existing.payment_method !== FORTE_PAYMENT_METHOD) {
        throw forteError(
          'Это оформление уже связано с другим способом оплаты',
          409,
          'PAYMENT_REQUEST_ALREADY_USED',
        );
      }
      return paymentResponse(existing);
    }

    const amount = toMinorUnits(pricing.total);
    const trackingId = crypto.randomUUID();
    const language = normalizeLanguage(options.language);
    const expiryMinutes = Math.min(
      1440,
      Math.max(5, Number(this.env.FORTE_CHECKOUT_EXPIRY_MINUTES) || 30),
    );
    const expiredAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();
    const returnUrl = `${config.publicBaseUrl}/orders?payment=forte&order=${encodeURIComponent(
      trackingId,
    )}`;
    const description =
      cleanText(
        `Заказ Bulka: ${(pricing.canonicalItems || [])
          .slice(0, 10)
          .map((item) => `${item.name} ×${item.quantity}`)
          .join(', ')}`,
        255,
      ) || 'Заказ Bulka';

    const requestBody = {
      checkout: {
        transaction_type: 'payment',
        attempts: 3,
        test: config.test,
        settings: {
          return_url: returnUrl,
          notification_url: `${config.publicBaseUrl}/webhooks/forte`,
          language,
          auto_return: 0,
          customer_fields: {
            read_only: ['phone'],
          },
        },
        payment_method: {
          types: ['credit_card'],
        },
        order: {
          amount,
          currency: 'KZT',
          description,
          tracking_id: trackingId,
          expired_at: expiredAt,
        },
        customer: {
          phone: `+${normalizedPhone}`,
          external_id: String(customerId),
        },
      },
    };

    const { response, body } = await this.request(`${config.checkoutBaseUrl}/ctp/api/checkouts`, {
      method: 'POST',
      body: requestBody,
      apiVersion: 2,
    });
    if (!response.ok) {
      throw forteError(
        apiErrorMessage(body, `ForteBank отклонил создание платежа (${response.status})`),
        response.status >= 400 && response.status < 500 ? 409 : 502,
        'FORTE_CHECKOUT_REJECTED',
      );
    }

    const token = cleanText(body?.checkout?.token, 100);
    const redirectUrl = cleanText(body?.checkout?.redirect_url, 1000);
    let parsedRedirect;
    try {
      parsedRedirect = new URL(redirectUrl);
    } catch {
      parsedRedirect = null;
    }
    if (
      !TOKEN_PATTERN.test(token) ||
      !parsedRedirect ||
      parsedRedirect.origin !== new URL(config.checkoutBaseUrl).origin ||
      parsedRedirect.protocol !== 'https:'
    ) {
      throw forteError(
        'ForteBank вернул некорректную ссылку оплаты',
        502,
        'FORTE_INVALID_CHECKOUT_RESPONSE',
      );
    }

    const eta = await forecastOrderEta({
      branchId: checkout.branchId,
      orderType: checkout.orderType,
      scheduledAt: checkout.scheduledAt,
      preparationMinutes: pricing.preparationMinutes,
      deliveryAddress: checkout.deliveryAddress,
      deliveryZone: checkout.deliveryZone,
    });
    const orderRecord = {
      ...this.orderService.orderRecord({
        customerId,
        operationId: token,
        normalizedPhone,
        pricing,
        cartItems: pricing.canonicalItems,
        checkout,
        paymentMethod: FORTE_PAYMENT_METHOD,
        eta,
      }),
      id: trackingId,
      provider_redirect_url: redirectUrl,
      provider_status: 'checkout_created',
      payment_test: config.test,
    };
    const { data: savedOrder, error } = await this.db
      .from('kaspi_orders')
      .insert([orderRecord])
      .select('*')
      .single();
    if (error) {
      const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
      if (raced?.payment_method === FORTE_PAYMENT_METHOD) return paymentResponse(raced);
      throw forteError(
        'Платёж создан в ForteBank, но заказ не сохранён. Обратитесь в поддержку до повтора.',
        502,
        'FORTE_CHECKOUT_SAVE_UNKNOWN',
        { cause: error, retryable: false },
      );
    }

    await recordSystemEvent(customerId, {
      type: 'payment_created',
      orderId: savedOrder.id,
      branchId: checkout.branchId,
      properties: { paymentMethod: FORTE_PAYMENT_METHOD, amount: pricing.total },
    }).catch((error) => console.error('Не удалось записать аналитику ForteBank:', error.message));
    return paymentResponse(savedOrder);
  }

  async findOrder(normalized) {
    let result = null;
    if (TOKEN_PATTERN.test(normalized.checkoutToken)) {
      const { data, error } = await this.db
        .from('kaspi_orders')
        .select('*')
        .eq('operation_id', normalized.checkoutToken)
        .maybeSingle();
      if (error) throw error;
      result = data;
    }
    if (!result && UUID_PATTERN.test(normalized.trackingId)) {
      const { data, error } = await this.db
        .from('kaspi_orders')
        .select('*')
        .eq('id', normalized.trackingId)
        .maybeSingle();
      if (error) throw error;
      result = data;
    }
    if (!result && normalized.transactionId) {
      const { data, error } = await this.db
        .from('kaspi_orders')
        .select('*')
        .eq('provider_transaction_id', normalized.transactionId)
        .maybeSingle();
      if (error) throw error;
      result = data;
    }
    if (!result) {
      throw forteError('ForteBank order was not found', 404, 'FORTE_ORDER_NOT_FOUND');
    }
    if (result.payment_method !== FORTE_PAYMENT_METHOD) {
      throw forteError('Payment provider mismatch', 409, 'FORTE_PROVIDER_MISMATCH');
    }
    return result;
  }

  validateProviderPayment(order, normalized) {
    const config = this.assertConfigured();
    const expectedAmount = toMinorUnits(order.amount);
    if (!Number.isSafeInteger(normalized.amount) || normalized.amount !== expectedAmount) {
      throw forteError('ForteBank payment amount mismatch', 422, 'FORTE_AMOUNT_MISMATCH');
    }
    if (normalized.currency !== 'KZT') {
      throw forteError('ForteBank payment currency mismatch', 422, 'FORTE_CURRENCY_MISMATCH');
    }
    if (normalized.test === null || normalized.test !== config.test) {
      throw forteError('ForteBank payment mode mismatch', 422, 'FORTE_TEST_MODE_MISMATCH');
    }
    if (!UUID_PATTERN.test(normalized.trackingId) || normalized.trackingId !== String(order.id)) {
      throw forteError('ForteBank tracking id mismatch', 422, 'FORTE_TRACKING_MISMATCH');
    }
    if (normalized.checkoutToken && normalized.checkoutToken !== String(order.operation_id)) {
      throw forteError('ForteBank checkout token mismatch', 422, 'FORTE_TOKEN_MISMATCH');
    }
    if (normalized.shopId && normalized.shopId !== config.shopId) {
      throw forteError('ForteBank shop id mismatch', 422, 'FORTE_SHOP_MISMATCH');
    }
  }

  async applyProviderPayment(order, normalized) {
    this.validateProviderPayment(order, normalized);
    const nextStatus = mapForteStatus(normalized.status);
    if (nextStatus === 'paid' && !normalized.transactionId) {
      throw forteError('ForteBank payment UID is missing', 422, 'FORTE_TRANSACTION_ID_MISSING');
    }
    const firstSix = normalized.cardFirstSix.length === 6 ? normalized.cardFirstSix : null;
    const lastFour = normalized.cardLastFour.length === 4 ? normalized.cardLastFour : null;
    const { data: updatedMetadata, error } = await this.db
      .from('kaspi_orders')
      .update({
        ...(normalized.transactionId && {
          provider_transaction_id: normalized.transactionId,
        }),
        provider_status: normalized.status || 'unknown',
        provider_payment_system: normalized.paymentSystem || null,
        provider_card_first_six: firstSix,
        provider_card_last_four: lastFour,
        provider_authorization_code: normalized.authorizationCode || null,
        provider_settled_at: normalized.settledAt || null,
        payment_test: normalized.test,
        last_error:
          nextStatus === 'failed' || nextStatus === 'expired'
            ? normalized.message || `ForteBank: ${normalized.status}`
            : null,
      })
      .eq('id', order.id)
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!updatedMetadata) {
      throw forteError('ForteBank order changed during processing', 409, 'FORTE_ORDER_CONFLICT');
    }

    let updatedOrder = updatedMetadata;
    if (nextStatus !== 'pending') {
      updatedOrder =
        (await this.orderService.updateOrderStatus(order.operation_id, nextStatus)) ||
        updatedMetadata;
    }
    if (nextStatus === 'paid') {
      updatedOrder = (await this.orderService.recordPaidOrder(order.operation_id)) || updatedOrder;
    }
    return { order: updatedOrder, status: nextStatus };
  }

  async processWebhook(payload) {
    const normalized = normalizeFortePayload(payload);
    if (normalized.transactionType === 'refund') {
      return { accepted: true, ignored: true, type: 'refund' };
    }
    const order = await this.findOrder(normalized);
    return this.applyProviderPayment(order, normalized);
  }

  async queryCheckout(paymentToken) {
    const config = this.assertConfigured();
    if (!TOKEN_PATTERN.test(String(paymentToken || ''))) {
      throw forteError('Некорректный токен ForteBank', 400, 'FORTE_INVALID_TOKEN');
    }
    const { response, body } = await this.request(
      `${config.checkoutBaseUrl}/ctp/api/checkouts/${encodeURIComponent(paymentToken)}`,
      { apiVersion: 2 },
    );
    if (!response.ok) {
      throw forteError(
        apiErrorMessage(body, `ForteBank не вернул статус платежа (${response.status})`),
        response.status === 404 ? 404 : 502,
        'FORTE_STATUS_FAILED',
      );
    }
    return body;
  }

  async syncOrder(orderOrToken) {
    const order =
      typeof orderOrToken === 'object'
        ? orderOrToken
        : await this.findOrder({ checkoutToken: String(orderOrToken), trackingId: '' });
    const payload = await this.queryCheckout(order.operation_id);
    const normalized = normalizeFortePayload(payload);
    if (!normalized.checkoutToken) normalized.checkoutToken = String(order.operation_id);
    return this.applyProviderPayment(order, normalized);
  }

  async getOrderStatus(operationId, customerId) {
    const { data, error } = await this.db
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .eq('customer_id', String(customerId))
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw forteError('Заказ не найден', 404, 'FORTE_ORDER_NOT_FOUND');
    return data;
  }

  async refundPayment(parentUid, amount, { reason, idempotencyKey } = {}) {
    const config = this.assertConfigured();
    const cleanParentUid = cleanText(parentUid, 100);
    if (!TOKEN_PATTERN.test(cleanParentUid)) {
      throw forteError(
        'Некорректный идентификатор операции ForteBank',
        409,
        'FORTE_REFUND_INVALID_OPERATION',
      );
    }
    const requestId = String(idempotencyKey || crypto.randomUUID());
    if (!UUID_PATTERN.test(requestId)) {
      throw forteError(
        'Некорректный ключ возврата ForteBank',
        409,
        'FORTE_REFUND_INVALID_REQUEST_ID',
      );
    }
    const requestBody = {
      request: {
        parent_uid: cleanParentUid,
        amount: toMinorUnits(amount),
        reason: cleanText(reason, 255) || 'Customer order refund',
        additional_data: {
          referer: config.publicBaseUrl,
        },
      },
    };

    let result;
    try {
      result = await this.request(`${config.gatewayBaseUrl}/transactions/refunds`, {
        method: 'POST',
        body: requestBody,
        apiVersion: 3,
        requestId,
      });
    } catch (error) {
      error.refundUncertain = true;
      error.code = 'FORTE_REFUND_UNKNOWN';
      throw error;
    }
    const { response, body } = result;
    const transaction = body?.transaction || {};
    const status = cleanText(transaction.status, 40).toLowerCase();
    const reference = cleanText(transaction.uid || transaction.id, 100) || null;
    if (
      response.ok &&
      status === 'successful' &&
      reference &&
      transaction.parent_uid === cleanParentUid &&
      Number(transaction.amount) === requestBody.request.amount &&
      String(transaction.currency || '').toUpperCase() === 'KZT' &&
      parseBoolean(transaction.test) === config.test
    ) {
      return { reference, response: body, requestId };
    }
    if (response.ok && ['incomplete', 'pending', 'processing'].includes(status)) {
      throw forteError(
        'ForteBank принял возврат в обработку. Результат требует сверки.',
        502,
        'FORTE_REFUND_UNKNOWN',
        { refundUncertain: true, refundReference: reference, requestId },
      );
    }
    if (response.status >= 400 && response.status < 500) {
      throw forteError(
        apiErrorMessage(body, 'ForteBank отклонил возврат'),
        409,
        'FORTE_REFUND_REJECTED',
        { requestId },
      );
    }
    throw forteError(
      apiErrorMessage(body, 'ForteBank не подтвердил возврат. Требуется сверка.'),
      502,
      'FORTE_REFUND_UNKNOWN',
      { refundUncertain: true, refundReference: reference, requestId },
    );
  }

  async queryTransaction(transactionId) {
    const config = this.assertConfigured();
    const uid = cleanText(transactionId, 100);
    if (!TOKEN_PATTERN.test(uid)) {
      throw forteError('Некорректный UID ForteBank', 400, 'FORTE_INVALID_TRANSACTION_ID');
    }
    const { response, body } = await this.request(
      `${config.gatewayBaseUrl}/transactions/${encodeURIComponent(uid)}`,
      { apiVersion: 3 },
    );
    if (!response.ok) {
      throw forteError(
        apiErrorMessage(body, `ForteBank не вернул транзакцию (${response.status})`),
        response.status === 404 ? 404 : 502,
        'FORTE_TRANSACTION_QUERY_FAILED',
      );
    }
    return body;
  }

  async reconcileOrders() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error: staleError } = await this.db
      .from('kaspi_orders')
      .update({
        last_error: 'Автоматическая сверка ForteBank остановлена спустя 24 часа.',
      })
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .is('last_error', null);
    if (staleError) throw staleError;

    const [
      { data: pendingOrders, error: pendingError },
      { data: unreconciledOrders, error: unreconciledError },
    ] = await Promise.all([
      this.db
        .from('kaspi_orders')
        .select('*')
        .eq('payment_method', FORTE_PAYMENT_METHOD)
        .eq('status', 'pending')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(50),
      this.db
        .from('kaspi_orders')
        .select('*')
        .eq('payment_method', FORTE_PAYMENT_METHOD)
        .in('status', ['paid', 'refunded'])
        .is('payment_reconciled_at', null)
        .order('created_at', { ascending: true })
        .limit(50),
    ]);
    if (pendingError) throw pendingError;
    if (unreconciledError) throw unreconciledError;

    const uniqueOrders = new Map(
      [...(pendingOrders || []), ...(unreconciledOrders || [])].map((order) => [order.id, order]),
    );
    for (const order of uniqueOrders.values()) {
      try {
        await this.syncOrder(order);
        if (order.provider_transaction_id && FINAL_PAYMENT_STATUSES.has(order.status)) {
          const transactionPayload = await this.queryTransaction(order.provider_transaction_id);
          const normalized = normalizeFortePayload(transactionPayload);
          this.validateProviderPayment(order, {
            ...normalized,
            checkoutToken: order.operation_id,
          });
          await this.db
            .from('kaspi_orders')
            .update({
              provider_status: normalized.status || order.provider_status,
              provider_settled_at: normalized.settledAt || order.provider_settled_at,
              payment_reconciled_at: new Date().toISOString(),
              last_error:
                order.status === 'paid' && mapForteStatus(normalized.status) !== 'paid'
                  ? `Сверка ForteBank: неожиданный статус ${normalized.status || 'unknown'}`
                  : null,
            })
            .eq('id', order.id)
            .eq('payment_method', FORTE_PAYMENT_METHOD);
        }
      } catch (error) {
        console.error(`Не удалось сверить ForteBank заказ ${order.id}:`, error.message);
      }
    }
    return uniqueOrders.size;
  }
}

module.exports = new ForteService();
module.exports.ForteService = ForteService;
module.exports.FORTE_PAYMENT_METHOD = FORTE_PAYMENT_METHOD;
module.exports.mapForteStatus = mapForteStatus;
module.exports.normalizeFortePayload = normalizeFortePayload;
module.exports.normalizeLanguage = normalizeLanguage;
module.exports.normalizePublicKey = normalizePublicKey;
module.exports.toMinorUnits = toMinorUnits;
module.exports.verifyForteWebhook = verifyForteWebhook;

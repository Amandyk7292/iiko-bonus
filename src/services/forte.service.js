const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');
const kaspiService = require('./kaspi.service');
const { recordSystemEvent } = require('./analytics-event.service');
const { forecastOrderEta } = require('./eta.service');

const DEFAULT_API_BASE_URL = 'https://api.fortebank.com';
const FORTE_HPP_HOST = 'ecom.fortebank.com';
const FORTE_PAYMENT_METHOD = 'forte_card';
const FINAL_PAYMENT_STATUSES = new Set(['paid', 'failed', 'expired', 'refunded']);
const ORDER_ID_PATTERN = /^\d{8,20}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USERNAME_PATTERN = /^Terminal(?:Sys|User)\/[A-Za-z0-9._-]{1,100}$/;

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

const forteError = (message, statusCode = 502, code = 'FORTE_REQUEST_FAILED', extra = {}) =>
  Object.assign(new Error(message), { statusCode, code, ...extra });

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

const formatAmount = (amount) => (toMinorUnits(amount) / 100).toFixed(2);

const trimBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');

const normalizeProviderOrderId = (value) => {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) return '';
  const normalized = String(value == null ? '' : value).trim();
  return ORDER_ID_PATTERN.test(normalized) ? normalized : '';
};

const normalizeOrderPassword = (value) => {
  const normalized = String(value == null ? '' : value).trim();
  return /^[\x21-\x7e]{6,256}$/.test(normalized) ? normalized : '';
};

const credentialEncryptionKey = (env = process.env) => {
  const secret = String(env.FORTE_ORDER_CREDENTIAL_KEY || '').trim();
  if (secret.length < 32) {
    throw forteError(
      'Шифрование данных заказа ForteBank не настроено',
      503,
      'FORTE_CREDENTIAL_ENCRYPTION_UNAVAILABLE',
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
};

const credentialAad = (internalOrderId, providerOrderId) =>
  Buffer.from(`forte-order:${internalOrderId}:${providerOrderId}`, 'utf8');

const encryptOrderPassword = (password, internalOrderId, providerOrderId, env = process.env) => {
  const normalized = normalizeOrderPassword(password);
  if (!normalized) {
    throw forteError(
      'ForteBank вернул некорректный пароль заказа',
      502,
      'FORTE_INVALID_CREATE_RESPONSE',
    );
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', credentialEncryptionKey(env), iv);
  cipher.setAAD(credentialAad(internalOrderId, providerOrderId));
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
};

const decryptOrderPassword = (envelope, internalOrderId, providerOrderId, env = process.env) => {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = String(envelope || '').split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra) {
      throw new Error('Invalid credential envelope');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      credentialEncryptionKey(env),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAAD(credentialAad(internalOrderId, providerOrderId));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const password = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    if (!normalizeOrderPassword(password)) throw new Error('Invalid decrypted password');
    return password;
  } catch (error) {
    if (error?.code === 'FORTE_CREDENTIAL_ENCRYPTION_UNAVAILABLE') throw error;
    throw forteError(
      'Данные заказа ForteBank невозможно расшифровать',
      503,
      'FORTE_CREDENTIAL_DECRYPTION_FAILED',
    );
  }
};

const normalizeHppBaseUrl = (value) => {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    return '';
  }
  const normalizedPath = parsed.pathname.replace(/\/+$/, '').toLowerCase();
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== FORTE_HPP_HOST ||
    parsed.port ||
    !['', '/flex'].includes(normalizedPath)
  ) {
    return '';
  }
  parsed.username = '';
  parsed.password = '';
  parsed.pathname = '/flex/';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
};

const buildHostedPaymentUrl = (hppUrl, providerOrderId, password) => {
  const baseUrl = normalizeHppBaseUrl(hppUrl);
  const orderId = normalizeProviderOrderId(providerOrderId);
  const orderPassword = normalizeOrderPassword(password);
  if (!baseUrl || !orderId || !orderPassword) {
    throw forteError(
      'ForteBank вернул некорректную ссылку оплаты',
      502,
      'FORTE_INVALID_CREATE_RESPONSE',
    );
  }
  const result = new URL(baseUrl);
  result.searchParams.set('id', orderId);
  result.searchParams.set('password', orderPassword);
  return result.toString();
};

const normalizeForteOrder = (payload = {}) => {
  const order = payload?.order || {};
  const rawStatus = cleanText(order.status, 40);
  return {
    id: normalizeProviderOrderId(order.id),
    typeRid: cleanText(order.typeRid, 40),
    status: rawStatus,
    amount: Number(order.amount),
    currency: cleanText(order.currency, 3).toUpperCase(),
    allowVoid: order?.type?.allowVoid === true,
    createTime: cleanText(order.createTime, 80),
  };
};

const mapForteStatus = (status) => {
  const normalized = String(status || '')
    .replace(/[\s_-]/g, '')
    .toLowerCase();
  if (['fullypaid', 'closed'].includes(normalized)) return 'paid';
  if (['declined', 'refused', 'rejected'].includes(normalized)) return 'failed';
  if (['expired', 'cancelled', 'canceled'].includes(normalized)) return 'expired';
  if (['refunded', 'voided'].includes(normalized)) return 'refunded';
  return 'pending';
};

const bankErrorCode = (body) =>
  cleanText(body?.errorCode || body?.code, 80).replace(/[^A-Za-z0-9._-]/g, '');

const bankErrorStatus = (response, body, fallback = 502) => {
  const code = bankErrorCode(body);
  if (
    response?.status === 401 ||
    response?.status === 403 ||
    ['InvalidLogin', 'NeedChangePwd', 'PwdTryLimitExceeded', 'UserSessionExpired'].includes(code)
  ) {
    return 503;
  }
  if (response?.status >= 400 && response?.status < 500) return 409;
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
      username: String(this.env.FORTE_API_USERNAME || '').trim(),
      password: String(this.env.FORTE_API_PASSWORD || '').trim(),
      merchantId: String(this.env.FORTE_MERCHANT_ID || '').trim(),
      test: this.env.FORTE_TEST_MODE === 'true',
      apiBaseUrl: trimBaseUrl(this.env.FORTE_API_BASE_URL, DEFAULT_API_BASE_URL),
      publicBaseUrl: trimBaseUrl(this.env.PUBLIC_BASE_URL, 'https://bulka.com.kz'),
      timeoutMs: Math.min(60000, Math.max(1000, Number(this.env.FORTE_TIMEOUT_MS) || 15000)),
    };
  }

  isConfigured() {
    const config = this.config();
    let apiUrl;
    try {
      apiUrl = new URL(config.apiBaseUrl);
    } catch {
      return false;
    }
    return (
      config.enabled &&
      USERNAME_PATTERN.test(config.username) &&
      config.password.length >= 8 &&
      config.password.length <= 512 &&
      config.merchantId.length > 0 &&
      String(this.env.FORTE_ORDER_CREDENTIAL_KEY || '').trim().length >= 32 &&
      apiUrl.protocol === 'https:' &&
      apiUrl.hostname.toLowerCase() === 'api.fortebank.com' &&
      !apiUrl.port
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
    return `Basic ${Buffer.from(`${config.username}:${config.password}`, 'utf8').toString(
      'base64',
    )}`;
  }

  async request(pathOrUrl, { method = 'GET', body, idempotencyKey } = {}) {
    const config = this.assertConfigured();
    const apiOrigin = new URL(config.apiBaseUrl).origin;
    const url = new URL(String(pathOrUrl), `${config.apiBaseUrl}/`);
    if (url.origin !== apiOrigin) {
      throw forteError('Некорректный адрес API ForteBank', 500, 'FORTE_INVALID_API_URL');
    }
    if (idempotencyKey && !UUID_PATTERN.test(String(idempotencyKey))) {
      throw forteError(
        'Некорректный ключ операции ForteBank',
        409,
        'FORTE_INVALID_IDEMPOTENCY_KEY',
      );
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
    let response;
    try {
      response = await this.fetchImpl(url.toString(), {
        method,
        signal: controller.signal,
        headers: {
          Authorization: this.basicAuthorization(config),
          Accept: 'application/json',
          ...(body && { 'Content-Type': 'application/json' }),
          ...(idempotencyKey && {
            'TXPG-Idempotence-Key': String(idempotencyKey),
          }),
        },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch {
      throw forteError(
        'Ответ ForteBank не получен. Проверьте операцию перед повторной попыткой.',
        502,
        'FORTE_NETWORK_ERROR',
        { retryable: true },
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
        payload = {};
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

  async paymentResponse(order) {
    const password = decryptOrderPassword(
      order.provider_auth_ciphertext,
      order.id,
      order.operation_id,
      this.env,
    );
    return {
      success: true,
      method: FORTE_PAYMENT_METHOD,
      operationId: String(order.operation_id),
      redirectUrl: buildHostedPaymentUrl(order.provider_redirect_url, order.operation_id, password),
      amount: Number(order.amount),
      orderType: order.fulfillment_type || 'pickup',
      branchId: order.branch_id == null ? null : String(order.branch_id),
      scheduledAt: order.scheduled_at || null,
      orderId: order.id == null ? undefined : String(order.id),
    };
  }

  async createProviderOrder({ amount, language, redirectUrl, description, idempotencyKey }) {
    const config = this.assertConfigured();
    const { response, body } = await this.request('/order', {
      method: 'POST',
      idempotencyKey,
      body: {
        order: {
          typeRid: 'Order_RID',
          language: normalizeLanguage(language),
          amount: formatAmount(amount),
          currency: 'KZT',
          hppRedirectUrl: redirectUrl,
          description: cleanText(description, 255) || 'Заказ Bulka',
        },
      },
    });
    if (!response.ok) {
      throw forteError(
        'ForteBank не смог создать платёж. Попробуйте позже.',
        bankErrorStatus(response, body),
        'FORTE_CREATE_REJECTED',
        { bankCode: bankErrorCode(body) || undefined, retryable: response.status >= 500 },
      );
    }

    const providerOrder = body?.order || {};
    const id = normalizeProviderOrderId(providerOrder.id);
    const password = normalizeOrderPassword(providerOrder.password);
    const hppBaseUrl = normalizeHppBaseUrl(providerOrder.hppUrl);
    if (!id || !password || !hppBaseUrl) {
      throw forteError(
        'ForteBank вернул неполные данные платежа',
        502,
        'FORTE_INVALID_CREATE_RESPONSE',
      );
    }
    buildHostedPaymentUrl(hppBaseUrl, id, password);
    return {
      id,
      password,
      hppBaseUrl,
      status: cleanText(providerOrder.status, 40) || 'Preparing',
      config,
    };
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
      return this.paymentResponse(existing);
    }

    const trackingId = crypto.randomUUID();
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
    const eta = await forecastOrderEta({
      branchId: checkout.branchId,
      orderType: checkout.orderType,
      scheduledAt: checkout.scheduledAt,
      preparationMinutes: pricing.preparationMinutes,
      deliveryAddress: checkout.deliveryAddress,
      deliveryZone: checkout.deliveryZone,
    });
    const providerOrder = await this.createProviderOrder({
      amount: pricing.total,
      language: options.language,
      redirectUrl: returnUrl,
      description,
      idempotencyKey: checkout.requestId,
    });
    const orderRecord = {
      ...this.orderService.orderRecord({
        customerId,
        operationId: providerOrder.id,
        normalizedPhone,
        pricing,
        cartItems: pricing.canonicalItems,
        checkout,
        paymentMethod: FORTE_PAYMENT_METHOD,
        eta,
      }),
      id: trackingId,
      provider_redirect_url: providerOrder.hppBaseUrl,
      provider_auth_ciphertext: encryptOrderPassword(
        providerOrder.password,
        trackingId,
        providerOrder.id,
        this.env,
      ),
      provider_status: providerOrder.status,
      payment_test: config.test,
    };
    const { data: savedOrder, error } = await this.db
      .from('kaspi_orders')
      .insert([orderRecord])
      .select('*')
      .single();
    if (error) {
      const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
      if (raced?.payment_method === FORTE_PAYMENT_METHOD) return this.paymentResponse(raced);
      throw forteError(
        'Платёж создан в ForteBank, но заказ не сохранён. Обратитесь в поддержку до повтора.',
        502,
        'FORTE_CREATE_SAVE_UNKNOWN',
        { retryable: true },
      );
    }

    await recordSystemEvent(customerId, {
      type: 'payment_created',
      orderId: savedOrder.id,
      branchId: checkout.branchId,
      properties: { paymentMethod: FORTE_PAYMENT_METHOD, amount: pricing.total },
    }).catch((error) => console.error('Не удалось записать аналитику ForteBank:', error.message));
    return this.paymentResponse(savedOrder);
  }

  async findOrder(orderOrId) {
    if (orderOrId && typeof orderOrId === 'object') {
      if (
        orderOrId.payment_method !== FORTE_PAYMENT_METHOD ||
        orderOrId.provider_payment_system === 'forte_widget'
      ) {
        throw forteError('Payment provider mismatch', 409, 'FORTE_PROVIDER_MISMATCH');
      }
      return orderOrId;
    }
    const identifier = String(orderOrId || '').trim();
    let query = this.db.from('kaspi_orders').select('*');
    if (UUID_PATTERN.test(identifier)) query = query.eq('id', identifier);
    else if (ORDER_ID_PATTERN.test(identifier)) query = query.eq('operation_id', identifier);
    else {
      throw forteError(
        'Некорректный идентификатор операции ForteBank',
        400,
        'FORTE_INVALID_ORDER_ID',
      );
    }
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw forteError('Заказ не найден', 404, 'FORTE_ORDER_NOT_FOUND');
    if (
      data.payment_method !== FORTE_PAYMENT_METHOD ||
      data.provider_payment_system === 'forte_widget'
    ) {
      throw forteError('Payment provider mismatch', 409, 'FORTE_PROVIDER_MISMATCH');
    }
    return data;
  }

  validateProviderOrder(order, normalized) {
    if (!normalized.id || normalized.id !== String(order.operation_id)) {
      throw forteError(
        'ForteBank вернул другой идентификатор заказа',
        422,
        'FORTE_ORDER_ID_MISMATCH',
      );
    }
    if (normalized.typeRid && normalized.typeRid !== 'Order_RID') {
      throw forteError('ForteBank вернул другой тип заказа', 422, 'FORTE_ORDER_TYPE_MISMATCH');
    }
    if (
      !Number.isFinite(normalized.amount) ||
      toMinorUnits(normalized.amount) !== toMinorUnits(order.amount)
    ) {
      throw forteError('ForteBank вернул другую сумму заказа', 422, 'FORTE_AMOUNT_MISMATCH');
    }
    if (normalized.currency !== 'KZT') {
      throw forteError('ForteBank вернул другую валюту заказа', 422, 'FORTE_CURRENCY_MISMATCH');
    }
  }

  async queryOrder(orderOrId) {
    const order = await this.findOrder(orderOrId);
    const password = decryptOrderPassword(
      order.provider_auth_ciphertext,
      order.id,
      order.operation_id,
      this.env,
    );
    const url = new URL(
      `/order/${encodeURIComponent(order.operation_id)}`,
      `${this.assertConfigured().apiBaseUrl}/`,
    );
    url.searchParams.set('password', password);
    url.searchParams.set('tranDetailLevel', '1');
    url.searchParams.set('orderDetailLevel', '1');
    const { response, body } = await this.request(url);
    if (!response.ok) {
      throw forteError(
        'ForteBank не подтвердил состояние платежа. Повторите проверку позже.',
        bankErrorStatus(response, body),
        'FORTE_STATUS_FAILED',
        { bankCode: bankErrorCode(body) || undefined, retryable: response.status >= 500 },
      );
    }
    const normalized = normalizeForteOrder(body);
    this.validateProviderOrder(order, normalized);
    return { order, normalized, response: body };
  }

  async applyProviderOrder(order, normalized) {
    this.validateProviderOrder(order, normalized);
    const nextStatus = mapForteStatus(normalized.status);
    const normalizedStatus = String(normalized.status || '')
      .replace(/[\s_-]/g, '')
      .toLowerCase();
    const unexpectedPartial = normalizedStatus === 'partpaid' && order.status === 'pending';
    const unknownStatus =
      !nextStatus ||
      (nextStatus === 'pending' &&
        !['preparing', 'authorized', 'partpaid', 'waitpushtran', 'funded'].includes(
          normalizedStatus,
        ));
    const metadata = {
      provider_status: normalized.status || 'Unknown',
      payment_reconciled_at: FINAL_PAYMENT_STATUSES.has(nextStatus)
        ? new Date().toISOString()
        : null,
      last_error:
        nextStatus === 'failed' || nextStatus === 'expired'
          ? `ForteBank: ${normalized.status || 'Unknown'}`
          : unexpectedPartial
            ? 'ForteBank сообщил частичную оплату; требуется ручная проверка.'
            : unknownStatus
              ? `Неизвестный статус ForteBank: ${normalized.status || 'empty'}`
              : null,
    };
    const { data: updatedMetadata, error } = await this.db
      .from('kaspi_orders')
      .update(metadata)
      .eq('id', order.id)
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!updatedMetadata) {
      throw forteError('Заказ изменился во время сверки', 409, 'FORTE_ORDER_CONFLICT');
    }

    let updatedOrder = updatedMetadata;
    if (nextStatus !== 'pending') {
      updatedOrder =
        (await this.orderService.updateOrderStatus(order.operation_id, nextStatus)) ||
        updatedMetadata;
    }
    if (nextStatus === 'paid') {
      updatedOrder = (await this.orderService.recordPaidOrder(order.operation_id)) || updatedOrder;
    } else if (
      nextStatus === 'refunded' &&
      typeof this.orderService.reverseOrderLoyalty === 'function'
    ) {
      updatedOrder = (await this.orderService.reverseOrderLoyalty(updatedOrder)) || updatedOrder;
    }
    return { order: updatedOrder, status: nextStatus, providerStatus: normalized.status };
  }

  async syncOrder(orderOrId) {
    const { order, normalized } = await this.queryOrder(orderOrId);
    return this.applyProviderOrder(order, normalized);
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

  async refundPayment(orderOrId, amount, { idempotencyKey } = {}) {
    const order = await this.findOrder(orderOrId);
    const requestId = String(idempotencyKey || crypto.randomUUID());
    if (!UUID_PATTERN.test(requestId)) {
      throw forteError(
        'Некорректный ключ возврата ForteBank',
        409,
        'FORTE_REFUND_INVALID_REQUEST_ID',
      );
    }
    const refundMinor = toMinorUnits(amount);
    const { normalized } = await this.queryOrder(order);
    const providerStatus = String(normalized.status || '').toLowerCase();
    if (!['fullypaid', 'closed', 'partpaid'].includes(providerStatus)) {
      throw forteError(
        'Состояние платежа ForteBank не позволяет выполнить возврат',
        409,
        'FORTE_REFUND_INVALID_STATE',
      );
    }
    const totalMinor = toMinorUnits(normalized.amount);
    if (refundMinor > totalMinor) {
      throw forteError(
        'Сумма возврата превышает сумму платежа',
        409,
        'FORTE_REFUND_INVALID_AMOUNT',
      );
    }
    const useVoid = normalized.allowVoid && refundMinor === totalMinor;
    const password = decryptOrderPassword(
      order.provider_auth_ciphertext,
      order.id,
      order.operation_id,
      this.env,
    );
    const url = new URL(
      `/order/${encodeURIComponent(order.operation_id)}/exec-tran`,
      `${this.assertConfigured().apiBaseUrl}/`,
    );
    url.searchParams.set('password', password);
    const requestBody = {
      tran: {
        ...(useVoid ? { voidKind: 'Full' } : { type: 'Refund' }),
        amount: formatAmount(amount),
        phase: 'Single',
      },
    };

    let result;
    try {
      result = await this.request(url, {
        method: 'POST',
        body: requestBody,
        idempotencyKey: requestId,
      });
    } catch (error) {
      error.refundUncertain = true;
      error.code = 'FORTE_REFUND_UNKNOWN';
      throw error;
    }
    const { response, body } = result;
    const reference = cleanText(
      body?.tran?.match?.tranActionId || body?.tran?.match?.ridByPmo,
      160,
    );
    if (response.ok && reference && body?.tran?.approvedPartial !== true) {
      return {
        reference,
        response: body,
        requestId,
        operation: useVoid ? 'void' : 'refund',
      };
    }
    if (response.status >= 400 && response.status < 500) {
      throw forteError(
        'ForteBank отклонил возврат',
        bankErrorStatus(response, body, 409),
        'FORTE_REFUND_REJECTED',
        { bankCode: bankErrorCode(body) || undefined, requestId },
      );
    }
    throw forteError(
      'ForteBank не подтвердил возврат. Требуется сверка.',
      502,
      'FORTE_REFUND_UNKNOWN',
      { refundUncertain: true, refundReference: reference || undefined, requestId },
    );
  }

  async reconcileOrders() {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error: staleError } = await this.db
      .from('kaspi_orders')
      .update({
        last_error: 'Автоматическая сверка ForteBank остановлена спустя 24 часа.',
      })
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .or('provider_payment_system.is.null,provider_payment_system.neq.forte_widget')
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
        .or('provider_payment_system.is.null,provider_payment_system.neq.forte_widget')
        .eq('status', 'pending')
        .gte('created_at', cutoff)
        .order('created_at', { ascending: true })
        .limit(50),
      this.db
        .from('kaspi_orders')
        .select('*')
        .in('status', ['paid', 'refunded'])
        .eq('payment_method', FORTE_PAYMENT_METHOD)
        .or('provider_payment_system.is.null,provider_payment_system.neq.forte_widget')
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
module.exports.buildHostedPaymentUrl = buildHostedPaymentUrl;
module.exports.decryptOrderPassword = decryptOrderPassword;
module.exports.encryptOrderPassword = encryptOrderPassword;
module.exports.formatAmount = formatAmount;
module.exports.mapForteStatus = mapForteStatus;
module.exports.normalizeForteOrder = normalizeForteOrder;
module.exports.normalizeHppBaseUrl = normalizeHppBaseUrl;
module.exports.normalizeLanguage = normalizeLanguage;
module.exports.toMinorUnits = toMinorUnits;

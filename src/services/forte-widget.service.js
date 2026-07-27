const crypto = require('node:crypto');
const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');
const kaspiService = require('./kaspi.service');
const { recordSystemEvent } = require('./analytics-event.service');
const { forecastOrderEta } = require('./eta.service');
const { normalizeLanguage, toMinorUnits } = require('./forte.service');

const CHECKOUT_API_ORIGIN = 'https://securepayments.fortebank.com';
const TRANSACTION_API_ORIGIN = 'https://gateway.fortebank.com';
const FORTE_PAYMENT_METHOD = 'forte_card';
const FORTE_WIDGET_INTEGRATION = 'forte_widget';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROVIDER_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{16,512}$/;
const FINAL_PAYMENT_STATUSES = new Set(['paid', 'failed', 'expired', 'refunded']);

const cleanText = (value, maximum = 1000) =>
  String(value == null ? '' : value)
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);

const widgetError = (message, statusCode = 502, code = 'FORTE_WIDGET_REQUEST_FAILED', extra = {}) =>
  Object.assign(new Error(message), { statusCode, code, ...extra });

const trimBaseUrl = (value, fallback) => String(value || fallback).replace(/\/+$/, '');

const normalizePhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 10) return `+7${digits}`;
  if (digits.length === 11 && digits.startsWith('7')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('8')) return `+7${digits.slice(1)}`;
  return null;
};

const normalizeProviderToken = (value) => {
  const token = String(value || '').trim();
  return PROVIDER_TOKEN_PATTERN.test(token) ? token : '';
};

const tokenEncryptionKey = (env = process.env) => {
  const secret = String(env.FORTE_WIDGET_TOKEN_KEY || '').trim();
  if (secret.length < 32) {
    throw widgetError(
      'Шифрование токенов ForteBank не настроено',
      503,
      'FORTE_WIDGET_TOKEN_ENCRYPTION_UNAVAILABLE',
    );
  }
  return crypto.createHash('sha256').update(secret, 'utf8').digest();
};

const providerTokenAad = (scope, ownerId) =>
  Buffer.from(`forte-widget:${scope}:${ownerId}`, 'utf8');

const encryptProviderToken = (token, scope, ownerId, env = process.env) => {
  const normalized = normalizeProviderToken(token);
  if (!normalized || !scope || !ownerId) {
    throw widgetError('ForteBank вернул некорректный токен', 502, 'FORTE_WIDGET_INVALID_TOKEN');
  }
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', tokenEncryptionKey(env), iv);
  cipher.setAAD(providerTokenAad(scope, ownerId));
  const ciphertext = Buffer.concat([cipher.update(normalized, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
};

const decryptProviderToken = (envelope, scope, ownerId, env = process.env) => {
  try {
    const [version, ivValue, tagValue, ciphertextValue, extra] = String(envelope || '').split('.');
    if (version !== 'v1' || !ivValue || !tagValue || !ciphertextValue || extra) {
      throw new Error('Invalid token envelope');
    }
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      tokenEncryptionKey(env),
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAAD(providerTokenAad(scope, ownerId));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
    const token = Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
    if (!normalizeProviderToken(token)) throw new Error('Invalid decrypted token');
    return token;
  } catch (error) {
    if (error?.code === 'FORTE_WIDGET_TOKEN_ENCRYPTION_UNAVAILABLE') throw error;
    throw widgetError(
      'Токен ForteBank невозможно расшифровать',
      503,
      'FORTE_WIDGET_TOKEN_DECRYPTION_FAILED',
    );
  }
};

const tokenFingerprint = (token) =>
  crypto.createHash('sha256').update(normalizeProviderToken(token), 'utf8').digest('hex');

const timingSafeTextEqual = (left, right) => {
  const leftBuffer = Buffer.from(String(left || ''), 'utf8');
  const rightBuffer = Buffer.from(String(right || ''), 'utf8');
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
};

const parseWebhookPublicKey = (value) => {
  const source = String(value || '')
    .trim()
    .replace(/\\n/g, '\n');
  if (!source) throw new Error('Missing webhook public key');
  if (source.includes('BEGIN PUBLIC KEY')) return crypto.createPublicKey(source);
  const compact = source.replace(/\s+/g, '');
  const decoded = Buffer.from(compact, 'base64');
  if (decoded.length < 64) throw new Error('Invalid webhook public key');
  try {
    return crypto.createPublicKey({ key: decoded, format: 'der', type: 'spki' });
  } catch {
    const pem = `-----BEGIN PUBLIC KEY-----\n${compact.match(/.{1,64}/g).join('\n')}\n-----END PUBLIC KEY-----`;
    return crypto.createPublicKey(pem);
  }
};

const verifyWebhookSignature = (rawBody, signature, env = process.env) => {
  if (!Buffer.isBuffer(rawBody) || rawBody.length === 0) return false;
  const signatureText = String(signature || '').trim();
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(signatureText)) return false;
  try {
    return crypto.verify(
      'RSA-SHA256',
      rawBody,
      parseWebhookPublicKey(env.FORTE_WIDGET_WEBHOOK_PUBLIC_KEY),
      Buffer.from(signatureText, 'base64'),
    );
  } catch {
    return false;
  }
};

const verifyWebhookBasicAuth = (authorization, env = process.env) => {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(String(authorization || '').trim());
  if (!match) return false;
  let decoded;
  try {
    decoded = Buffer.from(match[1], 'base64').toString('utf8');
  } catch {
    return false;
  }
  const expected = `${String(env.FORTE_WIDGET_SHOP_ID || '').trim()}:${String(
    env.FORTE_WIDGET_SECRET_KEY || '',
  ).trim()}`;
  return timingSafeTextEqual(decoded, expected);
};

const transactionFromCheckout = (checkout = {}) =>
  checkout?.gateway_response?.payment ||
  checkout?.gateway_response?.authorization ||
  checkout?.gateway_response?.charge ||
  null;

const normalizeWidgetCheckout = (payload = {}) => {
  const checkout = payload?.checkout || payload || {};
  const transaction = payload?.transaction || transactionFromCheckout(checkout) || {};
  const card =
    transaction?.credit_card || transaction?.card || checkout?.credit_card || checkout?.card || {};
  return {
    token: normalizeProviderToken(checkout.token || transaction?.additional_data?.vendor?.token),
    shopId: String(checkout.shop_id ?? checkout?.shop?.id ?? '').trim(),
    trackingId: cleanText(checkout?.order?.tracking_id || transaction.tracking_id, 255),
    amountMinor: Number(checkout?.order?.amount ?? transaction.amount),
    currency: cleanText(checkout?.order?.currency || transaction.currency, 3).toUpperCase(),
    status: cleanText(checkout.status || transaction.status, 60).toLowerCase(),
    transactionStatus: cleanText(transaction.status, 60).toLowerCase(),
    providerTransactionId: cleanText(transaction.uid || transaction.id, 100),
    finished: checkout.finished === true,
    expired: checkout.expired === true,
    test: checkout.test === true || transaction.test === true,
    card: {
      token: normalizeProviderToken(card.token),
      brand: cleanText(card.brand || transaction?.method?.brand, 30).toLowerCase(),
      lastFour: String(card.last_4 || card.last_four || '')
        .replace(/\D/g, '')
        .slice(-4),
      expMonth: Number(card.exp_month) || null,
      expYear: Number(card.exp_year) || null,
    },
  };
};

const widgetCheckoutAvailability = (payload = {}) => {
  const checkout = payload?.checkout || payload || {};
  const status = cleanText(checkout.status, 60).toLowerCase();
  const message = cleanText(checkout.message, 240);
  const methodTypes = Array.isArray(checkout?.payment_method?.types)
    ? checkout.payment_method.types.map((value) => cleanText(value, 40).toLowerCase())
    : null;
  const shopBrands = Array.isArray(checkout?.shop?.brands)
    ? checkout.shop.brands.map((value) => cleanText(value, 40).toLowerCase())
    : null;
  const availableMethods = [...(methodTypes || []), ...(shopBrands || [])].filter(Boolean);
  const explicitError =
    ['error', 'failed', 'rejected', 'declined'].includes(status) ||
    /gateway response not found|no available payment methods|нет доступных (?:способов|методов) оплаты|қолжетімді төлем (?:тәсілдері|әдістері) жоқ/i.test(
      message,
    );
  const declaredMethodCollections = [methodTypes, shopBrands].filter(Array.isArray);
  const explicitEmpty =
    declaredMethodCollections.length > 0 &&
    declaredMethodCollections.every((methods) => methods.length === 0);
  return {
    available: !explicitError && !explicitEmpty,
    availableMethods: [...new Set(availableMethods)],
    message,
    providerStatus: status,
  };
};

const mapWidgetStatus = (normalized = {}) => {
  if (normalized.expired) return 'expired';
  const transactionStatus = String(normalized.transactionStatus || '').toLowerCase();
  const status = String(normalized.status || '').toLowerCase();
  if (['successful', 'succeeded'].includes(transactionStatus) || status === 'successful') {
    return 'paid';
  }
  if (
    ['failed', 'declined', 'error', 'rejected', 'canceled', 'cancelled', 'expired'].includes(
      transactionStatus,
    ) ||
    (normalized.finished &&
      ['failed', 'declined', 'error', 'rejected', 'canceled', 'cancelled'].includes(status))
  ) {
    return status === 'expired' ? 'expired' : 'failed';
  }
  return 'pending';
};

const resolveCardSetupStatus = (providerStatus, hasReusableToken) =>
  providerStatus === 'paid' && !hasReusableToken ? 'pending' : providerStatus;

const localizedWidgetText = (language) => {
  const normalized = normalizeLanguage(language);
  return {
    language: normalized,
    returnButton: {
      ru: 'Вернуться в Bulka',
      kk: 'Bulka-ға оралу',
      en: 'Return to Bulka',
    }[normalized],
    saveCard: {
      ru: 'Сохранить карту для следующих покупок',
      kk: 'Келесі сатып алулар үшін картаны сақтау',
      en: 'Save card for future purchases',
    }[normalized],
    saveCardHint: {
      ru: 'Bulka сохранит только защищённый токен банка и последние 4 цифры.',
      kk: 'Bulka тек банктің қорғалған токенін және соңғы 4 санды сақтайды.',
      en: 'Bulka stores only the bank token and the last 4 digits.',
    }[normalized],
  };
};

const buildWidgetLaunchUrl = ({
  publicBaseUrl,
  token,
  operationId,
  language,
  test,
  purpose = 'order',
}) => {
  if (!normalizeProviderToken(token) || !UUID_PATTERN.test(String(operationId || ''))) {
    throw widgetError(
      'ForteBank вернул некорректную ссылку оплаты',
      502,
      'FORTE_WIDGET_INVALID_CREATE_RESPONSE',
    );
  }
  const url = new URL('/payments/forte-widget', `${trimBaseUrl(publicBaseUrl, '')}/`);
  url.hash = new URLSearchParams({
    token,
    order: String(operationId),
    language: normalizeLanguage(language),
    test: test ? '1' : '0',
    purpose: purpose === 'card-setup' ? 'card-setup' : 'order',
  }).toString();
  return url.toString();
};

class ForteWidgetService {
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
      enabled: this.env.FORTE_WIDGET_ENABLED === 'true',
      checkoutEnabled: this.env.FORTE_WIDGET_CHECKOUT_ENABLED !== 'false',
      shopId: String(this.env.FORTE_WIDGET_SHOP_ID || '').trim(),
      secretKey: String(this.env.FORTE_WIDGET_SECRET_KEY || '').trim(),
      test: this.env.FORTE_WIDGET_TEST_MODE === 'true',
      applePayEnabled: this.env.FORTE_WIDGET_APPLE_PAY_ENABLED === 'true',
      checkoutApiBaseUrl: trimBaseUrl(this.env.FORTE_WIDGET_CHECKOUT_API_URL, CHECKOUT_API_ORIGIN),
      transactionApiBaseUrl: trimBaseUrl(
        this.env.FORTE_WIDGET_TRANSACTION_API_URL,
        TRANSACTION_API_ORIGIN,
      ),
      publicBaseUrl: trimBaseUrl(this.env.PUBLIC_BASE_URL, 'https://bulka.com.kz'),
      timeoutMs: Math.min(60000, Math.max(1000, Number(this.env.FORTE_TIMEOUT_MS) || 15000)),
    };
  }

  isConfigured() {
    const config = this.config();
    try {
      const checkoutUrl = new URL(config.checkoutApiBaseUrl);
      const transactionUrl = new URL(config.transactionApiBaseUrl);
      parseWebhookPublicKey(this.env.FORTE_WIDGET_WEBHOOK_PUBLIC_KEY);
      return (
        config.enabled &&
        /^\d{1,20}$/.test(config.shopId) &&
        config.secretKey.length >= 16 &&
        config.secretKey.length <= 512 &&
        String(this.env.FORTE_WIDGET_TOKEN_KEY || '').trim().length >= 32 &&
        checkoutUrl.origin === CHECKOUT_API_ORIGIN &&
        checkoutUrl.pathname === '/' &&
        transactionUrl.origin === TRANSACTION_API_ORIGIN &&
        transactionUrl.pathname === '/'
      );
    } catch {
      return false;
    }
  }

  assertConfigured() {
    if (!this.isConfigured()) {
      throw widgetError(
        'Платёжный виджет ForteBank временно недоступен',
        503,
        'FORTE_WIDGET_NOT_CONFIGURED',
      );
    }
    return this.config();
  }

  availability() {
    return this.isConfigured();
  }

  checkoutAvailability() {
    return this.availability() && this.config().checkoutEnabled;
  }

  assertCheckoutAvailable() {
    return this.assertConfigured();
  }

  basicAuthorization(config = this.assertConfigured()) {
    return `Basic ${Buffer.from(`${config.shopId}:${config.secretKey}`, 'utf8').toString(
      'base64',
    )}`;
  }

  async request(
    pathOrUrl,
    { method = 'GET', body, apiVersion = 2, requestId, base = 'checkout' } = {},
  ) {
    const config = this.assertConfigured();
    const expectedOrigin = base === 'transaction' ? TRANSACTION_API_ORIGIN : CHECKOUT_API_ORIGIN;
    const baseUrl =
      base === 'transaction' ? config.transactionApiBaseUrl : config.checkoutApiBaseUrl;
    const url = new URL(String(pathOrUrl), `${baseUrl}/`);
    if (url.origin !== expectedOrigin) {
      throw widgetError('Некорректный адрес API ForteBank', 500, 'FORTE_WIDGET_INVALID_API_URL');
    }
    if (requestId && !UUID_PATTERN.test(String(requestId))) {
      throw widgetError(
        'Некорректный ключ операции ForteBank',
        409,
        'FORTE_WIDGET_INVALID_REQUEST_ID',
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
          'X-API-Version': String(apiVersion),
          ...(body && { 'Content-Type': 'application/json' }),
          ...(requestId && { RequestID: String(requestId) }),
        },
        ...(body && { body: JSON.stringify(body) }),
      });
    } catch {
      throw widgetError(
        'Ответ ForteBank не получен. Проверьте операцию перед повторной попыткой.',
        502,
        'FORTE_WIDGET_NETWORK_ERROR',
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

  async probeCheckout() {
    const config = this.assertConfigured();
    const trackingId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();
    const { response, body } = await this.request('/ctp/api/checkouts', {
      method: 'POST',
      requestId: trackingId,
      body: {
        checkout: {
          transaction_type: 'payment',
          attempts: 1,
          iframe: true,
          test: config.test,
          order: {
            amount: 0,
            currency: 'KZT',
            description: 'Bulka payment diagnostic',
            tracking_id: trackingId,
            expired_at: expiresAt,
          },
          settings: {
            return_url: `${config.publicBaseUrl}/orders`,
            cancel_url: `${config.publicBaseUrl}/orders`,
            language: 'ru',
          },
          payment_method: {
            types: ['credit_card'],
            ...(!config.applePayEnabled && { excluded_brands: ['apple_pay'] }),
          },
        },
      },
    });
    const token = normalizeProviderToken(body?.checkout?.token);
    if (!response.ok || !token) {
      return {
        available: false,
        message: 'Банк отклонил безопасную проверку',
        errorCode: 'FORTE_WIDGET_PROBE_REJECTED',
        providerStatus: cleanText(body?.checkout?.status, 60),
        availableMethods: [],
      };
    }
    const detail = await this.request(`/ctp/api/checkouts/${encodeURIComponent(token)}`).catch(
      () => null,
    );
    const payload = detail?.response?.ok ? detail.body : body;
    const availability = widgetCheckoutAvailability(payload);
    return {
      ...availability,
      message: availability.available
        ? 'Карты доступны, списания не было'
        : availability.message || 'Банк не вернул доступные карты',
      errorCode: availability.available ? null : 'FORTE_WIDGET_NO_PAYMENT_METHODS',
    };
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

  async defaultPaymentMethod(customerId, paymentMethodId) {
    let query = this.db
      .from('customer_payment_methods')
      .select('*')
      .eq('customer_id', customerId)
      .eq('provider', FORTE_WIDGET_INTEGRATION)
      .eq('status', 'active');
    query = paymentMethodId
      ? query.eq('id', String(paymentMethodId))
      : query.eq('is_default', true);
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data?.token_ciphertext) {
      if (paymentMethodId) {
        throw widgetError(
          'Сохранённая карта не найдена',
          404,
          'FORTE_WIDGET_PAYMENT_METHOD_NOT_FOUND',
        );
      }
      return null;
    }
    return {
      ...data,
      token: decryptProviderToken(
        data.token_ciphertext,
        'payment-method',
        `${customerId}:${data.id}`,
        this.env,
      ),
    };
  }

  async listPaymentMethods(customerId) {
    const { data, error } = await this.db
      .from('customer_payment_methods')
      .select(
        'id,provider,brand,last_four,exp_month,exp_year,is_default,status,created_at,last_used_at',
      )
      .eq('customer_id', customerId)
      .eq('provider', FORTE_WIDGET_INTEGRATION)
      .eq('status', 'active')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    if (error) throw error;
    return (data || []).map((method) => ({
      id: method.id,
      brand: cleanText(method.brand, 30) || 'card',
      lastFour: String(method.last_four || '').slice(-4),
      expMonth: method.exp_month,
      expYear: method.exp_year,
      isDefault: method.is_default === true,
    }));
  }

  async revokePaymentMethod(customerId, methodId) {
    if (!UUID_PATTERN.test(String(methodId || ''))) {
      throw widgetError('Некорректная карта', 400, 'FORTE_WIDGET_INVALID_PAYMENT_METHOD');
    }
    const { data: current, error: readError } = await this.db
      .from('customer_payment_methods')
      .select('*')
      .eq('id', methodId)
      .eq('customer_id', customerId)
      .eq('provider', FORTE_WIDGET_INTEGRATION)
      .maybeSingle();
    if (readError) throw readError;
    if (!current || current.status !== 'active') {
      throw widgetError('Карта не найдена', 404, 'FORTE_WIDGET_PAYMENT_METHOD_NOT_FOUND');
    }
    const { error } = await this.db
      .from('customer_payment_methods')
      .update({
        status: 'revoked',
        is_default: false,
        token_ciphertext: null,
        revoked_at: new Date().toISOString(),
      })
      .eq('id', methodId)
      .eq('customer_id', customerId);
    if (error) throw error;
    if (current.is_default) {
      const { data: replacement } = await this.db
        .from('customer_payment_methods')
        .select('id')
        .eq('customer_id', customerId)
        .eq('provider', FORTE_WIDGET_INTEGRATION)
        .eq('status', 'active')
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (replacement?.id) {
        await this.db
          .from('customer_payment_methods')
          .update({ is_default: true })
          .eq('id', replacement.id)
          .eq('customer_id', customerId);
      }
    }
    return true;
  }

  async setDefaultPaymentMethod(customerId, methodId) {
    if (!UUID_PATTERN.test(String(methodId || ''))) {
      throw widgetError('Некорректная карта', 400, 'FORTE_WIDGET_INVALID_PAYMENT_METHOD');
    }
    const { data, error } = await this.db.rpc('set_customer_payment_method_default', {
      p_customer_id: customerId,
      p_method_id: methodId,
    });
    if (error) {
      throw widgetError('Карта не найдена', 404, 'FORTE_WIDGET_PAYMENT_METHOD_NOT_FOUND');
    }
    return Array.isArray(data) ? data[0] : data;
  }

  async savePaymentMethod(customerId, card) {
    if (!normalizeProviderToken(card?.token) || !/^\d{4}$/.test(String(card?.lastFour || ''))) {
      return null;
    }
    const fingerprint = tokenFingerprint(card.token);
    const { data: existing, error: existingError } = await this.db
      .from('customer_payment_methods')
      .select('*')
      .eq('customer_id', customerId)
      .eq('provider', FORTE_WIDGET_INTEGRATION)
      .eq('token_fingerprint', fingerprint)
      .maybeSingle();
    if (existingError) throw existingError;
    const id = existing?.id || crypto.randomUUID();
    const tokenCiphertext = encryptProviderToken(
      card.token,
      'payment-method',
      `${customerId}:${id}`,
      this.env,
    );
    const hasValidExpiry =
      Number.isInteger(card.expMonth) &&
      card.expMonth >= 1 &&
      card.expMonth <= 12 &&
      Number.isInteger(card.expYear) &&
      card.expYear >= 2020 &&
      card.expYear <= 2200;
    const values = {
      customer_id: customerId,
      provider: FORTE_WIDGET_INTEGRATION,
      token_ciphertext: tokenCiphertext,
      token_fingerprint: fingerprint,
      brand: cleanText(card.brand, 30) || 'card',
      last_four: card.lastFour,
      exp_month: hasValidExpiry ? card.expMonth : null,
      exp_year: hasValidExpiry ? card.expYear : null,
      status: 'active',
      consented_at: new Date().toISOString(),
      revoked_at: null,
      last_used_at: new Date().toISOString(),
    };
    if (existing) {
      const { data, error } = await this.db
        .from('customer_payment_methods')
        .update(values)
        .eq('id', id)
        .eq('customer_id', customerId)
        .select('*')
        .single();
      if (error) throw error;
      return data;
    }
    const { data: currentDefault, error: defaultError } = await this.db
      .from('customer_payment_methods')
      .select('id')
      .eq('customer_id', customerId)
      .eq('provider', FORTE_WIDGET_INTEGRATION)
      .eq('status', 'active')
      .eq('is_default', true)
      .maybeSingle();
    if (defaultError) throw defaultError;
    let { data, error } = await this.db
      .from('customer_payment_methods')
      .insert([{ id, ...values, is_default: !currentDefault }])
      .select('*')
      .single();
    if (error) {
      const { data: collided, error: collisionReadError } = await this.db
        .from('customer_payment_methods')
        .select('*')
        .eq('customer_id', customerId)
        .eq('provider', FORTE_WIDGET_INTEGRATION)
        .eq('token_fingerprint', fingerprint)
        .maybeSingle();
      if (collisionReadError) throw collisionReadError;
      if (collided?.id) {
        const collidedValues = {
          ...values,
          token_ciphertext: encryptProviderToken(
            card.token,
            'payment-method',
            `${customerId}:${collided.id}`,
            this.env,
          ),
        };
        const retry = await this.db
          .from('customer_payment_methods')
          .update(collidedValues)
          .eq('id', collided.id)
          .eq('customer_id', customerId)
          .select('*')
          .single();
        if (retry.error) throw retry.error;
        return retry.data;
      }
      if (!currentDefault) {
        const retry = await this.db
          .from('customer_payment_methods')
          .insert([{ id, ...values, is_default: false }])
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }
    }
    if (error) throw error;
    return data;
  }

  async createProviderCheckout({
    amountMinor,
    customerId,
    phone,
    language,
    trackingId,
    description,
    savedCardToken,
    purpose = 'order',
  }) {
    const config = this.assertCheckoutAvailable();
    const localized = localizedWidgetText(language);
    const returnBase =
      purpose === 'card-setup'
        ? `${config.publicBaseUrl}/profile?payment=forte&setup=${encodeURIComponent(trackingId)}`
        : `${config.publicBaseUrl}/orders?payment=forte&order=${encodeURIComponent(trackingId)}`;
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const body = {
      checkout: {
        transaction_type: 'payment',
        attempts: 3,
        iframe: true,
        test: config.test,
        order: {
          amount: amountMinor,
          currency: 'KZT',
          description: cleanText(description, 255) || 'Заказ Bulka',
          tracking_id: trackingId,
          expired_at: expiresAt,
          additional_data: {
            contract: ['card_on_file', 'recurring'],
            card_on_file: { initiator: 'customer' },
          },
        },
        settings: {
          return_url: `${returnBase}&status=returned`,
          cancel_url: `${returnBase}&status=cancelled`,
          notification_url: `${config.publicBaseUrl}/webhooks/forte/widget`,
          auto_return: 0,
          button_next_text: localized.returnButton,
          language: localized.language,
          save_card_toggle: {
            display: true,
            customer_contract: true,
            text:
              purpose === 'card-setup'
                ? {
                    ru: 'Согласен привязать карту к профилю Bulka',
                    kk: 'Картаны Bulka профиліне байланыстыруға келісемін',
                    en: 'I agree to link this card to my Bulka profile',
                  }[localized.language]
                : localized.saveCard,
            hint: localized.saveCardHint,
          },
          another_card_toggle: { display: true },
          agreement_toggle: {
            value: false,
            url: `${config.publicBaseUrl}/public-offer`,
            text:
              localized.language === 'kk'
                ? '[Жария оферта] шарттарымен келісемін'
                : localized.language === 'en'
                  ? 'I accept the [public offer]'
                  : 'Принимаю условия [публичной оферты]',
          },
          style: {
            widget: {
              buttonsColor: '#FFB814',
              backgroundType: 8,
            },
          },
        },
        customer: {
          phone,
          external_id: customerId,
        },
        payment_method: {
          types: ['credit_card'],
          ...(!config.applePayEnabled && { excluded_brands: ['apple_pay'] }),
          ...(savedCardToken && { credit_card: { token: savedCardToken } }),
        },
      },
    };
    const { response, body: responseBody } = await this.request('/ctp/api/checkouts', {
      method: 'POST',
      body,
      requestId: trackingId,
    });
    const providerCheckout = responseBody?.checkout || {};
    const token = normalizeProviderToken(providerCheckout.token);
    if (!response.ok || !token) {
      throw widgetError(
        'ForteBank не смог открыть оплату. Попробуйте позже.',
        response.status >= 400 && response.status < 500 ? 409 : 502,
        'FORTE_WIDGET_CREATE_REJECTED',
        { retryable: response.status >= 500 },
      );
    }
    const detail = await this.request(`/ctp/api/checkouts/${encodeURIComponent(token)}`).catch(
      () => null,
    );
    if (detail?.response?.ok) {
      const paymentAvailability = widgetCheckoutAvailability(detail.body);
      if (!paymentAvailability.available) {
        throw widgetError(
          'ForteBank не вернул доступные способы оплаты',
          409,
          'FORTE_WIDGET_NO_PAYMENT_METHODS',
          { retryable: false },
        );
      }
    }
    return { token, expiresAt, language: localized.language, request: body };
  }

  async paymentResponse(order, language = 'ru') {
    const token = decryptProviderToken(
      order.provider_checkout_token_ciphertext,
      'checkout',
      `${order.id}:${order.operation_id}`,
      this.env,
    );
    const config = this.assertConfigured();
    return {
      success: true,
      method: FORTE_PAYMENT_METHOD,
      integration: FORTE_WIDGET_INTEGRATION,
      operationId: String(order.operation_id),
      redirectUrl: buildWidgetLaunchUrl({
        publicBaseUrl: config.publicBaseUrl,
        token,
        operationId: order.operation_id,
        language,
        test: config.test,
      }),
      amount: Number(order.amount),
      orderType: order.fulfillment_type || 'pickup',
      branchId: order.branch_id == null ? null : String(order.branch_id),
      scheduledAt: order.scheduled_at || null,
      orderId: order.id == null ? undefined : String(order.id),
    };
  }

  async createCheckout(phone, pricing, customerId, checkout = {}, options = {}) {
    const config = this.assertCheckoutAvailable();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      throw widgetError('Некорректный номер телефона', 400, 'FORTE_WIDGET_INVALID_PHONE');
    }
    const existing = await this.existingRequest(customerId, checkout.requestId);
    if (existing) {
      if (
        existing.payment_method !== FORTE_PAYMENT_METHOD ||
        existing.provider_payment_system !== FORTE_WIDGET_INTEGRATION
      ) {
        throw widgetError(
          'Это оформление уже связано с другим способом оплаты',
          409,
          'PAYMENT_REQUEST_ALREADY_USED',
        );
      }
      return this.paymentResponse(existing, options.language);
    }
    const selectedMethod = await this.defaultPaymentMethod(
      customerId,
      options.paymentMethodId,
    ).catch((error) => {
      if (options.paymentMethodId) throw error;
      console.warn('Сохранённая карта ForteBank недоступна:', error.message);
      return null;
    });
    const operationId = UUID_PATTERN.test(String(checkout.requestId || ''))
      ? String(checkout.requestId)
      : crypto.randomUUID();
    const internalOrderId = crypto.randomUUID();
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
    const providerCheckout = await this.createProviderCheckout({
      amountMinor: toMinorUnits(pricing.total),
      customerId,
      phone: normalizedPhone,
      language: options.language,
      trackingId: operationId,
      description,
      savedCardToken: selectedMethod?.token,
    });
    const orderRecord = {
      ...this.orderService.orderRecord({
        customerId,
        operationId,
        normalizedPhone: normalizedPhone.replace(/^\+/, ''),
        pricing,
        cartItems: pricing.canonicalItems,
        checkout,
        paymentMethod: FORTE_PAYMENT_METHOD,
        eta,
      }),
      id: internalOrderId,
      provider_payment_system: FORTE_WIDGET_INTEGRATION,
      provider_checkout_token_ciphertext: encryptProviderToken(
        providerCheckout.token,
        'checkout',
        `${internalOrderId}:${operationId}`,
        this.env,
      ),
      provider_status: 'created',
      provider_redirect_url: `${config.publicBaseUrl}/payments/forte-widget`,
      payment_expires_at: providerCheckout.expiresAt,
      payment_test: config.test,
    };
    const { data: savedOrder, error } = await this.db
      .from('kaspi_orders')
      .insert([orderRecord])
      .select('*')
      .single();
    if (error) {
      const raced = await this.existingRequest(customerId, checkout.requestId).catch(() => null);
      if (
        raced?.payment_method === FORTE_PAYMENT_METHOD &&
        raced?.provider_payment_system === FORTE_WIDGET_INTEGRATION
      ) {
        return this.paymentResponse(raced, options.language);
      }
      throw widgetError(
        'Платёж создан в ForteBank, но заказ не сохранён. Обратитесь в поддержку до повтора.',
        502,
        'FORTE_WIDGET_CREATE_SAVE_UNKNOWN',
        { retryable: true },
      );
    }
    await recordSystemEvent(customerId, {
      type: 'payment_created',
      orderId: savedOrder.id,
      branchId: checkout.branchId,
      properties: {
        paymentMethod: FORTE_PAYMENT_METHOD,
        integration: FORTE_WIDGET_INTEGRATION,
        amount: pricing.total,
      },
    }).catch((error) => console.error('Не удалось записать аналитику ForteBank:', error.message));
    return this.paymentResponse(savedOrder, providerCheckout.language);
  }

  async cardSetupResponse(setup, language = 'ru') {
    const token = decryptProviderToken(
      setup.checkout_token_ciphertext,
      'card-setup',
      `${setup.customer_id}:${setup.id}`,
      this.env,
    );
    const config = this.assertConfigured();
    return {
      success: true,
      method: FORTE_PAYMENT_METHOD,
      integration: FORTE_WIDGET_INTEGRATION,
      purpose: 'card-setup',
      operationId: String(setup.id),
      redirectUrl: buildWidgetLaunchUrl({
        publicBaseUrl: config.publicBaseUrl,
        token,
        operationId: setup.id,
        language,
        test: config.test,
        purpose: 'card-setup',
      }),
    };
  }

  async createCardSetup(customerId, phone, language = 'ru') {
    const config = this.assertCheckoutAvailable();
    const normalizedPhone = normalizePhone(phone);
    if (!normalizedPhone) {
      throw widgetError('Некорректный номер телефона', 400, 'FORTE_WIDGET_INVALID_PHONE');
    }
    const operationId = crypto.randomUUID();
    const providerCheckout = await this.createProviderCheckout({
      amountMinor: 0,
      customerId,
      phone: normalizedPhone,
      language,
      trackingId: operationId,
      description: 'Привязка карты к профилю Bulka',
      purpose: 'card-setup',
    });
    const setup = {
      id: operationId,
      customer_id: customerId,
      provider: FORTE_WIDGET_INTEGRATION,
      checkout_token_ciphertext: encryptProviderToken(
        providerCheckout.token,
        'card-setup',
        `${customerId}:${operationId}`,
        this.env,
      ),
      status: 'pending',
      provider_status: 'created',
      payment_test: config.test,
      expires_at: providerCheckout.expiresAt,
    };
    const { data, error } = await this.db
      .from('customer_payment_method_setups')
      .insert([setup])
      .select('*')
      .single();
    if (error) {
      throw widgetError(
        'Привязка создана в ForteBank, но не сохранена. Не повторяйте попытку сразу.',
        502,
        'FORTE_WIDGET_CARD_SETUP_SAVE_UNKNOWN',
        { retryable: true },
      );
    }
    return this.cardSetupResponse(data, providerCheckout.language);
  }

  async findCardSetup(operationId, customerId) {
    if (!UUID_PATTERN.test(String(operationId || ''))) {
      throw widgetError(
        'Некорректный идентификатор привязки карты',
        400,
        'FORTE_WIDGET_INVALID_CARD_SETUP_ID',
      );
    }
    let query = this.db
      .from('customer_payment_method_setups')
      .select('*')
      .eq('id', String(operationId))
      .eq('provider', FORTE_WIDGET_INTEGRATION);
    if (customerId) query = query.eq('customer_id', String(customerId));
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) {
      throw widgetError(
        'Операция привязки карты не найдена',
        404,
        'FORTE_WIDGET_CARD_SETUP_NOT_FOUND',
      );
    }
    return data;
  }

  validateCardSetup(setup, normalized, expectedToken, options) {
    this.validateCheckout(
      {
        operation_id: setup.id,
        amount: 0,
        payment_test: setup.payment_test,
      },
      normalized,
      expectedToken,
      options,
    );
  }

  async applyProviderCardSetup(
    setup,
    normalized,
    expectedToken,
    { allowMissingShop = false } = {},
  ) {
    this.validateCardSetup(setup, normalized, expectedToken, {
      allowMissingShop,
    });
    const providerStatus = mapWidgetStatus(normalized);
    const hasReusableToken =
      providerStatus === 'paid' &&
      Boolean(normalized.card.token) &&
      /^\d{4}$/.test(normalized.card.lastFour);
    const nextStatus = resolveCardSetupStatus(providerStatus, hasReusableToken);

    if (hasReusableToken) {
      await this.savePaymentMethod(setup.customer_id, normalized.card);
    }

    const { data, error } = await this.db
      .from('customer_payment_method_setups')
      .update({
        status: nextStatus,
        checkout_token_ciphertext: FINAL_PAYMENT_STATUSES.has(nextStatus)
          ? null
          : setup.checkout_token_ciphertext,
        provider_status:
          providerStatus === 'paid' && !hasReusableToken
            ? 'successful_awaiting_card_token'
            : normalized.status || normalized.transactionStatus || nextStatus,
        provider_transaction_id: normalized.providerTransactionId || null,
        completed_at: FINAL_PAYMENT_STATUSES.has(nextStatus) ? new Date().toISOString() : null,
      })
      .eq('id', setup.id)
      .eq('customer_id', setup.customer_id)
      .eq('provider', FORTE_WIDGET_INTEGRATION)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!data) {
      throw widgetError(
        'Операция привязки изменилась во время сверки',
        409,
        'FORTE_WIDGET_CARD_SETUP_CONFLICT',
      );
    }
    return { setup: data, status: nextStatus };
  }

  async queryCardSetup(setupOrOperationId, customerId) {
    const setup =
      typeof setupOrOperationId === 'object'
        ? setupOrOperationId
        : await this.findCardSetup(setupOrOperationId, customerId);
    const token = decryptProviderToken(
      setup.checkout_token_ciphertext,
      'card-setup',
      `${setup.customer_id}:${setup.id}`,
      this.env,
    );
    const { response, body } = await this.request(
      `/ctp/api/checkouts/${encodeURIComponent(token)}`,
    );
    if (!response.ok) {
      throw widgetError(
        'ForteBank не подтвердил привязку карты. Повторите проверку позже.',
        response.status >= 400 && response.status < 500 ? 409 : 502,
        'FORTE_WIDGET_CARD_SETUP_STATUS_FAILED',
        { retryable: response.status >= 500 },
      );
    }
    const normalized = normalizeWidgetCheckout(body);
    this.validateCardSetup(setup, normalized, token);
    return { setup, normalized, token };
  }

  async syncCardSetup(setupOrOperationId, customerId) {
    const { setup, normalized, token } = await this.queryCardSetup(setupOrOperationId, customerId);
    return this.applyProviderCardSetup(setup, normalized, token);
  }

  async getCardSetupStatus(operationId, customerId) {
    return this.findCardSetup(operationId, customerId);
  }

  async findOrder(operationId, customerId) {
    if (!UUID_PATTERN.test(String(operationId || ''))) {
      throw widgetError(
        'Некорректный идентификатор операции ForteBank',
        400,
        'FORTE_WIDGET_INVALID_ORDER_ID',
      );
    }
    let query = this.db
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .eq('provider_payment_system', FORTE_WIDGET_INTEGRATION);
    if (customerId) query = query.eq('customer_id', String(customerId));
    const { data, error } = await query.maybeSingle();
    if (error) throw error;
    if (!data) throw widgetError('Заказ не найден', 404, 'FORTE_WIDGET_ORDER_NOT_FOUND');
    return data;
  }

  validateCheckout(order, normalized, expectedToken, { allowMissingShop = false } = {}) {
    if (
      !normalized.token ||
      !timingSafeTextEqual(normalized.token, expectedToken) ||
      normalized.trackingId !== String(order.operation_id)
    ) {
      throw widgetError(
        'ForteBank вернул другой идентификатор заказа',
        422,
        'FORTE_WIDGET_ORDER_ID_MISMATCH',
      );
    }
    const config = this.assertConfigured();
    if (normalized.shopId !== config.shopId && !(allowMissingShop && !normalized.shopId)) {
      throw widgetError('ForteBank вернул другой магазин', 422, 'FORTE_WIDGET_SHOP_MISMATCH');
    }
    const expectedAmountMinor = Number(order.amount) === 0 ? 0 : toMinorUnits(order.amount);
    if (
      !Number.isSafeInteger(normalized.amountMinor) ||
      normalized.amountMinor !== expectedAmountMinor ||
      normalized.currency !== 'KZT' ||
      normalized.test !== config.test
    ) {
      throw widgetError(
        'ForteBank вернул другие параметры платежа',
        422,
        'FORTE_WIDGET_PAYMENT_MISMATCH',
      );
    }
  }

  async applyProviderCheckout(order, normalized, expectedToken, options) {
    this.validateCheckout(order, normalized, expectedToken, options);
    const nextStatus = mapWidgetStatus(normalized);
    const metadata = {
      provider_status: normalized.status || normalized.transactionStatus || 'pending',
      provider_transaction_id: normalized.providerTransactionId || null,
      provider_payment_system: FORTE_WIDGET_INTEGRATION,
      provider_card_last_four: /^\d{4}$/.test(normalized.card.lastFour)
        ? normalized.card.lastFour
        : null,
      payment_reconciled_at: FINAL_PAYMENT_STATUSES.has(nextStatus)
        ? new Date().toISOString()
        : null,
      last_error:
        nextStatus === 'failed' || nextStatus === 'expired'
          ? `ForteBank Widget: ${normalized.status || normalized.transactionStatus || nextStatus}`
          : null,
    };
    const { data: updatedMetadata, error } = await this.db
      .from('kaspi_orders')
      .update(metadata)
      .eq('id', order.id)
      .eq('provider_payment_system', FORTE_WIDGET_INTEGRATION)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!updatedMetadata) {
      throw widgetError('Заказ изменился во время сверки', 409, 'FORTE_WIDGET_ORDER_CONFLICT');
    }
    let updatedOrder = updatedMetadata;
    if (nextStatus !== 'pending') {
      updatedOrder =
        (await this.orderService.updateOrderStatus(order.operation_id, nextStatus)) ||
        updatedMetadata;
    }
    if (nextStatus === 'paid') {
      if (normalized.card.token) {
        await this.savePaymentMethod(order.customer_id, normalized.card).catch((error) =>
          console.error('Не удалось сохранить токен карты ForteBank:', error.message),
        );
      }
      updatedOrder = (await this.orderService.recordPaidOrder(order.operation_id)) || updatedOrder;
    } else if (
      nextStatus === 'refunded' &&
      typeof this.orderService.reverseOrderLoyalty === 'function'
    ) {
      updatedOrder = (await this.orderService.reverseOrderLoyalty(updatedOrder)) || updatedOrder;
    }
    return { order: updatedOrder, status: nextStatus };
  }

  async queryOrder(orderOrOperationId, customerId) {
    const order =
      typeof orderOrOperationId === 'object'
        ? orderOrOperationId
        : await this.findOrder(orderOrOperationId, customerId);
    const token = decryptProviderToken(
      order.provider_checkout_token_ciphertext,
      'checkout',
      `${order.id}:${order.operation_id}`,
      this.env,
    );
    const { response, body } = await this.request(
      `/ctp/api/checkouts/${encodeURIComponent(token)}`,
    );
    if (!response.ok) {
      throw widgetError(
        'ForteBank не подтвердил состояние платежа. Повторите проверку позже.',
        response.status >= 400 && response.status < 500 ? 409 : 502,
        'FORTE_WIDGET_STATUS_FAILED',
        { retryable: response.status >= 500 },
      );
    }
    const normalized = normalizeWidgetCheckout(body);
    this.validateCheckout(order, normalized, token);
    return { order, normalized, token };
  }

  async syncOrder(orderOrOperationId, customerId) {
    const { order, normalized, token } = await this.queryOrder(orderOrOperationId, customerId);
    return this.applyProviderCheckout(order, normalized, token);
  }

  async getOrderStatus(operationId, customerId) {
    return this.findOrder(operationId, customerId);
  }

  authenticateWebhook(headers, rawBody) {
    if (!verifyWebhookBasicAuth(headers?.authorization, this.env)) {
      throw widgetError('Webhook authentication failed', 401, 'FORTE_WIDGET_WEBHOOK_AUTH_FAILED');
    }
    if (!verifyWebhookSignature(rawBody, headers?.['content-signature'], this.env)) {
      throw widgetError(
        'Webhook signature verification failed',
        401,
        'FORTE_WIDGET_WEBHOOK_SIGNATURE_FAILED',
      );
    }
  }

  async handleWebhook(payload, rawBody, headers = {}) {
    this.assertConfigured();
    this.authenticateWebhook(headers, rawBody);
    const normalized = normalizeWidgetCheckout(payload);
    if (!UUID_PATTERN.test(normalized.trackingId)) {
      throw widgetError(
        'Webhook tracking ID is invalid',
        422,
        'FORTE_WIDGET_WEBHOOK_INVALID_TRACKING_ID',
      );
    }
    try {
      const order = await this.findOrder(normalized.trackingId);
      const expectedToken = decryptProviderToken(
        order.provider_checkout_token_ciphertext,
        'checkout',
        `${order.id}:${order.operation_id}`,
        this.env,
      );
      return this.applyProviderCheckout(order, normalized, expectedToken, {
        allowMissingShop: true,
      });
    } catch (error) {
      if (error?.code !== 'FORTE_WIDGET_ORDER_NOT_FOUND') throw error;
    }
    let setup;
    try {
      setup = await this.findCardSetup(normalized.trackingId);
    } catch (error) {
      if (error?.code !== 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND') throw error;
      console.warn(
        `ForteBank Widget прислал событие для завершённой проверки ${normalized.trackingId}`,
      );
      return { ignored: true };
    }
    const expectedToken = decryptProviderToken(
      setup.checkout_token_ciphertext,
      'card-setup',
      `${setup.customer_id}:${setup.id}`,
      this.env,
    );
    return this.applyProviderCardSetup(setup, normalized, expectedToken, {
      allowMissingShop: true,
    });
  }

  async refundPayment(order, amount, { idempotencyKey, reason } = {}) {
    const config = this.assertConfigured();
    if (
      order?.provider_payment_system !== FORTE_WIDGET_INTEGRATION ||
      !UUID_PATTERN.test(String(order?.provider_transaction_id || ''))
    ) {
      throw widgetError(
        'У заказа отсутствует подтверждённая транзакция ForteBank',
        409,
        'FORTE_WIDGET_REFUND_TRANSACTION_MISSING',
      );
    }
    const requestId = String(idempotencyKey || crypto.randomUUID());
    const amountMinor = toMinorUnits(amount);
    const { response, body } = await this.request('/transactions/refunds', {
      base: 'transaction',
      apiVersion: 3,
      method: 'POST',
      requestId,
      body: {
        request: {
          parent_uid: order.provider_transaction_id,
          amount: amountMinor,
          reason: cleanText(reason, 255) || 'Возврат по заказу Bulka',
          additional_data: { referer: config.publicBaseUrl },
        },
      },
    });
    const transaction = body?.transaction || {};
    const reference = cleanText(transaction.uid || transaction.id, 160);
    if (
      response.ok &&
      reference &&
      String(transaction.status || '').toLowerCase() === 'successful'
    ) {
      return { reference, response: body, requestId, operation: 'refund' };
    }
    if (response.status >= 400 && response.status < 500) {
      throw widgetError('ForteBank отклонил возврат', 409, 'FORTE_WIDGET_REFUND_REJECTED', {
        requestId,
      });
    }
    throw widgetError(
      'ForteBank не подтвердил возврат. Требуется сверка.',
      502,
      'FORTE_WIDGET_REFUND_UNKNOWN',
      {
        refundUncertain: true,
        refundReference: reference || undefined,
        requestId,
      },
    );
  }

  async reconcileOrders() {
    if (!this.availability()) return 0;
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data, error } = await this.db
      .from('kaspi_orders')
      .select('*')
      .eq('payment_method', FORTE_PAYMENT_METHOD)
      .eq('provider_payment_system', FORTE_WIDGET_INTEGRATION)
      .eq('status', 'pending')
      .gte('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;
    for (const order of data || []) {
      try {
        await this.syncOrder(order);
      } catch (syncError) {
        console.error(`Не удалось сверить ForteBank Widget заказ ${order.id}:`, syncError.message);
      }
    }
    return (data || []).length;
  }
}

module.exports = new ForteWidgetService();
module.exports.ForteWidgetService = ForteWidgetService;
module.exports.FORTE_WIDGET_INTEGRATION = FORTE_WIDGET_INTEGRATION;
module.exports.buildWidgetLaunchUrl = buildWidgetLaunchUrl;
module.exports.decryptProviderToken = decryptProviderToken;
module.exports.encryptProviderToken = encryptProviderToken;
module.exports.localizedWidgetText = localizedWidgetText;
module.exports.mapWidgetStatus = mapWidgetStatus;
module.exports.normalizeWidgetCheckout = normalizeWidgetCheckout;
module.exports.parseWebhookPublicKey = parseWebhookPublicKey;
module.exports.resolveCardSetupStatus = resolveCardSetupStatus;
module.exports.tokenFingerprint = tokenFingerprint;
module.exports.verifyWebhookBasicAuth = verifyWebhookBasicAuth;
module.exports.verifyWebhookSignature = verifyWebhookSignature;
module.exports.widgetCheckoutAvailability = widgetCheckoutAvailability;

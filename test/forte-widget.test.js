const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CARD_SETUP_AMOUNT,
  CARD_SETUP_AMOUNT_MINOR,
  ForteWidgetService,
  MAX_SAVED_PAYMENT_METHODS,
  buildWidgetLaunchUrl,
  decryptProviderToken,
  encryptProviderToken,
  mapWidgetStatus,
  normalizeWidgetCheckout,
  resolveCardSetupStatus,
  tokenEncryptionKeyring,
  verifyWebhookBasicAuth,
  verifyWebhookSignature,
  widgetCheckoutAvailability,
} = require('../src/services/forte-widget.service');

const shopId = '123456';
const secretKey = 'widget-secret-key-longer-than-sixteen';
const tokenKey = 'widget-token-key-longer-than-thirty-two-characters';
const checkoutToken = 'a'.repeat(64);
const operationId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const providerTransactionId = '217615f9-b35f-4eb4-9f6d-777f2236bb25';
const refundRequestId = '317615f9-b35f-4eb4-9f6d-777f2236bb25';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const env = {
  FORTE_WIDGET_ENABLED: 'true',
  FORTE_WIDGET_CHECKOUT_ENABLED: 'true',
  FORTE_WIDGET_SHOP_ID: shopId,
  FORTE_WIDGET_SECRET_KEY: secretKey,
  FORTE_WIDGET_TOKEN_KEY: tokenKey,
  FORTE_WIDGET_WEBHOOK_PUBLIC_KEY: publicKeyPem,
  FORTE_WIDGET_TEST_MODE: 'false',
  FORTE_WIDGET_APPLE_PAY_ENABLED: 'false',
  FORTE_WIDGET_CHECKOUT_API_URL: 'https://securepayments.fortebank.com',
  FORTE_WIDGET_TRANSACTION_API_URL: 'https://gateway.fortebank.com',
  PUBLIC_BASE_URL: 'https://bulka.com.kz',
};

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
});

test('Forte checkout fallback keeps reconciliation and webhooks configured', () => {
  const service = new ForteWidgetService({
    env: { ...env, FORTE_WIDGET_CHECKOUT_ENABLED: 'false' },
  });
  assert.equal(service.availability(), true);
  assert.equal(service.checkoutAvailability(), false);
  assert.doesNotThrow(() => service.assertCheckoutAvailable());
});

test('card setup stops before Forte when three cards are already saved', async () => {
  let gatewayCalled = false;
  const service = new ForteWidgetService({
    env,
    fetchImpl: async () => {
      gatewayCalled = true;
      return response({});
    },
  });
  service.listPaymentMethods = async () =>
    Array.from({ length: MAX_SAVED_PAYMENT_METHODS }, (_, index) => ({
      id: `saved-card-${index + 1}`,
    }));

  await assert.rejects(
    () => service.createCardSetup('517615f9-b35f-4eb4-9f6d-777f2236bb25', '+77478180616', 'ru'),
    (error) => error.statusCode === 409 && error.code === 'FORTE_WIDGET_PAYMENT_METHOD_LIMIT',
  );
  assert.equal(gatewayCalled, false);
});

test('Forte checkout availability detects an explicitly empty provider response', () => {
  assert.deepEqual(
    widgetCheckoutAvailability({
      checkout: {
        status: 'error',
        message: 'No available payment methods',
        payment_method: { types: [] },
        shop: { brands: [] },
      },
    }),
    {
      available: false,
      availableMethods: [],
      message: 'No available payment methods',
      providerStatus: 'error',
    },
  );
  assert.equal(
    widgetCheckoutAvailability({
      checkout: {
        status: 'pending',
        payment_method: { types: ['credit_card'] },
      },
    }).available,
    true,
  );
  assert.equal(
    widgetCheckoutAvailability({
      checkout: {
        status: 'pending',
        payment_method: { types: [] },
      },
    }).available,
    false,
  );
  assert.equal(
    widgetCheckoutAvailability({
      checkout: {
        status: 'pending',
        message: 'Нет доступных методов оплаты',
        payment_method: { types: ['credit_card'] },
      },
    }).available,
    false,
  );
});

test('Forte checkout is available before the customer starts the card gateway', () => {
  assert.deepEqual(
    widgetCheckoutAvailability({
      checkout: {
        status: 'error',
        message: 'Gateway response not found.',
        payment_method: { types: ['credit_card'] },
        shop: { brands: ['visa', 'master'] },
      },
    }),
    {
      available: true,
      availableMethods: ['credit_card', 'visa', 'master'],
      message: 'Gateway response not found.',
      providerStatus: 'error',
    },
  );
  assert.equal(
    widgetCheckoutAvailability({
      checkout: {
        status: 'error',
        message: 'Gateway response not found.',
        payment_method: { types: [] },
        shop: { brands: [] },
      },
    }).available,
    false,
  );
});

test('scheduled Forte capability probe is read-only and accepts an authenticated 404', async () => {
  let requestOptions;
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (_url, options) => {
      requestOptions = options;
      return response({}, { ok: false, status: 404 });
    },
  });
  const result = await service.probeConnection();
  assert.equal(requestOptions.method, 'GET');
  assert.equal(requestOptions.body, undefined);
  assert.equal(result.available, true);
  assert.equal(result.readOnly, true);
});

test('Forte widget launch keeps the payment token out of the query string', () => {
  const url = new URL(
    buildWidgetLaunchUrl({
      publicBaseUrl: 'https://bulka.com.kz',
      token: checkoutToken,
      operationId,
      language: 'kk-KZ',
      test: false,
      purpose: 'card-setup',
    }),
  );
  const fragment = new URLSearchParams(url.hash.slice(1));
  assert.equal(url.origin, 'https://bulka.com.kz');
  assert.equal(url.pathname, '/payments/forte-widget');
  assert.equal(url.search, '');
  assert.equal(fragment.get('token'), checkoutToken);
  assert.equal(fragment.get('order'), operationId);
  assert.equal(fragment.get('language'), 'kk');
  assert.equal(fragment.get('purpose'), 'card-setup');
});

test('Forte provider tokens use authenticated encryption bound to their owner', () => {
  const encrypted = encryptProviderToken(checkoutToken, 'checkout', operationId, env);
  assert.match(encrypted, /^v2\.[A-Za-z0-9_-]{4,40}\./);
  assert.notEqual(encrypted, checkoutToken);
  assert.equal(decryptProviderToken(encrypted, 'checkout', operationId, env), checkoutToken);
  assert.throws(
    () => decryptProviderToken(encrypted, 'checkout', crypto.randomUUID(), env),
    (error) => error.code === 'FORTE_WIDGET_TOKEN_DECRYPTION_FAILED',
  );
});

test('Forte token keyring decrypts rotated v2 and legacy v1 envelopes', () => {
  const previousKey = 'previous-widget-token-key-longer-than-thirty-two';
  const previousEnv = {
    ...env,
    FORTE_WIDGET_TOKEN_KEY: previousKey,
    FORTE_WIDGET_TOKEN_KEY_ID: 'previous-2026',
  };
  const rotatedEnv = {
    ...env,
    FORTE_WIDGET_TOKEN_KEY: 'current-widget-token-key-longer-than-thirty-two',
    FORTE_WIDGET_TOKEN_KEY_ID: 'current-2026',
    FORTE_WIDGET_TOKEN_PREVIOUS_KEYS: JSON.stringify({
      'previous-2026': previousKey,
    }),
  };
  const rotatedEnvelope = encryptProviderToken(checkoutToken, 'checkout', operationId, previousEnv);
  assert.equal(
    decryptProviderToken(rotatedEnvelope, 'checkout', operationId, rotatedEnv),
    checkoutToken,
  );

  const iv = crypto.randomBytes(12);
  const key = crypto.createHash('sha256').update(previousKey, 'utf8').digest();
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(`forte-widget:checkout:${operationId}`, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(checkoutToken, 'utf8'), cipher.final()]);
  const legacyEnvelope = [
    'v1',
    iv.toString('base64url'),
    cipher.getAuthTag().toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.');
  assert.equal(
    decryptProviderToken(legacyEnvelope, 'checkout', operationId, rotatedEnv),
    checkoutToken,
  );
});

test('Forte token keyring rejects one kid assigned to different keys', () => {
  const currentKey = 'current-widget-token-key-longer-than-thirty-two';
  const duplicateKey = 'different-widget-token-key-longer-than-thirty-two';
  assert.throws(
    () =>
      tokenEncryptionKeyring({
        ...env,
        FORTE_WIDGET_TOKEN_KEY: currentKey,
        FORTE_WIDGET_TOKEN_KEY_ID: 'duplicate-2026',
        FORTE_WIDGET_TOKEN_PREVIOUS_KEYS: JSON.stringify({
          'duplicate-2026': duplicateKey,
        }),
      }),
    (error) => error.code === 'FORTE_WIDGET_TOKEN_ENCRYPTION_UNAVAILABLE',
  );
  assert.doesNotThrow(() =>
    tokenEncryptionKeyring({
      ...env,
      FORTE_WIDGET_TOKEN_KEY: currentKey,
      FORTE_WIDGET_TOKEN_KEY_ID: 'duplicate-2026',
      FORTE_WIDGET_TOKEN_PREVIOUS_KEYS: JSON.stringify({
        'duplicate-2026': currentKey,
      }),
    }),
  );
});

test('Forte webhook requires valid Basic auth and an RSA signature over raw bytes', () => {
  const rawBody = Buffer.from('{"transaction":{"status":"successful"}}', 'utf8');
  const signature = crypto.sign('RSA-SHA256', rawBody, privateKey).toString('base64');
  const authorization = `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`;
  assert.equal(verifyWebhookBasicAuth(authorization, env), true);
  assert.equal(verifyWebhookBasicAuth(`${authorization}x`, env), false);
  assert.equal(verifyWebhookSignature(rawBody, signature, env), true);
  assert.equal(verifyWebhookSignature(Buffer.from(`${rawBody} `), signature, env), false);
});

test('Forte transaction webhooks expose tracking, checkout and reusable card tokens', () => {
  const cardToken = 'b'.repeat(64);
  const normalized = normalizeWidgetCheckout({
    transaction: {
      uid: providerTransactionId,
      status: 'successful',
      amount: CARD_SETUP_AMOUNT_MINOR,
      currency: 'KZT',
      tracking_id: operationId,
      test: false,
      credit_card: {
        token: cardToken,
        brand: 'visa',
        last_4: '1234',
        exp_month: 9,
        exp_year: 2030,
      },
      additional_data: { vendor: { token: checkoutToken } },
    },
  });
  assert.equal(normalized.token, checkoutToken);
  assert.equal(normalized.trackingId, operationId);
  assert.equal(normalized.card.token, cardToken);
  assert.equal(normalized.card.lastFour, '1234');
  assert.equal(mapWidgetStatus(normalized), 'paid');

  const service = new ForteWidgetService({ env });
  const setup = {
    id: operationId,
    amount: CARD_SETUP_AMOUNT,
    payment_test: false,
  };
  assert.throws(
    () => service.validateCardSetup(setup, normalized, checkoutToken),
    (error) => error.code === 'FORTE_WIDGET_SHOP_MISMATCH',
  );
  assert.doesNotThrow(() =>
    service.validateCardSetup(setup, normalized, checkoutToken, {
      allowMissingShop: true,
    }),
  );
});

test('Forte transaction API root response keeps transaction and saved-card fields', () => {
  const cardToken = 'c'.repeat(64);
  const normalized = normalizeWidgetCheckout({
    uid: providerTransactionId,
    status: 'successful',
    amount: CARD_SETUP_AMOUNT_MINOR,
    currency: 'KZT',
    tracking_id: operationId,
    type: 'payment',
    payment_method: {
      token: cardToken,
      brand: 'visa',
      last_4: '4321',
      exp_month: 8,
      exp_year: 2031,
    },
    transaction: {
      auth_code: '123456',
      status: 'successful',
    },
  });
  assert.equal(normalized.providerTransactionId, providerTransactionId);
  assert.equal(normalized.trackingId, operationId);
  assert.equal(normalized.card.token, cardToken);
  assert.equal(normalized.card.lastFour, '4321');
  assert.equal(mapWidgetStatus(normalized), 'paid');
});

test('card binding waits for a transaction webhook when checkout succeeds first', () => {
  assert.equal(resolveCardSetupStatus('paid', false), 'pending');
  assert.equal(resolveCardSetupStatus('paid', true), 'paid');
  assert.equal(resolveCardSetupStatus('failed', false), 'failed');
});

test('Forte card binding uses the bank-approved card-on-file contract and amount', async () => {
  const requests = [];
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ checkout: { token: checkoutToken } });
    },
  });
  const result = await service.createProviderCheckout({
    amountMinor: CARD_SETUP_AMOUNT_MINOR,
    customerId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
    phone: '+77012772233',
    language: 'ru',
    trackingId: operationId,
    description: 'Привязка карты к профилю Bulka',
    purpose: 'card-setup',
  });
  assert.equal(result.token, checkoutToken);
  assert.equal(requests.length, 2);
  const request = requests[0];
  assert.equal(request.url, 'https://securepayments.fortebank.com/ctp/api/checkouts');
  assert.equal(
    requests[1].url,
    `https://securepayments.fortebank.com/ctp/api/checkouts/${checkoutToken}`,
  );
  assert.equal(request.options.headers['X-API-Version'], '2');
  assert.equal(request.options.headers.RequestID, operationId);
  assert.match(request.options.headers.Authorization, /^Basic /);
  const body = JSON.parse(request.options.body);
  assert.equal(body.checkout.transaction_type, 'payment');
  assert.equal(body.checkout.order.amount, CARD_SETUP_AMOUNT_MINOR);
  assert.equal(body.checkout.order.currency, 'KZT');
  assert.deepEqual(body.checkout.order.additional_data, {
    contract: ['recurring', 'card_on_file'],
  });
  assert.equal(body.checkout.settings.language, 'ru');
  assert.equal(
    body.checkout.settings.return_url,
    `https://bulka.com.kz/profile?payment=forte&setup=${operationId}&status=returned`,
  );
  assert.equal(
    body.checkout.settings.cancel_url,
    `https://bulka.com.kz/profile?payment=forte&setup=${operationId}&status=cancelled`,
  );
  assert.equal(body.checkout.settings.save_card_toggle.display, true);
  assert.equal(body.checkout.settings.save_card_toggle.customer_contract, true);
  assert.equal(body.checkout.settings.save_card_toggle.text, 'Сохранить карту');
  assert.equal('hint' in body.checkout.settings.save_card_toggle, false);
  assert.deepEqual(body.checkout.payment_method.types, ['credit_card']);
  assert.deepEqual(body.checkout.payment_method.excluded_brands, ['apple_pay']);
});

test('Forte saved card uses customer-initiated auto-pay without requesting CVV', async () => {
  const requests = [];
  const savedCardToken = 'd'.repeat(64);
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ checkout: { token: checkoutToken } });
    },
  });
  await service.createProviderCheckout({
    amountMinor: 7000,
    customerId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
    phone: '+77012772233',
    language: 'ru',
    trackingId: operationId,
    description: 'Заказ Bulka',
    savedCardToken,
    savedCardContract: 'recurring_card_on_file',
  });
  const body = JSON.parse(requests[0].options.body);
  assert.deepEqual(body.checkout.order.additional_data, {
    contract: ['recurring', 'card_on_file'],
    card_on_file: { initiator: 'customer' },
  });
  assert.equal(body.checkout.settings.auto_pay, true);
  assert.equal(body.checkout.settings.agreed, true);
  assert.equal(body.checkout.settings.another_card_toggle.display, false);
  assert.equal('save_card_toggle' in body.checkout.settings, false);
  assert.equal('agreement_toggle' in body.checkout.settings, false);
  assert.deepEqual(body.checkout.payment_method.credit_card, {
    token: savedCardToken,
  });
});

test('Forte legacy saved card is relinked once instead of mixing token contracts', async () => {
  const requests = [];
  const savedCardToken = 'e'.repeat(64);
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ checkout: { token: checkoutToken } });
    },
  });
  await service.createProviderCheckout({
    amountMinor: 7000,
    customerId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
    phone: '+77012772233',
    language: 'ru',
    trackingId: operationId,
    description: 'Заказ Bulka',
    savedCardToken,
    savedCardContract: 'oneclick',
  });
  const body = JSON.parse(requests[0].options.body);
  assert.equal('auto_pay' in body.checkout.settings, false);
  assert.equal(body.checkout.settings.save_card_toggle.display, true);
  assert.equal(body.checkout.settings.save_card_toggle.customer_contract, true);
  assert.equal('credit_card' in body.checkout.payment_method, false);
  assert.deepEqual(body.checkout.order.additional_data, {
    contract: ['recurring', 'card_on_file'],
  });
});

test('successful legacy-card confirmation replaces its token in place', async () => {
  const legacyMethodId = '417615f9-b35f-4eb4-9f6d-777f2236bb25';
  const customerId = '517615f9-b35f-4eb4-9f6d-777f2236bb25';
  const newCardToken = 'f'.repeat(64);
  let updatedValues;
  let updatedMethodId;
  const db = {
    from(table) {
      assert.equal(table, 'customer_payment_methods');
      const filters = {};
      const query = {
        select() {
          return query;
        },
        eq(field, value) {
          filters[field] = value;
          return query;
        },
        async maybeSingle() {
          if (filters.token_fingerprint) return { data: null, error: null };
          if (filters.id === legacyMethodId) {
            return {
              data: {
                id: legacyMethodId,
                customer_id: customerId,
                provider: 'forte_widget',
                status: 'active',
                token_contract: 'oneclick',
              },
              error: null,
            };
          }
          return { data: null, error: null };
        },
        update(values) {
          updatedValues = values;
          const updateQuery = {
            eq(field, value) {
              if (field === 'id') updatedMethodId = value;
              return updateQuery;
            },
            select() {
              return updateQuery;
            },
            async single() {
              return {
                data: { id: legacyMethodId, ...values },
                error: null,
              };
            },
          };
          return updateQuery;
        },
      };
      return query;
    },
  };
  const service = new ForteWidgetService({ env, db });
  let capacityChecked = false;
  service.assertPaymentMethodCapacity = async () => {
    capacityChecked = true;
  };

  const saved = await service.savePaymentMethod(
    customerId,
    {
      token: newCardToken,
      brand: 'visa',
      lastFour: '1234',
      expMonth: 9,
      expYear: 2030,
    },
    { replaceMethodId: legacyMethodId },
  );

  assert.equal(capacityChecked, false);
  assert.equal(updatedMethodId, legacyMethodId);
  assert.equal(updatedValues.token_contract, 'recurring_card_on_file');
  assert.equal(saved.id, legacyMethodId);
  assert.equal(
    decryptProviderToken(
      updatedValues.token_ciphertext,
      'payment-method',
      `${customerId}:${legacyMethodId}`,
      env,
    ),
    newCardToken,
  );
});

test('Forte card binding reads a reusable token from transaction details', async () => {
  const cardToken = 'b'.repeat(64);
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url) => {
      assert.equal(url, `https://gateway.fortebank.com/transactions/${providerTransactionId}`);
      return response({
        transaction: {
          uid: providerTransactionId,
          status: 'successful',
          amount: CARD_SETUP_AMOUNT_MINOR,
          currency: 'KZT',
          tracking_id: operationId,
          test: false,
          credit_card: {
            token: cardToken,
            brand: 'visa',
            last_4: '1234',
            exp_month: 9,
            exp_year: 2030,
          },
        },
      });
    },
  });
  const hydrated = await service.hydrateProviderCard({
    status: 'successful',
    transactionStatus: 'successful',
    providerTransactionId,
    card: {
      token: '',
      brand: '',
      lastFour: '',
      expMonth: null,
      expYear: null,
    },
  });
  assert.equal(hydrated.card.token, cardToken);
  assert.equal(hydrated.card.brand, 'visa');
  assert.equal(hydrated.card.lastFour, '1234');
  assert.equal(hydrated.card.expMonth, 9);
  assert.equal(hydrated.card.expYear, 2030);
});

test('Forte card binding refunds the verification payment idempotently', async () => {
  const requests = [];
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({
        transaction: {
          uid: '417615f9-b35f-4eb4-9f6d-777f2236bb25',
          status: 'successful',
        },
      });
    },
  });
  const result = await service.refundCardSetupPayment(
    {
      amount: CARD_SETUP_AMOUNT,
      refund_request_id: refundRequestId,
    },
    providerTransactionId,
  );
  assert.equal(result.requestId, refundRequestId);
  assert.equal(result.reference, '417615f9-b35f-4eb4-9f6d-777f2236bb25');
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'https://gateway.fortebank.com/transactions/refunds');
  assert.equal(requests[0].options.headers['X-API-Version'], '3');
  assert.equal(requests[0].options.headers.RequestID, refundRequestId);
  const body = JSON.parse(requests[0].options.body);
  assert.equal(body.request.parent_uid, providerTransactionId);
  assert.equal(body.request.amount, CARD_SETUP_AMOUNT_MINOR);
  assert.match(body.request.reason, /привязки карты Bulka/);
});

test('Forte card binding accepts the direct transaction API refund response', async () => {
  const refundId = '417615f9-b35f-4eb4-9f6d-777f2236bb25';
  const service = new ForteWidgetService({
    env,
    fetchImpl: async () =>
      response({
        uid: refundId,
        type: 'refund',
        status: 'successful',
        transaction: {
          auth_code: '123456',
          status: 'successful',
        },
      }),
  });
  const result = await service.refundCardSetupPayment(
    {
      amount: CARD_SETUP_AMOUNT,
      refund_request_id: refundRequestId,
    },
    providerTransactionId,
  );
  assert.equal(result.reference, refundId);
  assert.equal(result.requestId, refundRequestId);
});

test('Forte order refund accepts the direct transaction API response', async () => {
  const refundId = '817615f9-b35f-4eb4-9f6d-777f2236bb25';
  const requests = [];
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) {
        return response({
          uid: refundId,
          type: 'refund',
          status: 'incomplete',
          code: 'P.9999',
          transaction: {
            status: 'incomplete',
          },
        });
      }
      assert.equal(url, `https://gateway.fortebank.com/transactions/${refundId}`);
      return response({
        uid: refundId,
        type: 'refund',
        status: 'successful',
        transaction: {
          auth_code: '123456',
          status: 'successful',
        },
      });
    },
  });
  const result = await service.refundPayment(
    {
      provider_payment_system: 'forte_widget',
      provider_transaction_id: providerTransactionId,
    },
    70,
    { idempotencyKey: refundRequestId, reason: 'Нет в наличии' },
  );
  assert.equal(result.reference, refundId);
  assert.equal(result.requestId, refundRequestId);
  assert.equal(result.operation, 'refund');
  assert.equal(requests.length, 2);
});

test('unknown verification refund remains retryable for reconciliation', async () => {
  const service = new ForteWidgetService({
    env,
    fetchImpl: async () =>
      response(
        {
          transaction: {
            uid: '717615f9-b35f-4eb4-9f6d-777f2236bb25',
            status: 'processing',
          },
        },
        { ok: false, status: 503 },
      ),
  });
  await assert.rejects(
    () =>
      service.refundCardSetupPayment(
        {
          amount: CARD_SETUP_AMOUNT,
          refund_request_id: refundRequestId,
        },
        providerTransactionId,
      ),
    (error) =>
      error.code === 'FORTE_WIDGET_CARD_SETUP_REFUND_UNKNOWN' &&
      error.refundUncertain === true &&
      error.refundReference === '717615f9-b35f-4eb4-9f6d-777f2236bb25',
  );
});

test('card token is retained while an uncertain verification refund reconciles', async () => {
  const updates = [];
  const setup = {
    id: operationId,
    customer_id: '517615f9-b35f-4eb4-9f6d-777f2236bb25',
    provider: 'forte_widget',
    checkout_token_ciphertext: 'encrypted-checkout-token',
    status: 'pending',
    provider_status: 'created',
    payment_test: false,
    amount: CARD_SETUP_AMOUNT,
    refund_status: 'pending',
    refund_request_id: refundRequestId,
  };
  const db = {
    from(table) {
      assert.equal(table, 'customer_payment_method_setups');
      return {
        update(values) {
          updates.push(values);
          const chain = {
            eq() {
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              return { data: { ...setup, ...values }, error: null };
            },
            then(resolve) {
              return resolve({ error: null });
            },
          };
          return chain;
        },
      };
    },
  };
  const service = new ForteWidgetService({ env, db });
  let saved = false;
  service.savePaymentMethod = async () => {
    saved = true;
  };
  service.refundCardSetupPayment = async () => {
    throw Object.assign(new Error('Refund is still processing'), {
      code: 'FORTE_WIDGET_CARD_SETUP_REFUND_UNKNOWN',
      refundUncertain: true,
    });
  };
  const normalized = normalizeWidgetCheckout({
    transaction: {
      uid: providerTransactionId,
      status: 'successful',
      amount: CARD_SETUP_AMOUNT_MINOR,
      currency: 'KZT',
      tracking_id: operationId,
      test: false,
      credit_card: {
        token: 'b'.repeat(64),
        brand: 'visa',
        last_4: '1234',
      },
      additional_data: { vendor: { token: checkoutToken } },
    },
  });
  await assert.rejects(
    () =>
      service.applyProviderCardSetup(setup, normalized, checkoutToken, {
        allowMissingShop: true,
      }),
    (error) => error.code === 'FORTE_WIDGET_CARD_SETUP_REFUND_UNKNOWN',
  );
  assert.equal(saved, true);
  assert.equal(updates.length, 2);
  assert.equal(updates[1].status, 'pending');
  assert.equal(updates[1].provider_status, 'successful_card_saved_refund_pending');
  assert.equal(updates[1].refund_status, 'unknown');
});

test('successful card binding is finalized only after its refund succeeds', async () => {
  const updates = [];
  const setup = {
    id: operationId,
    customer_id: '517615f9-b35f-4eb4-9f6d-777f2236bb25',
    provider: 'forte_widget',
    checkout_token_ciphertext: 'encrypted-checkout-token',
    status: 'pending',
    provider_status: 'created',
    payment_test: false,
    amount: CARD_SETUP_AMOUNT,
    refund_status: 'pending',
    refund_request_id: refundRequestId,
  };
  const db = {
    from(table) {
      assert.equal(table, 'customer_payment_method_setups');
      return {
        update(values) {
          updates.push(values);
          const chain = {
            eq() {
              return chain;
            },
            select() {
              return chain;
            },
            async maybeSingle() {
              return { data: { ...setup, ...values }, error: null };
            },
          };
          return chain;
        },
      };
    },
  };
  const service = new ForteWidgetService({ env, db });
  let refunded = false;
  let saved = false;
  service.refundCardSetupPayment = async (current, parentUid) => {
    assert.equal(current.refund_status, 'processing');
    assert.equal(parentUid, providerTransactionId);
    refunded = true;
    return {
      reference: '617615f9-b35f-4eb4-9f6d-777f2236bb25',
      requestId: refundRequestId,
    };
  };
  service.savePaymentMethod = async (customerId, card) => {
    assert.equal(customerId, setup.customer_id);
    assert.equal(card.lastFour, '1234');
    saved = true;
  };
  const normalized = normalizeWidgetCheckout({
    transaction: {
      uid: providerTransactionId,
      status: 'successful',
      amount: CARD_SETUP_AMOUNT_MINOR,
      currency: 'KZT',
      tracking_id: operationId,
      test: false,
      credit_card: {
        token: 'b'.repeat(64),
        brand: 'visa',
        last_4: '1234',
        exp_month: 9,
        exp_year: 2030,
      },
      additional_data: { vendor: { token: checkoutToken } },
    },
  });
  const result = await service.applyProviderCardSetup(setup, normalized, checkoutToken, {
    allowMissingShop: true,
  });
  assert.equal(refunded, true);
  assert.equal(saved, true);
  assert.equal(result.status, 'paid');
  assert.equal(updates.length, 2);
  assert.equal(updates[0].refund_status, 'processing');
  assert.equal(updates[1].refund_status, 'succeeded');
  assert.equal(updates[1].refund_transaction_id, '617615f9-b35f-4eb4-9f6d-777f2236bb25');
  assert.equal(updates[1].status, 'paid');
});

test('saved-card migration encrypts provider tokens and keeps tables service-only', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260727170000_forte_widget_saved_cards.sql',
    ),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.customer_payment_methods/i);
  assert.match(sql, /create table if not exists public\.customer_payment_method_setups/i);
  assert.match(sql, /token_ciphertext text/i);
  assert.match(sql, /enable row level security/i);
  assert.match(
    sql,
    /revoke all on table public\.customer_payment_methods from public, anon, authenticated/i,
  );
  assert.match(
    sql,
    /revoke all on table public\.customer_payment_method_setups from public, anon, authenticated/i,
  );
  assert.doesNotMatch(sql, /^\s*(card_number|cvc|cvv|pan_number)\s+[a-z]/im);

  const limitSql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260728171000_saved_payment_method_limit.sql',
    ),
    'utf8',
  );
  assert.match(limitSql, /v_active_count\s*>=\s*3/i);
  assert.match(limitSql, /pg_advisory_xact_lock/i);
  assert.match(limitSql, /customer_payment_methods_enforce_limit/i);

  const refundSql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260728134500_forte_card_setup_refunds.sql',
    ),
    'utf8',
  );
  assert.match(refundSql, /amount numeric\(12,\s*2\)/i);
  assert.match(refundSql, /refund_request_id uuid/i);
  assert.match(refundSql, /refund_status varchar\(24\)/i);
  assert.match(refundSql, /unique index.*refund_request/ims);

  const cardOnFileSql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260803130000_forte_card_on_file_tokens.sql',
    ),
    'utf8',
  );
  assert.match(cardOnFileSql, /token_contract varchar\(32\)/i);
  assert.match(cardOnFileSql, /recurring_card_on_file/i);
  assert.match(cardOnFileSql, /saved_payment_method_id uuid/i);
  assert.match(cardOnFileSql, /on delete set null/i);
  assert.doesNotMatch(cardOnFileSql, /token_ciphertext\s*=\s*null/i);
});

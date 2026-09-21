// Real request contract and signed bank events; all financial state is in memory.
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const { once } = require('node:events');
const { validateRequest } = require('../src/middlewares/validation.middleware');
const { checkoutPaymentBodySchema } = require('../src/contracts/customer-api.contract');
const {
  ForteWidgetService,
  encryptProviderToken,
  tokenFingerprint,
} = require('../src/services/forte-widget.service');
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  FORTE_WIDGET_ENABLED: 'true',
  FORTE_WIDGET_SHOP_ID: '123456',
  FORTE_WIDGET_SECRET_KEY: 's'.repeat(40),
  FORTE_WIDGET_TOKEN_KEY: 't'.repeat(40),
  FORTE_WIDGET_WEBHOOK_PUBLIC_KEY: publicKey.export({ type: 'spki', format: 'pem' }),
  FORTE_TIMEOUT_MS: '1000',
  PUBLIC_BASE_URL: 'https://bulka.com.kz',
};
const customerId = '517615f9-b35f-4eb4-9f6d-777f2236bb25';
const operationId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const methodId = '417615f9-b35f-4eb4-9f6d-777f2236bb25';
const checkoutToken = 'audit-checkout-token-2026-fictional';
const cardToken = 'audit-saved-card-token-2026-fictional';
const card = { token: cardToken, brand: 'visa', lastFour: '1234', expMonth: 9, expYear: 2030 };
function memoryDb(tables) {
  return {
    from(table) {
      const rows = (tables[table] ||= []);
      const filters = [];
      let patch;
      const result = () => {
        const found = rows.filter((row) => filters.every(([k, v]) => row[k] === v));
        if (patch) found.forEach((row) => Object.assign(row, patch));
        return found;
      };
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          filters.push([k, v]);
          return q;
        },
        insert(values) {
          rows.push(...values);
          return q;
        },
        update(value) {
          patch = value;
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        async single() {
          return { data: structuredClone(result()[0] || null), error: null };
        },
        async maybeSingle() {
          return q.single();
        },
        then(resolve, reject) {
          return Promise.resolve({ data: structuredClone(result()), error: null }).then(
            resolve,
            reject,
          );
        },
      };
      return q;
    },
  };
}
function successfulWebhook() {
  const payload = {
    checkout: {
      token: checkoutToken,
      shop_id: env.FORTE_WIDGET_SHOP_ID,
      status: 'successful',
      finished: true,
      order: { tracking_id: operationId, amount: 60000, currency: 'KZT' },
      gateway_response: {
        payment: {
          uid: '217615f9-b35f-4eb4-9f6d-777f2236bb25',
          status: 'successful',
          credit_card: {
            token: cardToken,
            brand: 'visa',
            last_4: '1234',
            exp_month: 9,
            exp_year: 2030,
          },
        },
      },
    },
  };
  const raw = Buffer.from(JSON.stringify(payload));
  return [
    payload,
    raw,
    {
      authorization:
        'Basic ' +
        Buffer.from(env.FORTE_WIDGET_SHOP_ID + ':' + env.FORTE_WIDGET_SECRET_KEY).toString(
          'base64',
        ),
      'content-signature': crypto.sign('RSA-SHA256', raw, privateKey).toString('base64'),
    },
  ];
}
test('P1: the current Flutter payment payload must pass the HTTP contract', async (t) => {
  const app = express();
  app.use(express.json());
  let reachedPayment = false;
  app.post(
    '/api/customer/forte-pay/create',
    validateRequest({ body: checkoutPaymentBodySchema }),
    (_req, res) => {
      reachedPayment = true;
      res.json({ success: true });
    },
  );
  app.use((err, _req, res, _next) =>
    res.status(err.statusCode || 500).json({ code: err.code, fields: err.fields }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    'http://127.0.0.1:' + server.address().port + '/api/customer/forte-pay/create',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(
        JSON.parse(
          fs.readFileSync(path.join(__dirname, 'fixtures/forte-web-client-request.json'), 'utf8'),
        ).body,
      ),
    },
  );
  const body = await response.json();
  assert.equal(response.status, 200, JSON.stringify({ body, reachedPayment }));
});
test('P1: a repeated signed payment webhook must not restore a deleted card', async () => {
  const order = {
    id: operationId,
    operation_id: operationId,
    customer_id: customerId,
    amount: 600,
    status: 'paid',
    provider_payment_system: 'forte_widget',
    provider_checkout_token_ciphertext: encryptProviderToken(
      checkoutToken,
      'checkout',
      operationId + ':' + operationId,
      env,
    ),
  };
  const revoked = {
    id: methodId,
    customer_id: customerId,
    provider: 'forte_widget',
    token_fingerprint: tokenFingerprint(cardToken),
    status: 'revoked',
    token_ciphertext: null,
    is_default: false,
    revoked_at: '2026-09-21T00:00:00Z',
  };
  const tables = { kaspi_orders: [order], customer_payment_methods: [revoked] };
  const service = new ForteWidgetService({
    env,
    db: memoryDb(tables),
    fetchImpl: async () => {
      throw Error('Bank network forbidden in audit');
    },
    orderService: { updateOrderStatus: async () => order, recordPaidOrder: async () => order },
  });
  service.findOrder = async () => structuredClone(order);
  await service.handleWebhook(...successfulWebhook());
  assert.equal(
    revoked.status,
    'revoked',
    'Old signed webhook changed revoked card back to active and restored its encrypted token',
  );
});
test('P1: a declined attempt must not prevent saving a later successful card attempt', async () => {
  const setup = {
    id: operationId,
    customer_id: customerId,
    provider: 'forte_widget',
    status: 'pending',
    amount: 0,
    refund_status: 'not_required',
    checkout_token_ciphertext: encryptProviderToken(
      checkoutToken,
      'card-setup',
      customerId + ':' + operationId,
      env,
    ),
  };
  const service = new ForteWidgetService({
    env,
    db: memoryDb({ customer_payment_method_setups: [setup] }),
    fetchImpl: async () => {
      throw Error('Bank network forbidden in audit');
    },
  });
  const normalized = {
    token: checkoutToken,
    shopId: env.FORTE_WIDGET_SHOP_ID,
    trackingId: operationId,
    amountMinor: 0,
    currency: 'KZT',
    test: false,
    status: 'pending',
    transactionStatus: 'failed',
    finished: false,
    expired: false,
    card: { token: '', lastFour: '' },
  };
  await service.applyProviderCardSetup({ ...setup }, normalized, checkoutToken);
  service.findOrder = async () => {
    throw Object.assign(new Error('No order'), { code: 'FORTE_WIDGET_ORDER_NOT_FOUND' });
  };
  const [payload] = successfulWebhook();
  payload.checkout.order.amount = 0;
  const raw = Buffer.from(JSON.stringify(payload));
  await service.handleWebhook(payload, raw, {
    authorization:
      'Basic ' +
      Buffer.from(env.FORTE_WIDGET_SHOP_ID + ':' + env.FORTE_WIDGET_SECRET_KEY).toString('base64'),
    'content-signature': crypto.sign('RSA-SHA256', raw, privateKey).toString('base64'),
  });
  assert.equal(
    setup.status,
    'paid',
    'First declined attempt finalized setup as failed; successful webhook was ignored',
  );
});
test('only a new explicit linking session may reactivate a previously deleted token', async () => {
  const method = {
    id: methodId,
    customer_id: customerId,
    provider: 'forte_widget',
    token_fingerprint: tokenFingerprint(cardToken),
    status: 'revoked',
    token_ciphertext: null,
    revoked_at: '2026-09-21T12:00:00Z',
  };
  const service = new ForteWidgetService({
    env,
    db: memoryDb({ customer_payment_methods: [method] }),
  });
  assert.equal(
    await service.savePaymentMethod(customerId, card, { relinkStartedAt: '2026-09-21T11:00:00Z' }),
    null,
  );
  assert.equal(method.status, 'revoked');
  await service.savePaymentMethod(customerId, card, { relinkStartedAt: '2026-09-21T13:00:00Z' });
  assert.equal(method.status, 'active');
});
test('P2: bank timeout must cover reading the response body', async () => {
  let signal;
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (_url, options) => {
      signal = options.signal;
      return {
        ok: true,
        status: 200,
        text: () =>
          new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve('{}'), 1250);
            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new Error('Response body aborted'));
              },
              { once: true },
            );
          }),
      };
    },
  });
  await assert.rejects(
    service.request('/ctp/api/checkouts/audit-fictional'),
    (error) => error.code === 'FORTE_WIDGET_NETWORK_ERROR',
  );
  assert.equal(
    signal.aborted,
    true,
    'Timeout must remain active until the bank response body has been read',
  );
});

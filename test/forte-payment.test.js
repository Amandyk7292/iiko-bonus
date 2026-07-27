const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ForteService,
  buildHostedPaymentUrl,
  decryptOrderPassword,
  encryptOrderPassword,
  formatAmount,
  mapForteStatus,
  normalizeForteOrder,
  toMinorUnits,
} = require('../src/services/forte.service');

const internalOrderId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const providerOrderId = '1000000004567';
const orderPassword = 'test-order-password';
const idempotencyKey = '217615f9-b35f-4eb4-9f6d-777f2236bb25';
const env = {
  FORTE_ENABLED: 'true',
  FORTE_API_USERNAME: 'TerminalSys/test-merchant',
  FORTE_API_PASSWORD: 'test-api-password',
  FORTE_MERCHANT_ID: 'TEST-MERCHANT',
  FORTE_ORDER_CREDENTIAL_KEY: 'test-credential-key-that-is-longer-than-32-characters',
  FORTE_TEST_MODE: 'false',
  FORTE_API_BASE_URL: 'https://api.fortebank.com',
  PUBLIC_BASE_URL: 'https://bulka.com.kz',
};

const response = (body, { ok = true, status = 200 } = {}) => ({
  ok,
  status,
  text: async () => JSON.stringify(body),
});

test('ForteBank amount and documented order statuses are normalized safely', () => {
  assert.equal(formatAmount(55), '55.00');
  assert.equal(formatAmount(1250.5), '1250.50');
  assert.equal(toMinorUnits(1250.5), 125050);
  assert.equal(mapForteStatus('FullyPaid'), 'paid');
  assert.equal(mapForteStatus('Closed'), 'paid');
  assert.equal(mapForteStatus('PartPaid'), 'pending');
  assert.equal(mapForteStatus('Declined'), 'failed');
  assert.equal(mapForteStatus('Refused'), 'failed');
  assert.equal(mapForteStatus('Expired'), 'expired');
  assert.equal(mapForteStatus('Voided'), 'refunded');
  assert.equal(mapForteStatus('Refunded'), 'refunded');

  assert.deepEqual(
    normalizeForteOrder({
      order: {
        id: Number(providerOrderId),
        typeRid: 'Order_RID',
        status: 'FullyPaid',
        amount: 55,
        currency: 'KZT',
        type: { allowVoid: true },
      },
    }),
    {
      id: providerOrderId,
      typeRid: 'Order_RID',
      status: 'FullyPaid',
      amount: 55,
      currency: 'KZT',
      allowVoid: true,
      createTime: '',
    },
  );
});

test('ForteBank HPP URL is pinned to the official HTTPS host and flex path', () => {
  const url = new URL(
    buildHostedPaymentUrl('https://ecom.fortebank.com', providerOrderId, orderPassword),
  );
  assert.equal(url.origin, 'https://ecom.fortebank.com');
  assert.equal(url.pathname, '/flex/');
  assert.equal(url.searchParams.get('id'), providerOrderId);
  assert.equal(url.searchParams.get('password'), orderPassword);

  assert.throws(
    () =>
      buildHostedPaymentUrl(
        'https://ecom.fortebank.com.attacker.example/flex',
        providerOrderId,
        orderPassword,
      ),
    (error) => error.code === 'FORTE_INVALID_CREATE_RESPONSE',
  );
  assert.throws(
    () =>
      buildHostedPaymentUrl('https://ecom.fortebank.com/redirect', providerOrderId, orderPassword),
    (error) => error.code === 'FORTE_INVALID_CREATE_RESPONSE',
  );
});

test('ForteBank order password is encrypted and bound to both order identifiers', () => {
  const envelope = encryptOrderPassword(orderPassword, internalOrderId, providerOrderId, env);
  assert.ok(envelope.startsWith('v1.'));
  assert.equal(envelope.includes(orderPassword), false);
  assert.equal(
    decryptOrderPassword(envelope, internalOrderId, providerOrderId, env),
    orderPassword,
  );
  assert.throws(
    () =>
      decryptOrderPassword(envelope, '317615f9-b35f-4eb4-9f6d-777f2236bb25', providerOrderId, env),
    (error) => error.code === 'FORTE_CREDENTIAL_DECRYPTION_FAILED',
  );
});

test('CreateOrder follows the official TXPG Basic Auth and idempotency contract', async () => {
  let received;
  const service = new ForteService({
    env,
    fetchImpl: async (url, options) => {
      received = { url, options, body: JSON.parse(options.body) };
      return response({
        order: {
          id: Number(providerOrderId),
          hppUrl: 'https://ecom.fortebank.com/flex',
          password: orderPassword,
          status: 'Preparing',
          cvv2AuthStatus: 'Required',
          secret: 'unused-test-secret',
        },
      });
    },
  });

  const created = await service.createProviderOrder({
    amount: 55,
    language: 'kk',
    redirectUrl: 'https://bulka.com.kz/orders?payment=forte',
    description: 'Test order',
    idempotencyKey,
  });

  assert.equal(received.url, 'https://api.fortebank.com/order');
  assert.equal(received.options.method, 'POST');
  assert.equal(
    received.options.headers.Authorization,
    `Basic ${Buffer.from(`${env.FORTE_API_USERNAME}:${env.FORTE_API_PASSWORD}`, 'utf8').toString(
      'base64',
    )}`,
  );
  assert.equal(received.options.headers['TXPG-Idempotence-Key'], idempotencyKey);
  assert.deepEqual(received.body, {
    order: {
      typeRid: 'Order_RID',
      language: 'kk',
      amount: '55.00',
      currency: 'KZT',
      hppRedirectUrl: 'https://bulka.com.kz/orders?payment=forte',
      description: 'Test order',
    },
  });
  assert.equal(created.id, providerOrderId);
  assert.equal(created.hppBaseUrl, 'https://ecom.fortebank.com/flex/');
  assert.equal(created.password, orderPassword);
  assert.equal(Object.hasOwn(created, 'secret'), false);
});

test('Refund queries getOrder and sends documented exec-tran payload', async () => {
  const encryptedPassword = encryptOrderPassword(
    orderPassword,
    internalOrderId,
    providerOrderId,
    env,
  );
  const calls = [];
  const service = new ForteService({
    env,
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: options.body ? JSON.parse(options.body) : null });
      if (options.method === 'GET') {
        return response({
          order: {
            id: Number(providerOrderId),
            typeRid: 'Order_RID',
            status: 'FullyPaid',
            amount: 55,
            currency: 'KZT',
            type: { allowVoid: false },
          },
        });
      }
      return response({
        tran: {
          approvedPartial: false,
          match: { tranActionId: 'test-refund-reference' },
        },
      });
    },
  });
  const order = {
    id: internalOrderId,
    operation_id: providerOrderId,
    payment_method: 'forte_card',
    amount: 55,
    provider_auth_ciphertext: encryptedPassword,
  };

  const result = await service.refundPayment(order, 12.5, { idempotencyKey });

  assert.equal(calls.length, 2);
  const statusUrl = new URL(calls[0].url);
  assert.equal(statusUrl.pathname, `/order/${providerOrderId}`);
  assert.equal(statusUrl.searchParams.get('password'), orderPassword);
  assert.equal(statusUrl.searchParams.get('tranDetailLevel'), '1');
  assert.equal(statusUrl.searchParams.get('orderDetailLevel'), '1');
  const refundUrl = new URL(calls[1].url);
  assert.equal(refundUrl.pathname, `/order/${providerOrderId}/exec-tran`);
  assert.equal(refundUrl.searchParams.get('password'), orderPassword);
  assert.equal(calls[1].options.headers['TXPG-Idempotence-Key'], idempotencyKey);
  assert.deepEqual(calls[1].body, {
    tran: {
      type: 'Refund',
      amount: '12.50',
      phase: 'Single',
    },
  });
  assert.equal(result.reference, 'test-refund-reference');
  assert.equal(result.operation, 'refund');
});

test('A same-day full refund uses documented Full Void when Forte allows it', async () => {
  const encryptedPassword = encryptOrderPassword(
    orderPassword,
    internalOrderId,
    providerOrderId,
    env,
  );
  let execBody;
  const service = new ForteService({
    env,
    fetchImpl: async (_url, options) => {
      if (options.method === 'GET') {
        return response({
          order: {
            id: Number(providerOrderId),
            typeRid: 'Order_RID',
            status: 'FullyPaid',
            amount: 55,
            currency: 'KZT',
            type: { allowVoid: true },
          },
        });
      }
      execBody = JSON.parse(options.body);
      return response({
        tran: {
          approvedPartial: false,
          match: { ridByPmo: 'test-void-reference' },
        },
      });
    },
  });

  const result = await service.refundPayment(
    {
      id: internalOrderId,
      operation_id: providerOrderId,
      payment_method: 'forte_card',
      amount: 55,
      provider_auth_ciphertext: encryptedPassword,
    },
    55,
    { idempotencyKey },
  );

  assert.deepEqual(execBody, {
    tran: {
      voidKind: 'Full',
      amount: '55.00',
      phase: 'Single',
    },
  });
  assert.equal(result.operation, 'void');
});

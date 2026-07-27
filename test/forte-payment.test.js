const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const test = require('node:test');

const {
  ForteService,
  mapForteStatus,
  normalizeFortePayload,
  toMinorUnits,
  verifyForteWebhook,
} = require('../src/services/forte.service');

const shopId = 'shop-123';
const secretKey = 'forte-secret-key';

test('ForteBank webhook requires matching Basic Auth and RSA-SHA256 raw-body signature', () => {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const rawBody = Buffer.from(
    JSON.stringify({
      uid: 'payment-uid-1',
      status: 'successful',
      amount: 480000,
      currency: 'KZT',
    }),
  );
  const signature = crypto.sign('RSA-SHA256', rawBody, privateKey).toString('base64');
  const headers = {
    authorization: `Basic ${Buffer.from(`${shopId}:${secretKey}`).toString('base64')}`,
    'content-signature': signature,
  };

  assert.equal(
    verifyForteWebhook({
      headers,
      rawBody,
      shopId,
      secretKey,
      publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    }),
    true,
  );
  assert.throws(
    () =>
      verifyForteWebhook({
        headers,
        rawBody: Buffer.from(`${rawBody} `),
        shopId,
        secretKey,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      }),
    (error) => error.code === 'FORTE_WEBHOOK_INVALID_SIGNATURE' && error.statusCode === 403,
  );
  assert.throws(
    () =>
      verifyForteWebhook({
        headers: { ...headers, authorization: 'Basic invalid' },
        rawBody,
        shopId,
        secretKey,
        publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
      }),
    (error) => error.code === 'FORTE_WEBHOOK_UNAUTHORIZED' && error.statusCode === 401,
  );
});

test('ForteBank payload normalization preserves fields needed for payment verification', () => {
  const normalized = normalizeFortePayload({
    checkout: {
      token: 'checkout-token-123',
      test: true,
      order: {
        amount: 480000,
        currency: 'KZT',
        tracking_id: '117615f9-b35f-4eb4-9f6d-777f2236bb25',
      },
      gateway_response: {
        payment: {
          uid: 'payment-uid-1',
          status: 'successful',
          type: 'payment',
          credit_card: {
            brand: 'visa',
            bin: '411111',
            last_4: '1111',
          },
          auth_code: 'AUTH-1',
        },
      },
    },
  });

  assert.equal(normalized.checkoutToken, 'checkout-token-123');
  assert.equal(normalized.trackingId, '117615f9-b35f-4eb4-9f6d-777f2236bb25');
  assert.equal(normalized.transactionId, 'payment-uid-1');
  assert.equal(normalized.amount, 480000);
  assert.equal(normalized.currency, 'KZT');
  assert.equal(normalized.test, true);
  assert.equal(normalized.cardFirstSix, '411111');
  assert.equal(normalized.cardLastFour, '1111');
  assert.equal(mapForteStatus(normalized.status), 'paid');
  assert.equal(toMinorUnits(4800), 480000);
});

test('ForteBank refund uses minor units, API v3 and a stable RequestID', async () => {
  const requestId = '217615f9-b35f-4eb4-9f6d-777f2236bb25';
  let received;
  const service = new ForteService({
    env: {
      FORTE_ENABLED: 'true',
      FORTE_SHOP_ID: shopId,
      FORTE_SECRET_KEY: secretKey,
      FORTE_WEBHOOK_PUBLIC_KEY: 'A'.repeat(128),
      FORTE_TEST_MODE: 'false',
      FORTE_GATEWAY_BASE_URL: 'https://gateway.fortebank.com',
      PUBLIC_BASE_URL: 'https://bulka.com.kz',
    },
    fetchImpl: async (url, options) => {
      received = { url, options, body: JSON.parse(options.body) };
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            transaction: {
              uid: 'refund-uid-1',
              status: 'successful',
              parent_uid: 'payment-uid-1',
              amount: 125050,
              currency: 'KZT',
              test: false,
            },
          }),
      };
    },
  });

  const result = await service.refundPayment('payment-uid-1', 1250.5, {
    reason: 'Customer cancellation',
    idempotencyKey: requestId,
  });

  assert.equal(result.reference, 'refund-uid-1');
  assert.equal(received.url, 'https://gateway.fortebank.com/transactions/refunds');
  assert.equal(received.options.headers['X-API-Version'], '3');
  assert.equal(received.options.headers.RequestID, requestId);
  assert.deepEqual(received.body.request, {
    parent_uid: 'payment-uid-1',
    amount: 125050,
    reason: 'Customer cancellation',
    additional_data: { referer: 'https://bulka.com.kz' },
  });
});

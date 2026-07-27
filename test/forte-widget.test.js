const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ForteWidgetService,
  buildWidgetLaunchUrl,
  decryptProviderToken,
  encryptProviderToken,
  mapWidgetStatus,
  normalizeWidgetCheckout,
  resolveCardSetupStatus,
  verifyWebhookBasicAuth,
  verifyWebhookSignature,
} = require('../src/services/forte-widget.service');

const shopId = '123456';
const secretKey = 'widget-secret-key-longer-than-sixteen';
const tokenKey = 'widget-token-key-longer-than-thirty-two-characters';
const checkoutToken = 'a'.repeat(64);
const operationId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
});
const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' });
const env = {
  FORTE_WIDGET_ENABLED: 'true',
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
  assert.notEqual(encrypted, checkoutToken);
  assert.equal(decryptProviderToken(encrypted, 'checkout', operationId, env), checkoutToken);
  assert.throws(
    () => decryptProviderToken(encrypted, 'checkout', crypto.randomUUID(), env),
    (error) => error.code === 'FORTE_WIDGET_TOKEN_DECRYPTION_FAILED',
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
      uid: '217615f9-b35f-4eb4-9f6d-777f2236bb25',
      status: 'successful',
      amount: 0,
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
    amount: 0,
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

test('card binding waits for a transaction webhook when checkout succeeds first', () => {
  assert.equal(resolveCardSetupStatus('paid', false), 'pending');
  assert.equal(resolveCardSetupStatus('paid', true), 'paid');
  assert.equal(resolveCardSetupStatus('failed', false), 'failed');
});

test('Forte card binding uses the documented zero amount and recurring contract', async () => {
  const requests = [];
  const service = new ForteWidgetService({
    env,
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return response({ checkout: { token: checkoutToken } });
    },
  });
  const result = await service.createProviderCheckout({
    amountMinor: 0,
    customerId: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
    phone: '+77012772233',
    language: 'ru',
    trackingId: operationId,
    description: 'Привязка карты к профилю Bulka',
    purpose: 'card-setup',
  });
  assert.equal(result.token, checkoutToken);
  assert.equal(requests.length, 1);
  const request = requests[0];
  assert.equal(request.url, 'https://securepayments.fortebank.com/ctp/api/checkouts');
  assert.equal(request.options.headers['X-API-Version'], '2');
  assert.match(request.options.headers.Authorization, /^Basic /);
  const body = JSON.parse(request.options.body);
  assert.equal(body.checkout.transaction_type, 'payment');
  assert.equal(body.checkout.order.amount, 0);
  assert.equal(body.checkout.order.currency, 'KZT');
  assert.deepEqual(body.checkout.order.additional_data.contract, ['card_on_file', 'recurring']);
  assert.equal(body.checkout.order.additional_data.card_on_file.initiator, 'customer');
  assert.equal(body.checkout.settings.language, 'ru');
  assert.equal(
    body.checkout.settings.return_url,
    `https://bulka.com.kz/profile?payment=forte&setup=${operationId}&status=returned`,
  );
  assert.equal(
    body.checkout.settings.cancel_url,
    `https://bulka.com.kz/profile?payment=forte&setup=${operationId}&status=cancelled`,
  );
  assert.equal(body.checkout.settings.save_card_toggle.customer_contract, true);
  assert.deepEqual(body.checkout.payment_method.types, ['credit_card']);
  assert.deepEqual(body.checkout.payment_method.excluded_brands, ['apple_pay']);
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
});

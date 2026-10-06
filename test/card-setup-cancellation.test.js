const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  ForteWidgetService,
  encryptProviderToken,
  normalizeWidgetCheckout,
} = require('../src/services/forte-widget.service');
const widget = require('../src/services/forte-widget.service');
const controller = require('../src/controllers/forte.controller');

const operationId = '11111111-1111-4111-8111-111111111111';
const customerId = '22222222-2222-4222-8222-222222222222';
const token = 'a'.repeat(64);
const env = {
  FORTE_WIDGET_ENABLED: 'true',
  FORTE_WIDGET_SHOP_ID: '123456',
  FORTE_WIDGET_SECRET_KEY: 'test-widget-secret-key-longer-than-sixteen',
  FORTE_WIDGET_TOKEN_KEY: 'test-token-key-longer-than-thirty-two-characters',
  FORTE_WIDGET_WEBHOOK_PUBLIC_KEY: crypto
    .generateKeyPairSync('rsa', { modulusLength: 2048 })
    .publicKey.export({ type: 'spki', format: 'pem' }),
  FORTE_WIDGET_TEST_MODE: 'false',
  PUBLIC_BASE_URL: 'https://bulka.com.kz',
};

function fixture(overrides = {}) {
  return {
    id: operationId,
    customer_id: customerId,
    provider: 'forte_widget',
    status: 'pending',
    provider_status: 'created',
    payment_test: false,
    amount: 0,
    refund_status: 'not_required',
    expires_at: new Date(Date.now() + 90_000).toISOString(),
    checkout_token_ciphertext: encryptProviderToken(
      token,
      'card-setup',
      `${customerId}:${operationId}`,
      env,
    ),
    ...overrides,
  };
}

function harness(initial = fixture()) {
  const state = { rows: [initial], writes: [], writeError: null, beforeWrite: null };
  const db = {
    from(table) {
      assert.equal(table, 'customer_payment_method_setups');
      let values;
      let insertRows;
      const filters = [];
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return query;
        },
        neq(key, value) {
          filters.push((row) => row[key] !== value);
          return query;
        },
        is(key, value) {
          filters.push((row) => (row[key] ?? null) === value);
          return query;
        },
        update(update) {
          values = update;
          return query;
        },
        insert(rows) {
          insertRows = rows;
          return query;
        },
        async maybeSingle() {
          if (values || insertRows) {
            state.writes.push({ values, filters });
            if (state.writeError) return { data: null, error: state.writeError };
            if (state.beforeWrite) {
              state.beforeWrite();
              state.beforeWrite = null;
            }
          }
          if (insertRows) {
            state.rows.push(...insertRows);
            return { data: { ...insertRows[0] }, error: null };
          }
          const row = state.rows.find((candidate) => filters.every((filter) => filter(candidate)));
          if (!row) return { data: null, error: null };
          if (values) Object.assign(row, values);
          return { data: { ...row }, error: null };
        },
        single() {
          return query.maybeSingle();
        },
        then(resolve, reject) {
          return query.maybeSingle().then(resolve, reject);
        },
      };
      return query;
    },
  };
  const service = new ForteWidgetService({ db, env });
  service.request = async () => assert.fail('cancellation must never issue a provider transaction');
  return { state, service };
}

function providerBody({
  status = 'pending',
  finished = false,
  expired = false,
  card,
  amount = 0,
} = {}) {
  return {
    checkout: {
      token,
      shop_id: env.FORTE_WIDGET_SHOP_ID,
      order: { tracking_id: operationId, amount, currency: 'KZT' },
      status,
      finished,
      expired,
      test: false,
      gateway_response:
        status === 'successful'
          ? {
              payment: {
                uid: '33333333-3333-4333-8333-333333333333',
                status,
                ...(card && { credit_card: card }),
              },
            }
          : undefined,
    },
  };
}

function provider(service, body) {
  service.request = async (url, options) => {
    assert.equal(url, `/ctp/api/checkouts/${token}`);
    assert.equal(options?.method, undefined);
    return { response: { ok: true }, body };
  };
  service.hydrateProviderCard = async (normalized) => normalized;
}

test('closing a pending setup is durable, owner scoped, idempotent and keeps financial reconciliation', async () => {
  const { service, state } = harness();
  const encrypted = state.rows[0].checkout_token_ciphertext;
  const setup = await service.cancelCardSetup(operationId, customerId);
  assert.ok(setup.cancel_requested_at);
  assert.equal(setup.status, 'pending');
  assert.equal(setup.checkout_token_ciphertext, encrypted);
  const stateResponse = service.cardSetupStatusResponse(setup);
  assert.equal(stateResponse.cancelled, true);
  assert.equal(stateResponse.canResume, false);
  assert.equal(stateResponse.cardSaved, false);
  const repeated = await service.cancelCardSetup(operationId, customerId);
  assert.equal(repeated.cancel_requested_at, setup.cancel_requested_at);
  assert.equal(state.writes.length, 1);
});

test('a foreign setup cannot be cancelled or disclosed', async () => {
  const { service, state } = harness();
  await assert.rejects(() => service.cancelCardSetup(operationId, 'other-customer'), {
    code: 'FORTE_WIDGET_CARD_SETUP_NOT_FOUND',
    statusCode: 404,
  });
  assert.equal(state.writes.length, 0);
});

test('cancel persistence failure never acknowledges closure and remains retryable', async () => {
  const { service, state } = harness();
  state.writeError = new Error('database unavailable');
  await assert.rejects(() => service.cancelCardSetup(operationId, customerId), {
    code: 'FORTE_WIDGET_CARD_SETUP_CANCEL_UNKNOWN',
    statusCode: 503,
    retryable: true,
  });
  assert.equal(state.rows[0].cancel_requested_at, undefined);
  assert.equal(state.rows[0].status, 'pending');
});

test('a bank completion racing cancellation wins without downgrading or cancelling a saved card', async () => {
  const { service, state } = harness();
  state.beforeWrite = () =>
    Object.assign(state.rows[0], { status: 'paid', checkout_token_ciphertext: null });
  const setup = await service.cancelCardSetup(operationId, customerId);
  assert.equal(setup.status, 'paid');
  assert.equal(setup.cancel_requested_at, undefined);
  assert.equal(service.cardSetupStatusResponse(setup).cardSaved, true);
});

test('already completed setup cancellation is harmless and does not write', async () => {
  const { service, state } = harness(fixture({ status: 'paid', checkout_token_ciphertext: null }));
  assert.equal((await service.cancelCardSetup(operationId, customerId)).status, 'paid');
  assert.equal(state.writes.length, 0);
});

test('finished failure is terminal even when the local checkout TTL has not elapsed', async () => {
  const { service, state } = harness();
  provider(service, providerBody({ status: 'failed', finished: true }));
  const result = await service.syncCardSetup(operationId, customerId);
  assert.equal(result.status, 'failed');
  assert.equal(result.canResume, false);
  assert.equal(state.rows[0].status, 'failed');
  assert.ok(state.rows[0].completed_at);
  assert.ok(state.rows[0].checkout_token_ciphertext);
});

test('an explicitly unfinished failed attempt remains resumable until the provider finishes it', async () => {
  const { service } = harness();
  provider(service, providerBody({ status: 'failed', finished: false }));
  const result = await service.syncCardSetup(operationId, customerId);
  assert.equal(result.status, 'pending');
  assert.equal(result.canResume, true);
});

test('successful binding awaiting a reusable card token stays pending but never reopens the consumed form', async () => {
  const { service } = harness();
  provider(service, providerBody({ status: 'successful', finished: true }));
  const result = await service.syncCardSetup(operationId, customerId);
  assert.equal(result.status, 'pending');
  assert.equal(result.setup.provider_status, 'successful_awaiting_card_token');
  assert.equal(result.canResume, false);
  assert.equal((await service.cardSetupResponse(result.setup)).redirectUrl, undefined);
});

test('provider expiry and malformed or omitted completion flags cannot produce a resumable URL', async () => {
  for (const flags of [
    { expired: true },
    { expired: undefined },
    { finished: undefined },
    { finished: 'false' },
  ]) {
    const { service } = harness();
    const body = providerBody();
    Object.assign(body.checkout, flags);
    provider(service, body);
    assert.equal((await service.syncCardSetup(operationId, customerId)).canResume, false);
  }
});

test('a canceled form never resumes even if the provider still declares it unfinished', async () => {
  const { service } = harness();
  await service.cancelCardSetup(operationId, customerId);
  provider(service, providerBody());
  const result = await service.syncCardSetup(operationId, customerId);
  assert.equal(result.status, 'pending');
  assert.equal(result.canResume, false);
  assert.equal((await service.cardSetupResponse(result.setup)).redirectUrl, undefined);
});

test('a late successful bank binding after closure saves the card once and retains the cancel marker', async () => {
  const { service, state } = harness();
  await service.cancelCardSetup(operationId, customerId);
  provider(
    service,
    providerBody({
      status: 'successful',
      finished: true,
      card: { token: 'b'.repeat(64), last_4: '1328', brand: 'visa' },
    }),
  );
  let saved = 0;
  service.savePaymentMethod = async () => {
    saved += 1;
    return { id: 'saved-card' };
  };
  service.refundCardSetupPayment = async () =>
    assert.fail('zero-value bank-managed hold must not be refunded by merchant');
  const result = await service.syncCardSetup(operationId, customerId);
  assert.equal(result.status, 'paid');
  assert.ok(result.setup.cancel_requested_at);
  assert.equal(result.setup.checkout_token_ciphertext, null);
  assert.equal(result.canResume, false);
  await service.applyProviderCardSetup(
    state.rows[0],
    normalizeWidgetCheckout(
      providerBody({
        status: 'successful',
        finished: true,
        card: { token: 'b'.repeat(64), last_4: '1328' },
      }),
    ),
    token,
  );
  assert.equal(saved, 1);
});

test('closing an older charged verification setup preserves the idempotent refund path', async () => {
  const { service } = harness(
    fixture({
      amount: 30,
      refund_status: 'pending',
      refund_request_id: '44444444-4444-4444-8444-444444444444',
    }),
  );
  await service.cancelCardSetup(operationId, customerId);
  provider(
    service,
    providerBody({
      status: 'successful',
      finished: true,
      amount: 3000,
      card: { token: 'b'.repeat(64), last_4: '1328' },
    }),
  );
  let refunds = 0;
  service.refundCardSetupPayment = async (setup) => {
    assert.equal(setup.refund_request_id, '44444444-4444-4444-8444-444444444444');
    assert.ok(setup.cancel_requested_at);
    refunds += 1;
    return { reference: '55555555-5555-4555-8555-555555555555' };
  };
  service.savePaymentMethod = async () => ({ id: 'saved-card' });
  const result = await service.syncCardSetup(operationId, customerId);
  assert.equal(result.status, 'paid');
  assert.equal(result.setup.refund_status, 'succeeded');
  assert.equal(refunds, 1);
});

test('stale charged-setup worker never overwrites a completed refund with processing', async () => {
  const { service, state } = harness(
    fixture({
      amount: 30,
      refund_status: 'pending',
      refund_request_id: '44444444-4444-4444-8444-444444444444',
    }),
  );
  state.beforeWrite = () =>
    Object.assign(state.rows[0], {
      status: 'paid',
      refund_status: 'succeeded',
      checkout_token_ciphertext: null,
    });
  service.refundCardSetupPayment = async () =>
    assert.fail('completed refund must not be restarted');
  service.savePaymentMethod = async () =>
    assert.fail('completed binding must not save the card twice');
  const result = await service.applyProviderCardSetup(
    fixture({ amount: 30, refund_status: 'pending' }),
    normalizeWidgetCheckout(
      providerBody({
        status: 'successful',
        finished: true,
        amount: 3000,
        card: { token: 'b'.repeat(64), last_4: '1328' },
      }),
    ),
    token,
  );
  assert.equal(result.status, 'paid');
  assert.equal(result.setup.refund_status, 'succeeded');
  assert.equal(state.rows[0].refund_status, 'succeeded');
});

test('late uncertain refund error cannot turn a concurrently completed setup back into pending', async () => {
  const { service, state } = harness(
    fixture({
      amount: 30,
      refund_status: 'pending',
      refund_request_id: '44444444-4444-4444-8444-444444444444',
    }),
  );
  service.refundCardSetupPayment = async () => {
    Object.assign(state.rows[0], {
      status: 'paid',
      refund_status: 'succeeded',
      checkout_token_ciphertext: null,
    });
    throw Object.assign(new Error('late provider timeout'), { refundUncertain: true });
  };
  service.savePaymentMethod = async () => ({ id: 'saved-card' });
  const result = await service.applyProviderCardSetup(
    fixture({ amount: 30, refund_status: 'pending' }),
    normalizeWidgetCheckout(
      providerBody({
        status: 'successful',
        finished: true,
        amount: 3000,
        card: { token: 'b'.repeat(64), last_4: '1328' },
      }),
    ),
    token,
  );
  assert.equal(result.status, 'paid');
  assert.equal(result.setup.refund_status, 'succeeded');
  assert.equal(state.rows[0].status, 'paid');
  assert.equal(state.rows[0].refund_status, 'succeeded');
  assert.equal(state.rows[0].checkout_token_ciphertext, null);
});

test('stale charged-setup processing never overwrites a successful refund awaiting the reusable token', async () => {
  const { service, state } = harness(
    fixture({
      amount: 30,
      refund_status: 'pending',
      refund_request_id: '44444444-4444-4444-8444-444444444444',
    }),
  );
  state.beforeWrite = () =>
    Object.assign(state.rows[0], {
      refund_status: 'succeeded',
      provider_status: 'successful_awaiting_card_token',
    });
  service.refundCardSetupPayment = async () =>
    assert.fail('confirmed refund must not be restarted');
  const result = await service.applyProviderCardSetup(
    fixture({ amount: 30, refund_status: 'pending' }),
    normalizeWidgetCheckout(
      providerBody({
        status: 'successful',
        finished: true,
        amount: 3000,
      }),
    ),
    token,
  );
  assert.equal(result.status, 'pending');
  assert.equal(result.setup.refund_status, 'succeeded');
  assert.equal(result.setup.provider_status, 'successful_awaiting_card_token');
  assert.equal(state.rows[0].refund_status, 'succeeded');
});

test('late uncertain refund error never overwrites a same-status successful refund awaiting its card token', async () => {
  const { service, state } = harness(
    fixture({
      amount: 30,
      refund_status: 'pending',
      refund_request_id: '44444444-4444-4444-8444-444444444444',
    }),
  );
  service.refundCardSetupPayment = async () => {
    Object.assign(state.rows[0], {
      refund_status: 'succeeded',
      provider_status: 'successful_awaiting_card_token',
    });
    throw Object.assign(new Error('late provider timeout'), { refundUncertain: true });
  };
  const result = await service.applyProviderCardSetup(
    fixture({ amount: 30, refund_status: 'pending' }),
    normalizeWidgetCheckout(
      providerBody({
        status: 'successful',
        finished: true,
        amount: 3000,
      }),
    ),
    token,
  );
  assert.equal(result.status, 'pending');
  assert.equal(result.setup.refund_status, 'succeeded');
  assert.equal(result.setup.provider_status, 'successful_awaiting_card_token');
  assert.equal(state.rows[0].refund_status, 'succeeded');
});

test('a legacy missing refund status uses a null-safe processing claim and completes its confirmed refund', async () => {
  const { service } = harness(
    fixture({
      amount: 30,
      refund_status: null,
      refund_request_id: '44444444-4444-4444-8444-444444444444',
    }),
  );
  service.refundCardSetupPayment = async () => ({
    reference: '55555555-5555-4555-8555-555555555555',
  });
  const result = await service.applyProviderCardSetup(
    fixture({ amount: 30, refund_status: null }),
    normalizeWidgetCheckout(
      providerBody({
        status: 'successful',
        finished: true,
        amount: 3000,
      }),
    ),
    token,
  );
  assert.equal(result.status, 'pending');
  assert.equal(result.setup.refund_status, 'succeeded');
});

test('stale pending provider replies cannot erase consumed card status or a confirmed refund', async () => {
  for (const amount of [0, 30]) {
    const initial = fixture({ amount, refund_status: amount ? 'pending' : 'not_required' });
    const { service, state } = harness(initial);
    state.beforeWrite = () =>
      Object.assign(state.rows[0], {
        refund_status: amount ? 'succeeded' : 'not_required',
        provider_status: 'successful_awaiting_card_token',
      });
    const stale = { ...initial };
    const result = await service.applyProviderCardSetup(
      stale,
      normalizeWidgetCheckout(providerBody({ amount: amount * 100 })),
      token,
    );
    assert.equal(result.status, 'pending');
    assert.equal(result.setup.refund_status, amount ? 'succeeded' : 'not_required');
    assert.equal(result.setup.provider_status, 'successful_awaiting_card_token');
    assert.equal(
      service.cardSetupStatusResponse(result.setup, { canResume: true }).canResume,
      false,
    );
  }
});

test('final card state comparison supports legacy nullable provider and refund fields', async () => {
  const initial = fixture({ refund_status: null, provider_status: null });
  const { service } = harness(initial);
  const result = await service.applyProviderCardSetup(
    initial,
    normalizeWidgetCheckout(providerBody()),
    token,
  );
  assert.equal(result.status, 'pending');
  assert.equal(result.setup.refund_status, 'not_required');
  assert.equal(result.setup.provider_status, 'pending');
});

test('ambiguous later provider state never resets a confirmed failed or expired setup to pending', async () => {
  for (const status of ['failed', 'expired']) {
    const { service } = harness(fixture({ status }));
    provider(service, providerBody());
    const result = await service.syncCardSetup(operationId, customerId);
    assert.equal(result.status, status);
    assert.equal(result.canResume, false);
  }
});

test('new binding after canceled setup generates a fresh operation and fresh provider token', async () => {
  const { service, state } = harness();
  await service.cancelCardSetup(operationId, customerId);
  service.assertPaymentMethodCapacity = async () => 0;
  service.createProviderCheckout = async ({ trackingId }) => {
    assert.notEqual(trackingId, operationId);
    return {
      token: 'c'.repeat(64),
      expiresAt: new Date(Date.now() + 90_000).toISOString(),
      language: 'ru',
    };
  };
  const result = await service.createCardSetup(customerId, '+77001112233');
  assert.notEqual(result.operationId, operationId);
  assert.equal(
    new URLSearchParams(new URL(result.redirectUrl).hash.slice(1)).get('token'),
    'c'.repeat(64),
  );
  assert.equal(state.rows.length, 2);
  assert.ok(state.rows[0].cancel_requested_at);
});

test('closed or terminal setup responses do not decrypt or expose bank credentials', async () => {
  const service = new ForteWidgetService({ env: {} });
  for (const overrides of [
    { status: 'paid' },
    { status: 'failed' },
    { status: 'expired' },
    { cancel_requested_at: new Date().toISOString() },
    { provider_status: 'successful_card_saved_refund_pending' },
    { expires_at: new Date(Date.now() - 1000).toISOString() },
  ]) {
    const result = await service.cardSetupResponse(
      fixture({ checkout_token_ciphertext: 'invalid-cipher', ...overrides }),
    );
    assert.equal(result.redirectUrl, undefined);
    assert.equal(result.canResume, false);
  }
});

function response() {
  return {
    statusCode: 200,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
}
const request = {
  params: { operationId },
  customerAuth: { id: customerId },
  query: { resume: '1' },
};

test('status lookup outage preserves pending financial state without returning the old bank URL', async (t) => {
  t.mock.method(widget, 'getCardSetupStatus', async () => fixture());
  t.mock.method(widget, 'availability', () => true);
  t.mock.method(widget, 'syncCardSetup', async () => {
    throw new Error('provider unavailable');
  });
  t.mock.method(widget, 'cardSetupResponse', async () =>
    assert.fail('unknown status must not reopen form'),
  );
  const res = response();
  await controller.checkCardSetupStatus(request, res);
  assert.equal(res.body.paymentStatus, 'pending');
  assert.equal(res.body.canResume, false);
  assert.equal(res.body.redirectUrl, undefined);
});

test('resumption requires authoritative unfinished provider state and rechecks cancellation after sync', async (t) => {
  let cancelled = false;
  t.mock.method(widget, 'getCardSetupStatus', async () =>
    fixture(cancelled ? { cancel_requested_at: new Date().toISOString() } : {}),
  );
  t.mock.method(widget, 'availability', () => true);
  t.mock.method(widget, 'syncCardSetup', async () => ({ canResume: true }));
  t.mock.method(widget, 'cardSetupResponse', async () => ({
    redirectUrl: 'https://bulka.com.kz/forte-widget.html#new',
  }));
  const open = response();
  await controller.checkCardSetupStatus(request, open);
  assert.equal(open.body.canResume, true);
  assert.ok(open.body.redirectUrl);
  cancelled = true;
  const closed = response();
  await controller.checkCardSetupStatus(request, closed);
  assert.equal(closed.body.cancelled, true);
  assert.equal(closed.body.canResume, false);
  assert.equal(closed.body.redirectUrl, undefined);
});

test('cancel endpoint acknowledges durable closure even while provider status remains pending', async (t) => {
  t.mock.method(widget, 'cancelCardSetup', async (id, owner) => {
    assert.equal(id, operationId);
    assert.equal(owner, customerId);
    return fixture({ cancel_requested_at: new Date().toISOString() });
  });
  const res = response();
  await controller.cancelCardSetup(request, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.cancelled, true);
  assert.equal(res.body.paymentStatus, 'pending');
  assert.equal(res.body.canResume, false);
});

test('cancel endpoint propagates unknown persistence without success or lost retry instructions', async (t) => {
  t.mock.method(widget, 'cancelCardSetup', async () => {
    throw Object.assign(new Error('unknown'), {
      statusCode: 503,
      code: 'FORTE_WIDGET_CARD_SETUP_CANCEL_UNKNOWN',
      retryable: true,
    });
  });
  const res = response();
  await controller.cancelCardSetup(request, res);
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.success, undefined);
  assert.equal(res.body.retryable, true);
});

test('cancel route uses authenticated customer owner, validated operation id and an empty body contract', () => {
  const routes = fs.readFileSync(path.join(__dirname, '../src/routes/public.routes.js'), 'utf8');
  assert.match(routes, /router\.use\('\/api\/customer',[\s\S]*?customerAuthMiddleware/);
  assert.match(
    routes,
    /router\.post\(\s*'\/api\/customer\/forte-pay\/card-setup\/:operationId\/cancel',\s*validateRequest\(\{ params: forteOperationParamsSchema, body: emptyBodySchema \}\),\s*forteController\.cancelCardSetup/,
  );
});

test('old canceled unresolved setups rotate through bounded pages while current bindings keep reconciling', async (t) => {
  t.mock.method(console, 'error', () => {});
  const oldDate = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  const records = Array.from({ length: 60 }, (_, index) =>
    fixture({
      id: `old-${String(index).padStart(3, '0')}`,
      created_at: oldDate,
      cancel_requested_at: oldDate,
    }),
  );
  records.push(fixture({ id: 'current', created_at: new Date().toISOString() }));
  records.push(fixture({ id: 'old-unclosed', created_at: oldDate }));
  const ranges = [];
  const db = {
    from(table) {
      const filters = [];
      let from = 0;
      let to = 49;
      const query = {
        select() {
          return query;
        },
        eq(key, value) {
          filters.push((row) => row[key] === value);
          return query;
        },
        not(key, operator, value) {
          assert.equal(operator, 'is');
          assert.equal(value, null);
          filters.push((row) => row[key] != null);
          return query;
        },
        gte(key, value) {
          filters.push((row) => row[key] >= value);
          return query;
        },
        lt(key, value) {
          filters.push((row) => row[key] < value);
          return query;
        },
        order() {
          return query;
        },
        limit(size) {
          to = size - 1;
          return query;
        },
        range(start, end) {
          from = start;
          to = end;
          ranges.push([start, end]);
          return query;
        },
        then(resolve) {
          const candidates = table === 'kaspi_orders' ? [] : records;
          return Promise.resolve({
            data: candidates
              .filter((row) => filters.every((filter) => filter(row)))
              .slice(from, to + 1),
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const service = new ForteWidgetService({ env, db });
  const reconciled = [];
  service.syncCardSetup = async (setup) => {
    reconciled.push(setup.id);
    if (setup.id !== 'current') throw new Error('outcome remains unknown');
  };
  assert.equal(await service.reconcileOrders(), 26);
  assert.equal(await service.reconcileOrders(), 26);
  assert.equal(await service.reconcileOrders(), 11);
  assert.deepEqual(ranges, [
    [0, 24],
    [25, 49],
    [50, 74],
  ]);
  assert.equal(new Set(reconciled.filter((id) => id.startsWith('old-'))).size, 60);
  assert.equal(reconciled.filter((id) => id === 'current').length, 3);
  assert.equal(reconciled.includes('old-unclosed'), false);
  assert.equal(service.closedSetupReconcileOffset, 0);
  assert.ok(records.slice(0, 60).every((row) => row.status === 'pending'));
});

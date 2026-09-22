const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { PersonalAccountTopups } = require('../src/services/personal-account-topup.service');
const { PersonalAccountService } = require('../src/services/personal-account.service');
const { ForteWidgetService } = require('../src/services/forte-widget.service');
const key = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const env = {
  FORTE_WIDGET_ENABLED: 'true',
  FORTE_WIDGET_SHOP_ID: '123456',
  FORTE_WIDGET_SECRET_KEY: 's'.repeat(40),
  FORTE_WIDGET_TOKEN_KEY: 't'.repeat(40),
  FORTE_WIDGET_WEBHOOK_PUBLIC_KEY: key.publicKey.export({ type: 'spki', format: 'pem' }),
};
const customer = crypto.randomUUID(),
  requestId = crypto.randomUUID(),
  token = 'a'.repeat(64),
  transaction = crypto.randomUUID();
function harness() {
  const rows = [];
  let credits = 0,
    created = 0,
    chargedAmount = 100000;
  const db = {
    from() {
      let filters = [],
        patch;
      const found = () => rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      const run = () => {
        const selected = found();
        if (patch) selected.forEach((r) => Object.assign(r, patch));
        return { data: selected.map((r) => ({ ...r })), error: null };
      };
      const q = {
        select() {
          return q;
        },
        eq(k, v) {
          filters.push([k, v]);
          return q;
        },
        in() {
          return q;
        },
        insert(items) {
          rows.push(...items.map((r) => ({ ...r, created_at: new Date().toISOString() })));
          return q;
        },
        update(value) {
          patch = value;
          return q;
        },
        async single() {
          const result = run();
          return { ...result, data: result.data[0] || null };
        },
        async maybeSingle() {
          return q.single();
        },
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return q;
    },
    async rpc(name, args) {
      assert.equal(name, 'personal_account_confirm_topup');
      const row = rows.find((r) => r.id === args.p_id);
      if (row.status !== 'credited') credits++;
      row.status = 'credited';
      row.provider_transaction_id = args.p_transaction_id;
      return { data: {}, error: null };
    },
  };
  const bank = new ForteWidgetService({ env });
  bank.createProviderCheckout = async (options) => {
    created++;
    assert.equal(options.purpose, 'account-topup');
    return { token, language: 'ru', expiresAt: new Date(Date.now() + 1800000).toISOString() };
  };
  bank.request = async () => ({
    response: { ok: true },
    body: {
      checkout: {
        token,
        shop_id: '123456',
        status: 'successful',
        finished: true,
        test: false,
        order: { tracking_id: rows[0].id, amount: chargedAmount, currency: 'KZT' },
        gateway_response: { payment: { uid: transaction, status: 'successful' } },
      },
    },
  });
  const account = { enabled: () => true, notify: () => {} };
  return {
    service: new PersonalAccountTopups({ db, bank, account, env }),
    rows,
    stats: () => ({ credits, created }),
    setAmount: (value) => {
      chargedAmount = value;
    },
  };
}
test('topup retries reuse one operation and credit only after a matching bank confirmation', async () => {
  const h = harness();
  const [a, b] = await Promise.all([
    h.service.create(customer, '+77000000000', { requestId, amount: 1000 }),
    h.service.create(customer, '+77000000000', { requestId, amount: 1000 }),
  ]);
  assert.equal(a.operationId, b.operationId);
  assert.equal(h.stats().created, 1);
  assert.equal(h.stats().credits, 0);
  assert.equal(
    new URLSearchParams(new URL(a.redirectUrl).hash.slice(1)).get('purpose'),
    'account-topup',
  );
  assert.equal(await h.service.find(a.operationId, crypto.randomUUID()), null);
  await assert.rejects(
    h.service.create(customer, '+77000000000', { requestId, amount: 2000 }),
    (e) => e.code === 'PERSONAL_ACCOUNT_REQUEST_USED',
  );
  h.setAmount(99999);
  await assert.rejects(
    h.service.sync(h.rows[0]),
    (e) => e.code === 'FORTE_WIDGET_PAYMENT_MISMATCH',
  );
  assert.equal(h.stats().credits, 0);
  h.setAmount(100000);
  await h.service.sync(h.rows[0]);
  await h.service.sync(h.rows[0]);
  assert.equal(h.stats().credits, 1);
  assert.equal(h.service.response(h.rows[0]).paymentStatus, 'paid');
});
test('account topup never requests a saved-card contract or saves a new card', async () => {
  let posted;
  const bank = new ForteWidgetService({
    env,
    fetchImpl: async (_url, options) => {
      if (options.body) posted = JSON.parse(options.body);
      return { ok: true, status: 200, text: async () => JSON.stringify({ checkout: { token } }) };
    },
  });
  await bank.createProviderCheckout({
    amountMinor: 100000,
    customerId: customer,
    phone: '+77000000000',
    trackingId: requestId,
    purpose: 'account-topup',
  });
  assert.equal(posted.checkout.settings.save_card_toggle.display, false);
  assert.equal(posted.checkout.order.additional_data.contract, undefined);
  assert(posted.checkout.settings.return_url.includes('/profile?payment=forte&topup='));
});
test('cash checkout attaches existing reservations before any debit', async () => {
  const events = [];
  const order = {
    id: requestId,
    operation_id: requestId,
    customer_id: customer,
    status: 'pending',
    payment_method: 'personal_account',
  };
  const db = {
    from() {
      let insert = false;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        insert() {
          insert = true;
          return q;
        },
        async single() {
          return { data: order, error: null };
        },
        async maybeSingle() {
          return { data: insert ? order : null, error: null };
        },
      };
      return q;
    },
    async rpc() {
      events.push('debit');
      return { data: { status: 'paid' }, error: null };
    },
  };
  const service = new PersonalAccountService({
    db,
    publish: () => {},
    orders: {
      orderRecord: () => order,
      recordPaidOrder: async () => ({ ...order, status: 'paid' }),
    },
    attachInventory: async () => events.push('inventory'),
    attachPromotion: async () => events.push('promotion'),
    markPayment: async () => events.push('budget'),
  });
  const result = await service.createCheckout(
    '77000000000',
    { total: 100, promotionId: 'promo', canonicalItems: [] },
    customer,
    { requestId },
  );
  assert.equal(result.paymentStatus, 'paid');
  assert.deepEqual(events, ['inventory', 'promotion', 'budget', 'debit']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const configPath = require.resolve('../src/config/supabase');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { supabase: {} },
};
const {
  querySchema,
  reviewSchema,
  registerReferralAdminRoutes,
} = require('../src/routes/admin/referral.routes');
const {
  referralNotification,
  rememberReferralDevice,
  customerReferralHistory,
} = require('../src/services/referral.service');
const { supabase } = require('../src/config/supabase');

test('referral report bounds periods and pagination; reviews require reasons and monetary precision', () => {
  assert.equal(querySchema.safeParse({ from: '2026-01-01', to: '2026-09-27' }).success, true);
  for (const query of [
    { from: '2024-01-01', to: '2026-09-27' },
    { from: '2026-09-27', to: '2026-01-01' },
    { from: '2026-01-01', to: '2026-09-27', offset: -1 },
    { from: '2026-01-01', to: '2026-09-27', branches: ['other'] },
  ])
    assert.equal(querySchema.safeParse(query).success, false);
  assert.equal(reviewSchema.safeParse({ action: 'approve', note: '' }).success, false);
  assert.equal(
    reviewSchema.safeParse({ action: 'return', note: 'checked', total: 0.001 }).success,
    false,
  );
  assert.equal(
    reviewSchema.safeParse({ action: 'return', note: 'checked', total: 1200.5 }).success,
    true,
  );
});

test('non-administrators cannot approve or record a POS refund', () => {
  const routes = [];
  registerReferralAdminRoutes({
    get() {},
    post(path, ...handlers) {
      routes.push({ path, handlers });
    },
  });
  let status;
  const res = {
    status(code) {
      status = code;
      return this;
    },
    json() {},
  };
  for (const role of ['marketer', 'branch_manager', 'operator', undefined]) {
    routes[0].handlers[0]({ admin: { role } }, res, () => assert.fail('unauthorized role passed'));
    assert.equal(status, 403);
  }
});

test('report scope comes from administrator access, not request data', async () => {
  const routes = [];
  registerReferralAdminRoutes({
    get(path, ...handlers) {
      routes.push({ path, handlers });
    },
    post() {},
  });
  const original = supabase.rpc;
  let passed;
  supabase.rpc = async (name, args) => {
    passed = { name, args };
    return { data: { summary: {}, items: [] }, error: null };
  };
  try {
    let output;
    await routes[0].handlers.at(-1)(
      {
        admin: { role: 'marketer', branchIds: ['branch-allowed'] },
        query: { from: '2026-09-01', to: '2026-09-27', offset: 50 },
      },
      {
        json(value) {
          output = value;
        },
      },
    );
    assert.deepEqual(passed.args.p_branches, ['branch-allowed']);
    assert.equal(passed.args.p_offset, 50);
    assert.equal(passed.args.p_to, '2026-09-27T19:00:00.000Z');
    assert.equal(output.canReview, false);
  } finally {
    supabase.rpc = original;
  }
});

test('device evidence stores a hash, while customer history binds the authenticated identity', async () => {
  const originalFrom = supabase.from,
    originalRpc = supabase.rpc;
  let recorded, args;
  supabase.from = () => ({
    upsert: async (value) => {
      recorded = value;
      return {};
    },
  });
  supabase.rpc = async (_, value) => {
    args = value;
    return { data: { registered: 0 } };
  };
  try {
    await rememberReferralDevice('customer', 'installation-12345');
    assert.equal(recorded.customer_id, 'customer');
    assert.match(recorded.device_hash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(recorded).includes('installation-12345'), false);
    await customerReferralHistory('authenticated-customer', 30);
    assert.deepEqual(args, { p_customer_id: 'authenticated-customer', p_offset: 30 });
  } finally {
    supabase.from = originalFrom;
    supabase.rpc = originalRpc;
  }
});

test('reward and debt notifications explain the cause in all supported languages', () => {
  for (const language of ['ru', 'kk', 'en']) {
    const credit = referralNotification({ kind: 'reward', amount: 1000 }, language);
    const reversal = referralNotification({ kind: 'reversal', amount: 500, debt: 300 }, language);
    assert.match(credit.body, /1000/);
    assert.match(reversal.body, /500/);
    assert.match(reversal.body, /300/);
    assert.notEqual(credit.title, reversal.title);
  }
});

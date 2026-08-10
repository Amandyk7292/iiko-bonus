const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  GIFT_CARD_ACTIONS,
  adminMutationRoleMiddleware,
  requireAdminAction,
  requireAdminMfa,
} = require('../src/middlewares/auth.middleware');
const { signAdminToken, verifyToken } = require('../src/services/auth.service');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const { loyaltyPosConfigurationErrors } = require('../src/config/env');

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';

const runMiddleware = (middleware, req) => {
  let nextCalled = false;
  let status = 200;
  let body = null;
  const res = {
    status(value) {
      status = value;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };
  const result = middleware(req, res, () => {
    nextCalled = true;
  });
  return Promise.resolve(result).then(() => ({ nextCalled, status, body, req }));
};

test('courier admin role is read-only and must use its own courier session for mutations', async () => {
  const base = {
    path: '/couriers/11111111-1111-4111-8111-111111111111',
    body: { phone: '+77001234567' },
    params: {},
    query: {},
    admin: { role: 'courier', branchIds: [BRANCH_ID] },
  };
  const mutation = await runMiddleware(adminMutationRoleMiddleware, {
    ...base,
    method: 'PUT',
  });
  assert.equal(mutation.nextCalled, false);
  assert.equal(mutation.status, 403);
  assert.equal(mutation.body.code, 'COURIER_SELF_SERVICE_REQUIRED');

  const read = await runMiddleware(adminMutationRoleMiddleware, { ...base, method: 'GET' });
  assert.equal(read.nextCalled, true);
});

test('monetary gift issuance requires an owner/admin action and MFA-authenticated session', async () => {
  for (const role of ['marketer', 'editor', 'branch_manager']) {
    const denied = await runMiddleware(requireAdminAction(GIFT_CARD_ACTIONS.ISSUE), {
      admin: { role },
    });
    assert.equal(denied.nextCalled, false, role);
    assert.equal(denied.status, 403, role);
    assert.equal(denied.body.code, 'ADMIN_ACTION_FORBIDDEN', role);
  }

  const owner = await runMiddleware(requireAdminAction(GIFT_CARD_ACTIONS.ISSUE), {
    admin: { role: 'owner', mfa: true },
  });
  assert.equal(owner.nextCalled, true);

  const noMfa = await runMiddleware(requireAdminMfa, { admin: { role: 'owner', mfa: false } });
  assert.equal(noMfa.nextCalled, false);
  assert.equal(noMfa.body.code, 'ADMIN_MFA_REQUIRED');
  const mfa = await runMiddleware(requireAdminMfa, { admin: { role: 'admin', mfa: true } });
  assert.equal(mfa.nextCalled, true);

  const token = signAdminToken({
    username: 'owner',
    role: 'owner',
    branchIds: [],
    mfaVerified: true,
  });
  assert.equal(verifyToken(token, 'bulka-admin').mfa, true);
});

test('gift issuance contract requires a UUID idempotency key', () => {
  const base = { amount: 5000, expiresAt: null };
  assert.equal(adminMutationSchemas.giftCard.body.safeParse(base).success, false);
  assert.equal(
    adminMutationSchemas.giftCard.body.safeParse({
      ...base,
      idempotencyKey: '99999999-9999-4999-8999-999999999999',
    }).success,
    true,
  );
});

test('courier identity routes and gift issuance are guarded before their handlers', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src', 'routes', 'admin.routes.js'),
    'utf8',
  );
  assert.match(source, /router\.post\(\s*'\/admin\/api\/couriers',\s*requireCourierIdentityRole/);
  assert.match(
    source,
    /router\.put\(\s*'\/admin\/api\/couriers\/:id',\s*requireCourierIdentityRole/,
  );
  assert.match(
    source,
    /router\.patch\(\s*'\/admin\/api\/couriers\/:id\/active',\s*requireCourierIdentityRole/,
  );
  assert.match(
    source,
    /router\.post\(\s*'\/admin\/api\/gift-cards',\s*requireAdminAction\(GIFT_CARD_ACTIONS\.ISSUE\),\s*requireAdminMfa/,
  );
});

test('POS rollout accepts legacy only in compatibility mode and rejects it in required mode', async (t) => {
  const previousMode = process.env.LOYALTY_BRANCH_POS_ENFORCEMENT;
  const middlewarePath = require.resolve('../src/middlewares/branch-pos-auth.middleware');
  const previousMiddleware = require.cache[middlewarePath];
  delete require.cache[middlewarePath];
  const { branchPosRolloutMiddleware } = require(middlewarePath);
  t.after(() => {
    if (previousMode === undefined) delete process.env.LOYALTY_BRANCH_POS_ENFORCEMENT;
    else process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = previousMode;
    if (previousMiddleware) require.cache[middlewarePath] = previousMiddleware;
    else delete require.cache[middlewarePath];
  });

  process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = 'compatibility';
  const compatible = await runMiddleware(branchPosRolloutMiddleware, {
    headers: {},
    body: {},
    path: '/api/loyalty/search',
  });
  assert.equal(compatible.nextCalled, true);
  assert.equal(compatible.req.posAuthMode, 'legacy');

  process.env.LOYALTY_BRANCH_POS_ENFORCEMENT = 'required';
  const required = await runMiddleware(branchPosRolloutMiddleware, {
    headers: {},
    body: {},
    path: '/api/loyalty/search',
  });
  assert.equal(required.nextCalled, false);
  assert.equal(required.status, 401);
  assert.equal(required.body.code, 'BRANCH_POS_UNAUTHORIZED');
});

test('production POS rollout mode is explicit and safety limits are coherent', () => {
  assert.match(loyaltyPosConfigurationErrors({}).join(','), /explicit/);
  assert.deepEqual(
    loyaltyPosConfigurationErrors({ LOYALTY_BRANCH_POS_ENFORCEMENT: 'compatibility' }),
    [],
  );
  const errors = loyaltyPosConfigurationErrors({
    LOYALTY_BRANCH_POS_ENFORCEMENT: 'required',
    LOYALTY_POS_MAX_ORDER_TOTAL: '250000',
    LOYALTY_POS_BRANCH_ROLLING_ORDER_TOTAL: '100000',
  });
  assert.match(errors.join(','), /ROLLING_ORDER_TOTAL/);
});

test('strict-mode coverage detects legacy reservations on the pre-migration schema', async () => {
  const { getBranchPosCoverage } = require('../src/services/branch-pos-credential.service');
  const rows = {
    bulka_locations: [{ id: BRANCH_ID }],
    branch_pos_credentials: [{ branch_id: BRANCH_ID }],
    loyalty_reservations: [{ id: '88888888-8888-4888-8888-888888888888' }],
  };
  const db = {
    from(table) {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        gt() {
          return this;
        },
        is(column, value) {
          assert.equal(column, 'pos_branch_id');
          assert.equal(value, null);
          this.usesPostMigrationColumn = true;
          return this;
        },
        not(column) {
          assert.equal(column, 'order_id');
          this.usesFallback = true;
          return this;
        },
        then(resolve) {
          if (table === 'loyalty_reservations' && this.usesPostMigrationColumn) {
            return Promise.resolve({
              data: null,
              count: null,
              // Production Supabase returns this empty shape for the pre-DDL
              // HEAD/count query, without a PostgreSQL or PostgREST code.
              error: { message: '' },
            }).then(resolve);
          }
          return Promise.resolve({
            data: rows[table],
            count: table === 'loyalty_reservations' ? rows[table].length : null,
            error: null,
          }).then(resolve);
        },
      };
      return query;
    },
  };
  const coverage = await getBranchPosCoverage({ db });
  assert.equal(coverage.configuredActiveBranches, 1);
  assert.equal(coverage.activeLegacyReservations, 1);
  assert.equal(coverage.readyForEnforcement, false);
});

test('strict-mode coverage uses the indexed branch column after migration', async () => {
  const { getBranchPosCoverage } = require('../src/services/branch-pos-credential.service');
  const db = {
    from(table) {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        gt() {
          return this;
        },
        is(column, value) {
          assert.equal(column, 'pos_branch_id');
          assert.equal(value, null);
          return this;
        },
        not() {
          assert.fail('post-migration coverage must not use the unindexed fallback');
        },
        then(resolve) {
          const result =
            table === 'loyalty_reservations'
              ? { data: null, count: 0, error: null }
              : {
                  data:
                    table === 'bulka_locations' ? [{ id: BRANCH_ID }] : [{ branch_id: BRANCH_ID }],
                  count: null,
                  error: null,
                };
          return Promise.resolve(result).then(resolve);
        },
      };
      return query;
    },
  };

  const coverage = await getBranchPosCoverage({ db });
  assert.equal(coverage.activeLegacyReservations, 0);
  assert.equal(coverage.readyForEnforcement, true);
});

test('strict-mode coverage fails closed when both schema paths fail', async () => {
  const { getBranchPosCoverage } = require('../src/services/branch-pos-credential.service');
  const databaseError = { message: 'database unavailable' };
  let loyaltyQueries = 0;
  const db = {
    from(table) {
      const query = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        gt() {
          return this;
        },
        is() {
          return this;
        },
        not() {
          return this;
        },
        then(resolve) {
          if (table !== 'loyalty_reservations') {
            return Promise.resolve({ data: [], count: null, error: null }).then(resolve);
          }
          loyaltyQueries += 1;
          return Promise.resolve({
            data: null,
            count: null,
            error: loyaltyQueries === 1 ? { message: '' } : databaseError,
          }).then(resolve);
        },
      };
      return query;
    },
  };

  await assert.rejects(
    () => getBranchPosCoverage({ db }),
    (error) => error === databaseError,
  );
  assert.equal(loyaltyQueries, 2);
});

test('a POS credential authenticates only its own branch', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const credentialPath = require.resolve('../src/services/branch-pos-credential.service');
  const middlewarePath = require.resolve('../src/middlewares/branch-pos-auth.middleware');
  const previous = new Map(
    [configPath, credentialPath, middlewarePath].map((modulePath) => [
      modulePath,
      require.cache[modulePath],
    ]),
  );
  const token = `bp1_${'a'.repeat(43)}`;
  const tokenHash = 'b'.repeat(64);
  let branchActive = true;
  const supabase = {
    from(table) {
      assert.ok(['branch_pos_credentials', 'bulka_locations'].includes(table));
      const filters = new Map();
      return {
        select() {
          return this;
        },
        eq(column, value) {
          filters.set(column, value);
          return this;
        },
        async maybeSingle() {
          const ownBranch = String(filters.get('branch_id')) === BRANCH_ID;
          if (table === 'bulka_locations') {
            return {
              data: branchActive ? { id: String(filters.get('id')) } : null,
              error: null,
            };
          }
          return {
            data: ownBranch ? { branch_id: BRANCH_ID, token_hash: tokenHash, active: true } : null,
            error: null,
          };
        },
      };
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  require.cache[credentialPath] = {
    id: credentialPath,
    filename: credentialPath,
    loaded: true,
    exports: { branchPosTokenHash: (value) => (value === token ? tokenHash : 'c'.repeat(64)) },
  };
  delete require.cache[middlewarePath];
  t.after(() => {
    for (const modulePath of [configPath, credentialPath, middlewarePath]) {
      const cached = previous.get(modulePath);
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  });

  const { branchPosAuthMiddleware } = require(middlewarePath);
  const allowed = await runMiddleware(branchPosAuthMiddleware, {
    headers: { 'x-bulka-branch-id': BRANCH_ID, 'x-bulka-pos-token': token },
    body: {},
    path: '/api/loyalty/search',
  });
  assert.equal(allowed.nextCalled, true);
  assert.equal(allowed.req.posBranchId, BRANCH_ID);

  const otherBranch = await runMiddleware(branchPosAuthMiddleware, {
    headers: {
      'x-bulka-branch-id': '33333333-3333-4333-8333-333333333333',
      'x-bulka-pos-token': token,
    },
    body: {},
    path: '/api/loyalty/search',
  });
  assert.equal(otherBranch.nextCalled, false);
  assert.equal(otherBranch.status, 401);

  branchActive = false;
  const closedBranch = await runMiddleware(branchPosAuthMiddleware, {
    headers: { 'x-bulka-branch-id': BRANCH_ID, 'x-bulka-pos-token': token },
    body: {},
    path: '/api/loyalty/search',
  });
  assert.equal(closedBranch.nextCalled, false);
  assert.equal(closedBranch.status, 401);
});

test('loyalty order identity is branch scoped and commit item totals are checked', () => {
  const {
    assertItemTotals,
    assertPosTransactionLimits,
    posLoyaltyLimits,
    scopedOrder,
  } = require('../src/services/loyalty-reservation.service');
  const rawOrderId = '22222222-2222-4222-8222-222222222222';
  const first = scopedOrder(rawOrderId, BRANCH_ID);
  const second = scopedOrder(rawOrderId, '33333333-3333-4333-8333-333333333333');
  assert.notEqual(first.scoped, second.scoped);
  assert.equal(scopedOrder(rawOrderId, null, { allowLegacy: true }).scoped, rawOrderId);
  assert.doesNotThrow(() => assertItemTotals([{ amount: 2, price: 50, total: 100 }], 120, 20));
  assert.throws(
    () => assertItemTotals([{ amount: 2, price: 50, total: 500 }], 500, 0),
    /item totals do not match/i,
  );
  const limits = posLoyaltyLimits({});
  assert.equal(limits.maxOrderTotal, 250000);
  assert.equal(limits.branchRollingOrderTotal, 25000000);
  assert.doesNotThrow(() =>
    assertPosTransactionLimits({ orderTotal: 249999, discountAmount: 99999 }, limits),
  );
  assert.throws(
    () => assertPosTransactionLimits({ orderTotal: 250001 }, limits),
    (error) => error.statusCode === 422 && /safety limit/i.test(error.message),
  );
});

test('branch-authenticated reservations use atomic rolling-limit RPCs', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const settingsPath = require.resolve('../src/services/settings.service');
  const servicePath = require.resolve('../src/services/loyalty-reservation.service');
  const modulePaths = [configPath, settingsPath, servicePath];
  const previous = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const calls = [];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        rpc: async (name, args) => {
          calls.push({ name, args });
          return {
            data: {
              reservation_id: '88888888-8888-4888-8888-888888888888',
              customer_id: '66666666-6666-4666-8666-666666666666',
              discount_amount: args.p_discount_amount,
              available_balance: 0,
              max_discount_percent: args.p_max_discount_percent,
              expires_at: '2026-08-11T00:00:00.000Z',
              duplicate: false,
            },
            error: null,
          };
        },
      },
    },
  };
  require.cache[settingsPath] = {
    id: settingsPath,
    filename: settingsPath,
    loaded: true,
    exports: { getSettings: async () => ({ max_discount_percent: 50 }) },
  };
  delete require.cache[servicePath];
  t.after(() => {
    for (const modulePath of modulePaths) {
      const cached = previous.get(modulePath);
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  });

  const { reserveLoyalty } = require(servicePath);
  const payload = {
    customerId: '66666666-6666-4666-8666-666666666666',
    orderId: '77777777-7777-4777-8777-777777777777',
    orderTotal: 10000,
    discountAmount: 1000,
  };
  await reserveLoyalty(payload, { branchId: BRANCH_ID });
  await reserveLoyalty(payload, { allowLegacy: true });
  assert.equal(calls[0].name, 'reserve_branch_loyalty_balance');
  assert.equal(calls[0].args.p_branch_id, BRANCH_ID);
  assert.equal(calls[0].args.p_rolling_order_count, 2000);
  assert.equal(calls[0].args.p_rolling_order_total, 25000000);
  assert.match(calls[0].args.p_order_id, new RegExp(`^bp1:${BRANCH_ID}:`));
  assert.equal(calls[1].name, 'reserve_loyalty_balance');
  assert.equal(calls[1].args.p_branch_id, undefined);
});

test('loyalty commit cannot replace the total captured by its reservation', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const settingsPath = require.resolve('../src/services/settings.service');
  const tierPath = require.resolve('../src/services/tier.service');
  const tierUtilPath = require.resolve('../src/utils/tier.util');
  const servicePath = require.resolve('../src/services/loyalty-reservation.service');
  const modulePaths = [configPath, settingsPath, tierPath, tierUtilPath, servicePath];
  const previous = new Map(
    modulePaths.map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  let rpcCalled = false;
  const supabase = {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        async maybeSingle() {
          if (table === 'customers') return { data: { total_spent: 0 }, error: null };
          return {
            data: { discount_amount: 20, order_total: 100, status: 'active' },
            error: null,
          };
        },
      };
    },
    async rpc() {
      rpcCalled = true;
      return { data: null, error: null };
    },
  };
  const install = (modulePath, exports) => {
    require.cache[modulePath] = {
      id: modulePath,
      filename: modulePath,
      loaded: true,
      exports,
    };
  };
  install(configPath, { supabase });
  install(settingsPath, { getSettings: async () => ({ bonus_activation: { enabled: false } }) });
  install(tierPath, { getActiveLoyaltyTiers: async () => [] });
  install(tierUtilPath, { getTierInfo: () => ({ percent: 5 }) });
  delete require.cache[servicePath];
  t.after(() => {
    for (const modulePath of modulePaths) {
      const cached = previous.get(modulePath);
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  });

  const { commitLoyalty } = require(servicePath);
  await assert.rejects(
    commitLoyalty(
      {
        customerId: '66666666-6666-4666-8666-666666666666',
        orderId: '77777777-7777-4777-8777-777777777777',
        reservationId: '88888888-8888-4888-8888-888888888888',
        orderTotal: 200,
        items: null,
      },
      { branchId: BRANCH_ID },
    ),
    (error) => error.statusCode === 409 && /does not match/i.test(error.message),
  );
  await assert.rejects(
    commitLoyalty(
      {
        customerId: '66666666-6666-4666-8666-666666666666',
        orderId: '77777777-7777-4777-8777-777777777777',
        reservationId: '88888888-8888-4888-8888-888888888888',
        orderTotal: 100,
        items: null,
      },
      { branchId: BRANCH_ID },
    ),
    (error) => error.statusCode === 409 && /items are required/i.test(error.message),
  );
  assert.equal(rpcCalled, false);
});

test('admin gift issuance is atomically idempotent and returns the original code on retry', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/commerce-marketing.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  const issued = new Map();
  const rpcCalls = [];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        rpc: async (name, args) => {
          assert.equal(name, 'issue_admin_gift_card');
          rpcCalls.push(args);
          const existing = issued.get(args.p_request_id);
          if (existing && existing.payloadHash !== args.p_payload_hash) {
            return { data: null, error: { message: 'admin gift card idempotency conflict' } };
          }
          if (existing) {
            return {
              data: {
                card: existing.card,
                codeCiphertext: existing.codeCiphertext,
                duplicate: true,
              },
              error: null,
            };
          }
          const record = {
            payloadHash: args.p_payload_hash,
            codeCiphertext: args.p_code_ciphertext,
            card: {
              id: '44444444-4444-4444-8444-444444444444',
              issue_request_id: args.p_request_id,
              initial_balance: args.p_amount,
              balance: args.p_amount,
            },
          };
          issued.set(args.p_request_id, record);
          return {
            data: { card: record.card, codeCiphertext: record.codeCiphertext, duplicate: false },
            error: null,
          };
        },
      },
    },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { issueGiftCard } = require(servicePath);
  const payload = {
    idempotencyKey: '55555555-5555-4555-8555-555555555555',
    amount: 5000,
    recipientName: 'Test',
    expiresAt: null,
  };
  const first = await issueGiftCard(payload, 'owner');
  const retry = await issueGiftCard(payload, 'owner');
  assert.equal(first.code, retry.code);
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(rpcCalls[0].p_daily_amount_limit, 2000000);
  assert.equal(rpcCalls[0].p_daily_count_limit, 20);
  await assert.rejects(
    issueGiftCard({ ...payload, amount: 6000 }, 'owner'),
    (error) => error.statusCode === 409,
  );
});

test('financial hardening migration keeps issuance atomic and service-role only', () => {
  const migration = fs.readFileSync(
    path.join(
      process.cwd(),
      'supabase',
      'migrations',
      '20260810110000_backend_rbac_financial_hardening.sql',
    ),
    'utf8',
  );
  assert.match(migration, /issue_request_id uuid/i);
  assert.match(migration, /create unique index[\s\S]+gift_cards\(issue_request_id\)/i);
  assert.match(migration, /pg_advisory_xact_lock/i);
  assert.match(migration, /insert into public\.gift_card_transactions/i);
  assert.match(
    migration,
    /revoke all on function public\.issue_admin_gift_card[\s\S]+from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.issue_admin_gift_card[\s\S]+to service_role/i,
  );
  assert.match(migration, /create table if not exists public\.branch_pos_loyalty_usage/i);
  assert.match(migration, /add column if not exists pos_branch_id uuid/i);
  assert.match(
    migration,
    /loyalty_reservations_active_legacy_expiry_idx[\s\S]+status = 'active' and order_id not like 'bp1:%'/i,
  );
  assert.match(migration, /create or replace function public\.reserve_branch_loyalty_balance/i);
  assert.match(migration, /create or replace function public\.commit_branch_loyalty_reservation/i);
  assert.match(migration, /branch loyalty rolling limit exceeded/i);
  assert.match(
    migration,
    /if v_usage\.status = 'committed' then\s+return public\.commit_loyalty_reservation/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.commit_branch_loyalty_reservation[\s\S]+from public, anon, authenticated/i,
  );
});

test('successful branch POS audit records keep their authenticated branch', () => {
  const { commitLogPayload } = require('../src/controllers/loyalty.controller');
  const payload = commitLogPayload(
    {
      branchId: BRANCH_ID,
      customerId: '66666666-6666-4666-8666-666666666666',
      orderId: '77777777-7777-4777-8777-777777777777',
      orderTotal: 1000,
      items: [],
    },
    { discountApplied: 100, earnedBonus: 45 },
  );
  assert.equal(payload.branchId, BRANCH_ID);
  assert.equal(payload.cashbackPercent, 5);
});

test('production iiko package validation requires the branch UUID and branch token', () => {
  const buildScript = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'build-iiko-plugin.ps1'),
    'utf8',
  );
  assert.match(buildScript, /IIKO_BRANCH_ID must contain the UUID/);
  assert.match(buildScript, /IIKO_BRANCH_POS_TOKEN must contain the separately rotated token/);
});

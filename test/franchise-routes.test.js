const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const calls = [];
let portalPartner = null;
const configPath = require.resolve('../src/config/supabase');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: {
    supabase: {
      from(table) {
        assert.equal(table, 'franchise_portal_users');
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: portalPartner ? { partner_id: portalPartner } : null, error: null };
          },
        };
      },
      rpc: async (name, args) => {
        calls.push({ name, args });
        return {
          data: { branches: [], orders: [], balances: [], payouts: [], totalOrders: 0 },
          error: null,
        };
      },
    },
  },
};
const routes = new Map();
require('../src/routes/admin/franchise.routes').registerFranchiseRoutes({
  get: (p, ...h) => routes.set('GET ' + p, h),
  post: (p, ...h) => routes.set('POST ' + p, h),
});
async function run(method, path, { role = 'owner', branchIds = [], query = {}, body = {} } = {}) {
  const req = { admin: { role, branchIds, sub: 'test-owner' }, query, body, params: {} };
  let status = 200,
    payload;
  const res = {
    status(s) {
      status = s;
      return this;
    },
    json(v) {
      payload = v;
      return this;
    },
  };
  const handlers = routes.get(method + ' /admin/api/transactions/settlements' + path);
  async function next(error) {
    if (error) {
      status = error.statusCode || 500;
      payload = { error: error.message };
      return;
    }
    const h = handlers[index++];
    if (h) await h(req, res, next);
  }
  let index = 0;
  await next();
  return { status, payload };
}
test('restricted report always sends scope and rejects another branch', async () => {
  const branch = randomUUID();
  calls.length = 0;
  let r = await run('GET', '', {
    role: 'viewer',
    branchIds: [branch],
    query: { from: '2026-09-01', to: '2026-09-30' },
  });
  assert.equal(r.status, 200);
  assert.deepEqual(calls[0].args.p_branches, [branch]);
  assert.equal(r.payload.canManage, false);
  r = await run('GET', '', {
    role: 'viewer',
    branchIds: [branch],
    query: { from: '2026-09-01', to: '2026-09-30', branch: randomUUID() },
  });
  assert.equal(r.status, 404);
  assert.equal(calls.length, 1);
});
test('unassigned operator never receives unrestricted report', async () => {
  calls.length = 0;
  await run('GET', '', { role: 'viewer', query: { from: '2026-09-01', to: '2026-09-30' } });
  assert.deepEqual(calls[0].args.p_branches, ['00000000-0000-0000-0000-000000000000']);
});
test('calendar validation rejects normalized invalid date and oversized period', async () => {
  for (const query of [
    { from: '2026-02-30', to: '2026-03-01' },
    { from: '2025-01-01', to: '2026-09-30' },
  ])
    assert.equal((await run('GET', '', { query })).status, 400);
});
test('only owner may mutate financial settings or record payouts', async () => {
  for (const role of ['viewer', 'admin', 'branch_manager', 'franchisee'])
    for (const path of ['/partners', '/terms', '/payouts'])
      assert.equal((await run('POST', path, { role })).status, 403);
});
test('terms validate percentages and permitted branch before RPC', async () => {
  const branch = randomUUID();
  const body = {
    branch: randomUUID(),
    partner: null,
    commission: 0,
    bonus: 10000,
    delivery: 'platform',
  };
  assert.equal(
    (await run('POST', '/terms', { branchIds: [branch], body, role: 'owner' })).status,
    200,
  );
  assert.equal((await run('POST', '/terms', { body: { ...body, commission: 10001 } })).status, 400);
});

test('franchisee report and drilldown bind partner from server and fail closed when unlinked', async () => {
  const branch = randomUUID();
  portalPartner = randomUUID();
  calls.length = 0;
  const q = { from: '2026-09-01', to: '2026-09-30' };
  let r = await run('GET', '', { role: 'franchisee', branchIds: [branch], query: q });
  assert.equal(r.status, 200);
  assert.equal(calls[0].args.p_partner, portalPartner);
  assert.deepEqual(calls[0].args.p_branches, [branch]);
  r = await run('GET', '/details', {
    role: 'franchisee',
    branchIds: [branch],
    query: { ...q, metric: 'cancelled' },
  });
  assert.equal(r.status, 200);
  assert.equal(calls[1].args.p_partner, portalPartner);
  r = await run('GET', '', {
    role: 'franchisee',
    branchIds: [branch],
    query: { ...q, partner: randomUUID() },
  });
  assert.equal(r.status, 400);
  portalPartner = null;
  calls.length = 0;
  r = await run('GET', '', { role: 'franchisee', branchIds: [branch], query: q });
  assert.equal(r.status, 403);
  assert.equal(calls.length, 0);
});

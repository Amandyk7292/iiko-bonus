const test = require('node:test');
const assert = require('node:assert/strict');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');

test('tablet receipt preserves reason, unit and retry identity', () => {
  const payload = {
    expectedRevision: 0,
    sourceQuantity: 10,
    stockReason: 'receipt',
    unit: 'шт',
    operationId: '11111111-1111-4111-8111-111111111111',
  };
  assert.deepEqual(adminMutationSchemas.cashierInventory.body.parse(payload), payload);
  for (const invalid of [{ unit: 'litre' }, { stockReason: 'unknown' }, { operationId: 'bad' }]) {
    assert.equal(
      adminMutationSchemas.cashierInventory.body.safeParse({ ...payload, ...invalid }).success,
      false,
    );
  }
});

test('tablet report uses assigned branch and returns JSON report', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const original = require.cache[configPath];
  const supabase = {};
  require.cache[configPath] = {id: configPath, filename: configPath, loaded: true, exports: {supabase}};
  t.after(() => {
    if (original) require.cache[configPath] = original;
    else delete require.cache[configPath];
  });
  const report = { products: [], events: [], totals: [], eventCount: 0, hasMore: false };
  supabase.rpc = async (name, args) => {
    assert.equal(name, 'cashier_display_stock_report');
    assert.deepEqual(args, { p_branch: 'assigned', p_date: '2026-09-24', p_offset: 0 });
    return { data: report, error: null };
  };
  let handlers;
  const router = new Proxy(
    {},
    {
      get:
        () =>
        (path, ...callbacks) => {
          if (path === '/admin/api/staff/reports/display-stock') handlers = callbacks;
        },
    },
  );
  require('../src/routes/admin/menu.routes').registerMenuAdminRoutes(router);
  assert.ok(handlers);
  const req = {
    admin: { role: 'cashier', branchIds: ['assigned'], selectedBranchId: 'other' },
    query: { date: '2026-09-24', offset: '0' },
  };
  handlers[0](req, {}, (error) => {
    if (error) throw error;
  });
  let response;
  await handlers[1](
    req,
    {
      json: (value) => {
        response = value;
      },
    },
    (error) => {
      throw error;
    },
  );
  assert.deepEqual(response, { success: true, ...report });
});

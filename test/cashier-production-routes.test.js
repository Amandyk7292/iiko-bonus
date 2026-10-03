const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const {
  registerCashierProductionRoutes,
} = require('../src/routes/admin/cashier-production.routes');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const { cashierBranch } = require('../src/services/cashier-catalog.service');
async function fixture(t) {
  const branch = randomUUID(),
    calls = [];
  const production = {
    getCashierProductionReport: async (admin, date) => {
      calls.push(['report', cashierBranch(admin), date]);
      return { products: [], acts: [] };
    },
    submitCashierProductionAct: async (admin, input) => {
      calls.push(['submit', cashierBranch(admin), input]);
      return { act: { id: input.requestId, status: 'created' } };
    },
  };
  const db = {
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return {
        data:
          name === 'reset_cashier_display_stock_report'
            ? { date: '2026-10-03', resetAt: '2026-10-03T12:00:00Z' }
            : { date: '2026-10-03', products: [], events: [], totals: [] },
      };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.admin = {
      role: req.get('x-role') || 'cashier',
      sub: 'cashier-test',
      branchIds: req.get('x-multi') ? [branch, randomUUID()] : [branch],
      selectedBranchId: randomUUID(),
    };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  registerCashierProductionRoutes(app, { production, db });
  app.use((error, req, res, next) => {
    void next;
    res.status(error.statusCode || 500).json({ code: error.code, error: error.message });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/api${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  };
  return { request, calls, branch };
}
test('production HTTP contract accepts only immutable event selection, never caller point/product/quantity/store', async (t) => {
  const f = await fixture(t),
    payload = { requestId: randomUUID(), date: '2026-10-03', eventIds: [randomUUID()] };
  assert.equal((await f.request('/staff/reports/production?date=2026-10-03')).cache, 'no-store');
  const accepted = await f.request('/staff/reports/production', payload);
  assert.equal(accepted.status, 200);
  assert.deepEqual(f.calls.at(-1), ['submit', f.branch, payload]);
  assert.equal(
    (await f.request('/staff/reports/production', { ...payload, branchId: randomUUID() })).status,
    403,
  );
  for (const additional of [
    { productId: randomUUID() },
    { quantity: 999 },
    { serverId: 'other' },
    { storeId: randomUUID() },
    { postImmediately: true },
  ])
    assert.equal(
      (await f.request('/staff/reports/production', { ...payload, ...additional })).status,
      400,
    );
  assert.equal(
    (await f.request('/staff/reports/production', { ...payload, eventIds: [] })).status,
    400,
  );
  assert.equal(
    (await f.request('/staff/reports/production', { ...payload, date: '2026-02-30' })).status,
    400,
  );
  assert.equal(f.calls.length, 2);
});
test('only single assigned cashier can read/create; unknown staff mutations remain denied', async (t) => {
  const f = await fixture(t),
    payload = { requestId: randomUUID(), date: '2026-10-03', eventIds: [randomUUID()] };
  for (const role of [
    'owner',
    'admin',
    'branch_manager',
    'operator',
    'viewer',
    'courier',
    'iiko_dashboard',
  ]) {
    assert.equal(
      (await f.request('/staff/reports/production', payload, { 'x-role': role })).status,
      403,
    );
    assert.equal(
      (await f.request('/staff/reports/production?date=2026-10-03', undefined, { 'x-role': role }))
        .status,
      403,
    );
  }
  assert.equal(
    (await f.request('/staff/reports/production', payload, { 'x-multi': '1' })).status,
    403,
  );
  assert.equal((await f.request('/staff/reports/other', payload)).status, 403);
  assert.equal(f.calls.length, 0);
});
test('existing report reset is an assigned-cashier confirmation and returns the reset report without deleting ledger', async (t) => {
  const f = await fixture(t);
  assert.equal(
    (await f.request('/staff/reports/display-stock/reset', { code: '1111' })).status,
    400,
  );
  assert.equal(
    (
      await f.request('/staff/reports/display-stock/reset', {
        code: '0000',
        branchId: randomUUID(),
      })
    ).status,
    403,
  );
  assert.equal(
    (await f.request('/staff/reports/display-stock/reset', { code: '0000' }, { 'x-role': 'owner' }))
      .status,
    403,
  );
  const response = await f.request('/staff/reports/display-stock/reset', { code: '0000' });
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls, [
    ['rpc', 'reset_cashier_display_stock_report', { p_branch: f.branch, p_actor: 'cashier-test' }],
    [
      'rpc',
      'cashier_display_stock_report',
      { p_branch: f.branch, p_date: '2026-10-03', p_offset: 0 },
    ],
  ]);
  assert.deepEqual(response.body.products, []);
});

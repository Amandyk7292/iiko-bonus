const test = require('node:test');
const assert = require('node:assert/strict');
const { receipt } = require('../src/services/iiko-dashboard-receipt');
const { receiptQuery } = require('../src/contracts/iiko-dashboard.contract');
const input = {
  serverId: 'astana-chain',
  date: '2026-08-15',
  department: 'Branch A',
  orderId: 'ce7f0801-b8a7-4918-ab37-53b437ee4e82',
};
test('receipt requires exact identity and includes full-price items without discount-name multiplication', async () => {
  assert(receiptQuery.safeParse(input).success);
  for (const change of [
    { orderId: '287' },
    { department: '' },
    { date: '2026-02-30' },
    { serverId: 'unknown' },
    { orderNumber: 287 },
  ])
    assert(!receiptQuery.safeParse({ ...input, ...change }).success);
  await receipt(
    {
      report: async (query) => {
        assert.equal(query.serverId, input.serverId);
        assert.equal(query.from, input.date);
        assert.equal(query.to, input.date);
        assert.deepEqual(query.filters.find((f) => f.field === 'UniqOrderId.Id').values, [
          input.orderId,
        ]);
        assert.deepEqual(query.filters.find((f) => f.field === 'Department').values, [
          input.department,
        ]);
        assert.deepEqual(query.filters.find((f) => f.field === 'Storned').values, ['FALSE']);
        assert(!query.filters.some((f) => f.field === 'DiscountPercent'));
        assert(!query.groupBy.includes('OrderDiscount.Type'));
        assert(query.groupBy.includes('DiscountPercent'));
        return { rows: [] };
      },
    },
    input,
  );
});
test('receipt endpoint enforces role, validates scope, polls and returns isolated check data', async (t) => {
  const express = require('express');
  const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
  const app = express();
  let calls = 0;
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.get('X-Test-Role') };
    next();
  });
  registerIikoDashboardRoutes(app, {
    receipt: async (query) => {
      calls++;
      return { rows: [{ id: query.orderId, branch: query.department }] };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const send = (body, role = 'owner') =>
    fetch(`http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/receipt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Role': role },
      body: JSON.stringify(body),
    });
  assert.equal((await send(input, 'cashier')).status, 403);
  assert.equal((await send({ ...input, orderId: '287' })).status, 400);
  assert.equal(calls, 0);
  const response = await send(input);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { pending: true });
  assert.deepEqual(await (await send(input)).json(), {
    rows: [{ id: input.orderId, branch: input.department }],
  });
  assert.equal(calls, 1);
  assert.deepEqual(await (await send({ ...input, department: 'Branch B' })).json(), {
    pending: true,
  });
  assert.equal(calls, 2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { Response } = require('node-fetch');
const { IikoDashboardClient } = require('../src/services/iiko-dashboard-client');
const { buildReport } = require('../src/services/iiko-dashboard.service');
const { reportQuery } = require('../src/contracts/iiko-dashboard.contract');
const { servers, credentialsFor } = require('../src/config/iiko-dashboard');
const { reportWorkbook } = require('../src/services/iiko-dashboard-export');
const AdmZip = require('adm-zip');
const token = '12345678-1234-1234-1234-123456789012';
const credentials = () => ({ login: 'fixture', password: 'fixture-secret' });
const input = {
  serverId: 'aktau-chain',
  reportType: 'SALES',
  from: '2026-09-01',
  to: '2026-09-07',
  groupBy: [],
  aggregate: ['Revenue'],
  filters: [],
};
const columns = {
  'OpenDate.Typed': { filteringAllowed: true },
  Revenue: { aggregationAllowed: true },
  Department: { groupingAllowed: true, filteringAllowed: true },
};

test('21 RMS servers and two independent Chain sources keep credentials within the assigned city', () => {
  assert.equal(servers.length, 23);
  assert.equal(new Set(servers.map((server) => server.id)).size, 23);
  assert.equal(servers.filter((server) => server.kind === 'chain').length, 2);
  const env = { IIKO_DASHBOARD_AKTAU_LOGIN: 'fixture', IIKO_DASHBOARD_AKTAU_PASSWORD: 'secret' };
  assert.equal(
    credentialsFor(
      servers.find((s) => s.id === 'astana-chain'),
      env,
    ),
    null,
  );
  assert.deepEqual(
    credentialsFor(
      servers.find((s) => s.id === 'bulka'),
      env,
    ),
    { login: 'fixture', password: 'secret' },
  );
  assert.equal(
    credentialsFor(
      servers.find((s) => s.id === 'bulka'),
      { ...env, IIKO_DASHBOARD_BULKA_LOGIN: 'separate' },
    ),
    null,
  );
});

test('report range includes last day but cannot be overridden by a filter', () => {
  const result = buildReport(input, columns);
  assert.deepEqual(result.filters['OpenDate.Typed'], {
    filterType: 'DateRange',
    periodType: 'CUSTOM',
    from: '2026-09-01T00:00:00.000',
    to: '2026-09-08T00:00:00.000',
    includeLow: true,
    includeHigh: false,
  });
  assert.throws(() =>
    buildReport(
      { ...input, filters: [{ field: 'OpenDate.Typed', values: ['2020-01-01'] }] },
      columns,
    ),
  );
  assert.throws(() => buildReport({ ...input, aggregate: ['Department'] }, columns));
  assert.throws(() => buildReport({ ...input, groupBy: ['Revenue'] }, columns));
});

test('contracts reject arbitrary servers, invalid dates and excessive ranges', () => {
  for (const patch of [
    { serverId: 'localhost' },
    { from: '2026-02-30' },
    { to: '2026-08-01' },
    { to: '2028-09-01' },
    { aggregate: [] },
    { url: 'https://example.com' },
  ])
    assert.equal(reportQuery.safeParse({ ...input, ...patch }).success, false);
  assert.equal(reportQuery.safeParse(input).success, true);
});

test('concurrent reports share a login and a failed report does not cancel its siblings', async () => {
  const calls = [];
  const client = new IikoDashboardClient({
    credentials,
    fetchImpl: async (url) => {
      const path = new URL(url).pathname.split('/').at(-1);
      calls.push(path);
      if (path === 'auth') return new Response(token);
      if (path === 'bad') return new Response('confidential upstream details', { status: 500 });
      return new Response('{}');
    },
  });
  const results = await Promise.allSettled([
    client.withSession('aktau-chain', (request) => request('bad')),
    client.withSession('aktau-chain', (request) => request('good')),
  ]);
  assert.equal(results[0].status, 'rejected');
  assert.equal(results[0].reason.message, 'IIKO_REPORT_FAILED');
  assert.equal(results[1].status, 'fulfilled');
  await new Promise(setImmediate);
  assert.deepEqual(calls, ['auth', 'bad', 'good', 'logout']);
  assert.equal(client.queues.size, 0);
});

test('authentication accepts text responses and secrets never leave server metadata or errors', async () => {
  const client = new IikoDashboardClient({
    credentials,
    fetchImpl: async (url, options) => {
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Accept, '*/*');
      throw new Error(`network error ${url}`);
    },
  });
  assert.doesNotMatch(JSON.stringify(client.listServers()), /fixture-secret|fixture/);
  await assert.rejects(
    client.withSession('aktau-chain', () => {}),
    (error) =>
      error.message === 'IIKO_REPORT_NETWORK' && !JSON.stringify(error).includes('fixture'),
  );
  await assert.rejects(
    client.withSession('not-in-list', () => {}),
    { code: 'IIKO_REPORT_SERVER' },
  );
});

test('XLSX preserves numeric types and exports untrusted text without formulas', () => {
  const bytes = reportWorkbook({
    columns: { name: { name: 'Товар' }, amount: { name: 'Сумма' } },
    rows: [{ name: '=HYPERLINK("x")<&', amount: 12.5 }],
  });
  const zip = new AdmZip(bytes);
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.match(sheet, /<v>12.5<\/v>/);
  assert.match(sheet, /t="inlineStr"/);
  assert.match(sheet, /&lt;&amp;/);
  assert.doesNotMatch(sheet, /<f>/);
});

test('financial reporting routes reject staff and invalid payloads before querying iiko', async (t) => {
  const express = require('express');
  const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
  let calls = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-fixture-role'] };
    next();
  });
  registerIikoDashboardRoutes(app, {
    listServers: () => [],
    report: async () => {
      calls++;
      return { rows: [] };
    },
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/report`;
  for (const role of ['viewer', 'branch_manager', 'cashier', 'operator']) {
    const result = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fixture-role': role },
      body: JSON.stringify(input),
    });
    assert.equal(result.status, 403);
  }
  assert.equal(calls, 0);
  const invalid = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-fixture-role': 'owner' },
    body: JSON.stringify({ ...input, serverId: 'private-host' }),
  });
  assert.equal(invalid.status, 400);
  assert.equal(calls, 0);
  const good = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-fixture-role': 'owner' },
    body: JSON.stringify(input),
  });
  assert.equal(good.status, 200);
  assert.equal(good.headers.get('cache-control'), 'no-store');
  assert.equal(calls, 1);
});

const { analyticsQuery, analyticsReport } = require('../src/services/iiko-dashboard-analytics');
test('closed RMS servers cannot authenticate even when a city account exists', async () => {
  const closed = servers.filter((server) => !server.active);
  assert.equal(closed.length, 3);
  const client = new IikoDashboardClient({
    credentials,
    fetchImpl: () => {
      throw new Error('must not connect');
    },
  });
  for (const server of closed)
    await assert.rejects(
      client.withSession(server.id, () => {}),
      { code: 'IIKO_REPORT_CLOSED' },
    );
});
test('cashier ranking uses cashier identity and excludes deleted lines, not waiter name', () => {
  const query = analyticsQuery({ ...input, view: 'cashiers', department: 'Branch' });
  assert.deepEqual(query.groupBy, ['Cashier.Id', 'Cashier', 'Department']);
  assert(
    query.filters.some(
      (filter) => filter.field === 'DeletedWithWriteoff' && filter.values[0] === 'NOT_DELETED',
    ),
  );
  assert(query.aggregate.includes('ItemSaleEventDiscountType.DiscountAmount'));
  const result = analyticsReport(
    {
      rows: [
        { DishDiscountSumInt: 90, DishSumInt: 100, DiscountSum: 10, UniqOrderId: 3 },
        { DishDiscountSumInt: 0, UniqOrderId: 0 },
      ],
      columns: {},
    },
    { view: 'cashiers' },
  );
  assert.equal(result.rows[0].AverageCheck, 30);
  assert.equal(result.rows[0].DiscountRate, 10);
  assert.equal(result.rows[1].AverageCheck, null);
});
test('writeoffs exclude sale consumption and matching account entries; retain reversals and units', () => {
  const query = analyticsQuery({ ...input, view: 'writeoffBranches' });
  assert(
    query.filters.some(
      (filter) => filter.field === 'TransactionType' && filter.values.join() === 'WRITEOFF',
    ),
  );
  assert(
    query.filters.some(
      (filter) => filter.field === 'Account.StoreOrAccount' && filter.values.join() === 'STORE',
    ),
  );
  const rows = [
    {
      Department: 'A',
      Store: 'S',
      'Product.MeasureUnit': 'pcs',
      Amount: -3,
      'Sum.ResignedSum': -60,
    },
    { Department: 'A', Store: 'S', 'Product.MeasureUnit': 'pcs', Amount: 1, 'Sum.ResignedSum': 20 },
    {
      Department: 'A',
      Store: 'S',
      'Product.MeasureUnit': 'kg',
      Amount: -0.5,
      'Sum.ResignedSum': -10,
    },
  ];
  const result = analyticsReport(
    { rows, columns: { Department: {}, Store: {} } },
    { view: 'writeoffBranches' },
  );
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].WriteoffCost, 50);
  assert.equal(result.rows[0].WriteoffQuantity, '2 pcs · 0.5 kg');
});

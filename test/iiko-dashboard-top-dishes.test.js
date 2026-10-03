const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { IikoDashboardService } = require('../src/services/iiko-dashboard.service');
const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const { reportQuery } = require('../src/contracts/iiko-dashboard.contract');

const query = {
  serverId: 'aktau-chain',
  from: '2026-12-31',
  to: '2026-12-31',
  view: 'products',
  department: 'Bulka 19а мкр',
};

const grouping = ['DishId', 'DishName', 'DishMeasureUnit', 'DishGroup'];
const aggregates = [
  'DishAmountInt',
  'DishDiscountSumInt',
  'DishSumInt',
  'UniqOrderId',
  'DiscountSum',
  'ItemSaleEventDiscountType.DiscountAmount',
  'ProductCostBase.ProductCost',
];
const columns = {
  'OpenDate.Typed': { filteringAllowed: true },
  Department: { filteringAllowed: true },
  OrderDeleted: { filteringAllowed: true },
  DeletedWithWriteoff: { filteringAllowed: true },
  ...Object.fromEntries(grouping.map((field) => [field, { groupingAllowed: true }])),
  ...Object.fromEntries(aggregates.map((field) => [field, { aggregationAllowed: true }])),
};

test('product analytics scopes the complete selected iiko day and preserves signed quantities and identity splits', async () => {
  const data = [
    {
      DishId: 'bread',
      DishName: 'Хлеб',
      DishMeasureUnit: 'шт',
      DishGroup: 'Выпечка',
      DishAmountInt: 8,
    },
    {
      DishId: 'bread',
      DishName: 'Хлеб новый',
      DishMeasureUnit: 'шт',
      DishGroup: 'Хлеб',
      DishAmountInt: -2,
    },
    {
      DishId: 'bread',
      DishName: 'Хлеб',
      DishMeasureUnit: 'кг',
      DishGroup: 'Хлеб',
      DishAmountInt: 0.75,
    },
    {
      DishId: 'another',
      DishName: 'Хлеб',
      DishMeasureUnit: 'шт',
      DishGroup: 'Хлеб',
      DishAmountInt: 3,
    },
  ];
  let requestBody;
  const service = new IikoDashboardService({
    withSession: async (serverId, work) => {
      assert.equal(serverId, query.serverId);
      return work(async (path, body) => {
        if (path === 'v2/reports/olap/columns?reportType=SALES') return columns;
        assert.equal(path, 'v2/reports/olap');
        requestBody = body;
        return { data };
      });
    },
  });
  const report = await service.analytics(query);
  assert.deepEqual(requestBody.filters['OpenDate.Typed'], {
    filterType: 'DateRange',
    periodType: 'CUSTOM',
    from: '2026-12-31T00:00:00.000',
    to: '2027-01-01T00:00:00.000',
    includeLow: true,
    includeHigh: false,
  });
  assert.deepEqual(requestBody.filters.Department, {
    filterType: 'IncludeValues',
    values: [query.department],
  });
  for (const field of ['OrderDeleted', 'DeletedWithWriteoff'])
    assert.deepEqual(requestBody.filters[field], {
      filterType: 'IncludeValues',
      values: ['NOT_DELETED'],
    });
  assert.deepEqual(requestBody.groupByRowFields, grouping);
  assert(requestBody.aggregateFields.includes('DishAmountInt'));
  assert.deepEqual(report.period, { from: query.from, to: query.to });
  assert.deepEqual(
    report.rows.map((row) => row.DishAmountInt),
    [8, -2, 0.75, 3],
  );
  assert.deepEqual(
    report.rows.map((row) => [row.DishId, row.DishName, row.DishMeasureUnit, row.DishGroup]),
    data.map((row) => [row.DishId, row.DishName, row.DishMeasureUnit, row.DishGroup]),
  );
});

test('product analytics cache separates city servers and selected departments', async () => {
  const calls = [];
  const service = new IikoDashboardService({
    withSession: async (serverId, work) =>
      work(async (path, body) => {
        if (path === 'v2/reports/olap/columns?reportType=SALES') return columns;
        assert.equal(path, 'v2/reports/olap');
        const department = body.filters.Department?.values[0] || '';
        calls.push({ serverId, department });
        return {
          data: [
            {
              DishId: `${serverId}:${department}`,
              DishMeasureUnit: 'шт',
              DishAmountInt: calls.length,
            },
          ],
        };
      }),
  });
  const aktau = await service.analytics(query);
  const astana = await service.analytics({ ...query, serverId: 'astana-chain' });
  const anotherPoint = await service.analytics({ ...query, department: 'Bulka 2 мкр' });
  const allPoints = await service.analytics({ ...query, department: '' });
  const cached = await service.analytics(query);
  assert.deepEqual(calls, [
    { serverId: 'aktau-chain', department: query.department },
    { serverId: 'astana-chain', department: query.department },
    { serverId: 'aktau-chain', department: 'Bulka 2 мкр' },
    { serverId: 'aktau-chain', department: '' },
  ]);
  assert.equal(aktau.rows[0].DishAmountInt, 1);
  assert.equal(astana.rows[0].DishAmountInt, 2);
  assert.equal(anotherPoint.rows[0].DishAmountInt, 3);
  assert.equal(allPoints.rows[0].DishAmountInt, 4);
  assert.equal(cached.rows[0].DishAmountInt, 1);
  assert.equal(astana.serverId, 'astana-chain');
});

test('read-only dashboard role can read product analytics while invalid scope and other roles never reach iiko', async (t) => {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-fixture-role'] || 'iiko_dashboard', branchIds: [] };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  registerIikoDashboardRoutes(app, {
    analytics: async (input) => {
      calls.push(input);
      return { rows: [], columns: {}, fetchedAt: '2026-12-31T12:00:00Z', serverId: input.serverId };
    },
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/analytics`;
  const request = (body, role = 'iiko_dashboard') =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fixture-role': role },
      body: JSON.stringify(body),
    });
  const result = await request(query);
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'no-store');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].department, query.department);
  assert.equal(calls[0].view, 'products');
  for (const patch of [
    { from: '2026-02-30' },
    { to: '2026-12-30' },
    { serverId: 'https://untrusted.invalid' },
    { department: 'x'.repeat(251) },
  ])
    assert.equal((await request({ ...query, ...patch })).status, 400);
  for (const role of ['branch_manager', 'viewer', 'cashier', 'operator'])
    assert.equal((await request(query, role)).status, 403);
  assert.equal(calls.length, 1);
});

const productId = '99999999-9999-4999-8999-999999999999';
const detailQuery = {
  serverId: query.serverId,
  reportType: 'SALES',
  from: '2026-12-30',
  to: '2026-12-31',
  groupBy: ['OpenDate.Typed', 'Department', 'DishMeasureUnit'],
  aggregate: ['DishAmountInt', 'DishDiscountSumInt'],
  filters: [
    { field: 'OrderDeleted', values: ['NOT_DELETED'] },
    { field: 'DeletedWithWriteoff', values: ['NOT_DELETED'] },
    { field: 'DishId', values: [productId] },
    { field: 'Department', values: [query.department] },
  ],
};
const detailColumns = {
  ...columns,
  'OpenDate.Typed': { filteringAllowed: true, groupingAllowed: true },
  Department: { filteringAllowed: true, groupingAllowed: true },
  DishId: { filteringAllowed: true, groupingAllowed: true },
};

test('product drilldown keeps product, point, units and signed values within the complete selected period', async () => {
  const data = [
    {
      'OpenDate.Typed': '2026-12-30',
      Department: query.department,
      DishMeasureUnit: 'шт',
      DishAmountInt: 3,
      DishDiscountSumInt: 900,
    },
    {
      'OpenDate.Typed': '2026-12-31',
      Department: query.department,
      DishMeasureUnit: 'шт',
      DishAmountInt: -1,
      DishDiscountSumInt: -300,
    },
    {
      'OpenDate.Typed': '2026-12-31',
      Department: query.department,
      DishMeasureUnit: 'кг',
      DishAmountInt: 0.5,
      DishDiscountSumInt: 350,
    },
  ];
  let requestBody;
  const service = new IikoDashboardService({
    withSession: async (serverId, work) => {
      assert.equal(serverId, detailQuery.serverId);
      return work(async (path, body) => {
        if (path === 'v2/reports/olap/columns?reportType=SALES') return detailColumns;
        assert.equal(path, 'v2/reports/olap');
        requestBody = body;
        return { data };
      });
    },
  });
  const report = await service.report(reportQuery.parse(detailQuery));
  assert.deepEqual(requestBody.groupByRowFields, detailQuery.groupBy);
  assert.deepEqual(requestBody.aggregateFields, detailQuery.aggregate);
  assert.deepEqual(requestBody.filters.DishId, {
    filterType: 'IncludeValues',
    values: [productId],
  });
  assert.deepEqual(requestBody.filters.Department, {
    filterType: 'IncludeValues',
    values: [query.department],
  });
  assert.deepEqual(requestBody.filters['OpenDate.Typed'], {
    filterType: 'DateRange',
    periodType: 'CUSTOM',
    from: '2026-12-30T00:00:00.000',
    to: '2027-01-01T00:00:00.000',
    includeLow: true,
    includeHigh: false,
  });
  assert.deepEqual(report.rows, data);
  assert.deepEqual(report.period, { from: detailQuery.from, to: detailQuery.to });
  assert.equal(report.columns.DishMeasureUnit.groupingAllowed, true);
});

test('read-only dashboard role can open product drilldown for exact point or all server departments', async (t) => {
  const calls = [];
  const service = new IikoDashboardService({
    withSession: async (serverId, work) =>
      work(async (path, body) => {
        if (path === 'v2/reports/olap/columns?reportType=SALES') return detailColumns;
        assert.equal(path, 'v2/reports/olap');
        calls.push({ serverId, body });
        return {
          data: [
            {
              'OpenDate.Typed': '2026-12-31',
              Department: body.filters.Department?.values[0] || 'Other department',
              DishMeasureUnit: 'шт',
              DishAmountInt: -1.25,
              DishDiscountSumInt: -200,
            },
          ],
        };
      }),
  });
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-fixture-role'] || 'iiko_dashboard', branchIds: [] };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  registerIikoDashboardRoutes(app, service);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  await new Promise((resolve) => server.once('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/report`;
  const request = (body, role = 'iiko_dashboard') =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-fixture-role': role },
      body: JSON.stringify(body),
    });
  const exactPoint = await request(detailQuery);
  assert.equal(exactPoint.status, 200);
  assert.equal(exactPoint.headers.get('cache-control'), 'no-store');
  const exactReport = await exactPoint.json();
  assert.equal(exactReport.rows[0].Department, query.department);
  assert.equal(exactReport.rows[0].DishAmountInt, -1.25);
  assert.equal(exactReport.rows[0].DishMeasureUnit, 'шт');
  const allPoints = await request({
    ...detailQuery,
    filters: detailQuery.filters.filter((filter) => filter.field !== 'Department'),
  });
  assert.equal(allPoints.status, 200);
  assert.equal(Object.hasOwn(calls[1].body.filters, 'Department'), false);
  for (const call of calls) {
    assert.equal(call.serverId, detailQuery.serverId);
    assert.deepEqual(call.body.filters.DishId.values, [productId]);
  }
  const overriddenDate = await request({
    ...detailQuery,
    filters: [...detailQuery.filters, { field: 'OpenDate.Typed', values: ['2020-01-01'] }],
  });
  assert.equal(overriddenDate.status, 400);
  assert.equal((await overriddenDate.json()).code, 'IIKO_REPORT_FIELD');
  assert.equal((await request({ ...detailQuery, from: '2026-02-30' })).status, 400);
  assert.equal((await request(detailQuery, 'branch_manager')).status, 403);
  assert.equal(calls.length, 2);
});

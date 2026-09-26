const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const AdmZip = require('adm-zip');
const { ReportCache } = require('../src/services/iiko-dashboard-cache');
const {
  productSales,
  retailDepartments,
  searchProducts,
} = require('../src/services/iiko-dashboard-product-sales');
const { productSalesQuery } = require('../src/contracts/iiko-dashboard.contract');
const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');

const productId = '2f53ff93-cb20-4325-a8d7-7d13659f4f45';
const koze = { id: productId, name: ' Коже', type: 'DISH', deleted: false };
const departments = [
  { name: 'Bulka 16 мкр 85 дом' },
  { name: 'Bulka 19А мкр 11дом' },
  { name: 'Bulka Ozen' },
  { name: 'Bulka Атырау Пристройка 23а' },
  { name: 'Bulka ЦО' },
  { name: 'ИП РУБЛЕВА' },
];
const period = {
  serverId: 'aktau-chain',
  productId,
  from: '2026-08-01',
  to: '2026-08-02',
  department: '',
};
const sourceRows = [
  {
    'OpenDate.Typed': '2026-08-01',
    Department: 'Bulka 16 мкр 85 дом',
    DishId: productId,
    DishName: ' Коже',
    DishMeasureUnit: 'шт',
    DishAmountInt: 6,
    DishDiscountSumInt: 2900,
    DishSumInt: 3000,
  },
  {
    'OpenDate.Typed': '2026-08-02',
    Department: 'Bulka 16 мкр 85 дом',
    DishId: productId,
    DishName: ' Коже',
    DishMeasureUnit: 'шт',
    DishAmountInt: 7,
    DishDiscountSumInt: 3500,
    DishSumInt: 3500,
  },
  {
    'OpenDate.Typed': '2026-08-01',
    Department: 'Bulka Ozen',
    DishId: productId,
    DishName: ' Коже',
    DishMeasureUnit: 'шт',
    DishAmountInt: 100,
    DishDiscountSumInt: 50000,
    DishSumInt: 50000,
  },
];

function fixture() {
  const queries = [];
  const service = {
    reports: new ReportCache(),
    client: {
      withSession: async (_, work) =>
        work(async () => [
          koze,
          {
            id: '11111111-1111-4111-8111-111111111111',
            name: 'Синнабон',
            type: 'DISH',
            deleted: false,
          },
        ]),
    },
    listServers: async () => [{ id: 'aktau-chain', city: 'aktau', active: true, configured: true }],
    departments: async () => ({ departments }),
    report: async (query) => {
      queries.push(query);
      return {
        rows: sourceRows,
        fetchedAt: '2026-09-23T12:16:12Z',
        columns: {},
        serverId: query.serverId,
      };
    },
  };
  return { service, queries };
}

test('catalog finds Kazakh and Russian spellings by iiko identity', async () => {
  const { service } = fixture();
  assert.deepEqual(
    (await searchProducts(service, { serverId: 'aktau-chain', search: 'көже' })).products,
    [{ id: productId, name: 'Коже', archived: false }],
  );
  assert.deepEqual(
    (await searchProducts(service, { serverId: 'aktau-chain', search: 'коже' })).products,
    [{ id: productId, name: 'Коже', archived: false }],
  );
  assert.deepEqual(
    retailDepartments('astana', [
      { name: 'Bulka Астана Туран 42' },
      { name: 'Bulka Астана ЦО' },
      { name: 'ИП ТЕЛЕУБАЕВА' },
    ]),
    ['Bulka Астана Туран 42'],
  );
});

test('daily report excludes another city, retains zero days and scopes one point', async () => {
  const { service, queries } = fixture();
  const all = await productSales(service, period);
  assert.equal(all.summary.quantity, 13);
  assert.equal(all.summary.net, 6400);
  assert.equal(all.summary.gross, 6500);
  assert.equal(all.rows.length, 4);
  assert.deepEqual(
    all.daily.map((day) => [day.date, day.quantity]),
    [
      ['2026-08-01', 6],
      ['2026-08-02', 7],
    ],
  );
  assert.equal(
    all.byDepartment.find((row) => row.department === 'Bulka 19А мкр 11дом').quantity,
    0,
  );
  assert.equal(queries[0].filters.find((filter) => filter.field === 'DishId').values[0], productId);
  assert(queries[0].filters.some((filter) => filter.field === 'OrderDeleted'));
  const one = await productSales(service, { ...period, department: 'Bulka 19А мкр 11дом' });
  assert.equal(one.rows.length, 2);
  assert.equal(one.summary.quantity, 0);
  assert.deepEqual(queries[1].filters.find((filter) => filter.field === 'Department').values, [
    'Bulka 19А мкр 11дом',
  ]);
  await assert.rejects(productSales(service, { ...period, department: 'Bulka Ozen' }), {
    code: 'IIKO_REPORT_FIELD',
  });
  assert.equal(queries.length, 2);
});

test('period validation rejects malformed requests and export keeps amounts as numbers', async () => {
  for (const patch of [
    { productId: 'bad' },
    { to: '2026-07-31' },
    { to: '2028-08-01' },
    { reportType: 'TRANSACTIONS' },
  ]) {
    assert.equal(productSalesQuery.safeParse({ ...period, ...patch }).success, false);
  }
  const { service } = fixture();
  const result = await productSales(service, period);
  const { reportWorkbook } = require('../src/services/iiko-dashboard-export');
  const { exportProductSales } = require('../src/services/iiko-dashboard-product-sales');
  const zip = new AdmZip(reportWorkbook(exportProductSales(result)));
  const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
  assert.match(sheet, /01\.08\.2026/);
  assert.match(sheet, /<v>6400<\/v>/);
  assert.match(sheet, /<v>13<\/v>/);
  assert.doesNotMatch(sheet, /Bulka Ozen/);
});

test('sales and Excel endpoints are owner-only and reject invalid payloads before iiko', async (t) => {
  let reports = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.headers['x-role'] };
    next();
  });
  registerIikoDashboardRoutes(app, {
    productSales: async () => {
      reports++;
      return {
        ...(await productSales(fixture().service, period)),
      };
    },
    searchProducts: async () => ({ products: [] }),
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const listener = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => listener.once('listening', resolve));
  t.after(() => listener.close());
  const base = `http://127.0.0.1:${listener.address().port}/admin/api/iiko-dashboard/product-sales`;
  for (const path of [base, `${base}/export`]) {
    const denied = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-role': 'cashier' },
      body: JSON.stringify(period),
    });
    assert.equal(denied.status, 403);
    const invalid = await fetch(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-role': 'owner' },
      body: JSON.stringify({ ...period, productId: 'not-a-product' }),
    });
    assert.equal(invalid.status, 400);
  }
  assert.equal(reports, 0);
  const valid = await fetch(`${base}/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-role': 'owner' },
    body: JSON.stringify(period),
  });
  assert.equal(valid.status, 200);
  assert.match(valid.headers.get('content-type'), /spreadsheetml/);
  assert.equal(reports, 1);
});

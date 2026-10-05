const test = require('node:test');
const assert = require('node:assert/strict');
const { writeoffControl, operationsControl } = require('../src/services/iiko-dashboard-controls');
const { controlsExport } = require('../src/services/iiko-dashboard-controls-export');
const { controlsExportQuery } = require('../src/contracts/iiko-dashboard.contract');

const input = {
  serverId: 'aktau-chain',
  mode: 'writeoffs',
  from: '2026-09-01',
  to: '2026-09-07',
  department: '',
  discountThreshold: 30,
  returnThreshold: 50000,
};
const report = (rows) => ({
  rows,
  columns: {},
  period: { from: input.from, to: input.to },
  serverId: input.serverId,
  fetchedAt: '2026-09-08T00:00:00Z',
});
const writeoff = (patch = {}) => ({
  Department: 'A',
  Store: 'Store 1',
  Document: '100',
  'DateTime.DateTyped': '2026-09-01',
  'Product.Id': 'bread',
  'Product.Name': 'Bread',
  'Product.MeasureUnit': 'pcs',
  'Contr-Account.Name': 'Spoilage',
  WriteoffQuantity: 1,
  WriteoffCost: 10,
  ...patch,
});
const discount = (patch = {}) => ({
  Department: 'A',
  'Cashier.Id': 'alice',
  Cashier: 'Alice',
  'UniqOrderId.Id': '574ca4a5-d482-40b4-ac32-2d73387017c0',
  'OpenDate.Typed': '2026-09-01',
  CloseTime: '2026-09-01T12:00:00',
  OrderNum: 10,
  AuthUser: 'Manager',
  'OrderDiscount.Type': 'Loyalty',
  DishSumInt: 100,
  DiscountSum: 10,
  ...patch,
});
const operations = (rows) =>
  operationsControl({ ...input, mode: 'operations' }, report(rows), report([]));

test('writeoff branch rank follows net writeoff value, retains correction and deterministic ties', () => {
  const result = writeoffControl(
    input,
    report([
      writeoff(),
      writeoff({ Department: 'C', WriteoffCost: 30 }),
      writeoff({ Department: 'B', WriteoffCost: 50 }),
      writeoff({ Department: 'B', Document: 'correction', WriteoffCost: -20 }),
      writeoff({ Department: 'D', WriteoffCost: -5, WriteoffQuantity: -1 }),
    ]),
    report([]),
    report([]),
  );
  assert.deepEqual(
    result.tables.branches.rows.map((row) => [row.Department, row.WriteoffCost, row.Rank]),
    [
      ['B', 30, 1],
      ['C', 30, 1],
      ['A', 10, 3],
      ['D', -5, 4],
    ],
  );
  assert.equal(result.summary.cost, 65);
  for (const branch of result.tables.branches.rows) {
    assert.equal(
      branch.DocumentCount,
      result.tables.documents.rows.filter((row) => row.Department === branch.Department).length,
    );
  }
  assert.equal(result.summary.documents, result.tables.documents.rows.length);
  assert.equal(
    result.tables.documents.rows.find((row) => row.Document === 'correction').WriteoffCost,
    -20,
  );
});

test('documents with same number remain isolated by branch, store and date; exact product drilldown sums', () => {
  const original = [
    writeoff({ Comment: 'First' }),
    writeoff({
      'Product.Id': 'milk',
      'Product.MeasureUnit': 'kg',
      WriteoffCost: 20,
      Comment: 'Second',
    }),
    writeoff({ Department: 'B' }),
    writeoff({ Store: 'Store 2' }),
    writeoff({ 'DateTime.DateTyped': '2026-09-02' }),
    writeoff({ Document: 'reversal', WriteoffCost: -5, WriteoffQuantity: -1 }),
  ];
  const snapshot = structuredClone(original);
  const result = writeoffControl(input, report(original), report([]), report([]));
  const headers = result.tables.documents.rows;
  const items = result.tables.documentItems.rows;
  assert.equal(headers.length, 5);
  assert.equal(result.summary.documents, headers.length);
  assert.equal(items.length, 6);
  assert.equal(new Set(headers.map((row) => row.DocumentKey)).size, 5);
  assert(headers.every((row) => /^[a-f0-9]{64}$/.test(row.DocumentKey)));
  for (const header of headers) {
    const lines = items.filter((row) => row.DocumentKey === header.DocumentKey);
    assert(lines.length > 0);
    assert.equal(
      lines.reduce((sum, row) => sum + row.WriteoffCost, 0),
      header.WriteoffCost,
    );
    assert(
      lines.every(
        (row) =>
          row.Department === header.Department &&
          row.Store === header.Store &&
          row.Day === header.Day,
      ),
    );
  }
  assert.equal(headers[0].WriteoffCost, 30);
  assert.equal(headers[0].Comment, 'First · Second');
  assert.equal(headers[0].Reason, 'Spoilage');
  assert.equal(
    headers[0].WriteoffQuantity,
    undefined,
    'incompatible units are not summed in header',
  );
  assert.deepEqual(original, snapshot, 'source report is unchanged');
  const reordered = writeoffControl(input, report([...original].reverse()), report([]), report([]));
  assert.deepEqual(reordered.tables.documents.rows, headers);
});

test('cashier ranking sums multiple receipts and keeps namesakes and different branches separate', () => {
  const result = operations([
    discount(),
    discount({ 'UniqOrderId.Id': 'receipt2', DiscountSum: 35 }),
    discount({ 'Cashier.Id': 'other-alice', DiscountSum: 25 }),
    discount({ Department: 'B', DiscountSum: 80 }),
    discount({ 'Cashier.Id': 'bob', Cashier: 'Bob', DiscountSum: 45 }),
  ]);
  const ranked = result.tables.discountCashiers.rows;
  assert.equal(ranked.length, 4);
  assert.deepEqual(
    ranked.map((row) => row.DiscountSum),
    [80, 45, 45, 25],
  );
  assert.deepEqual(
    ranked.map((row) => row.Rank),
    [1, 2, 2, 4],
  );
  const alice = ranked.find((row) => row.Department === 'A' && row['Cashier.Id'] === 'alice');
  assert.equal(alice.CheckCount, 2);
  assert.equal(alice.DiscountSum, 45);
  assert.equal(new Set(ranked.map((row) => row.CashierKey)).size, 4);
  assert.equal(
    ranked.reduce((sum, row) => sum + row.DiscountSum, 0),
    result.summary.discount,
  );
  const checks = result.tables.discounts.rows.filter((row) => row.CashierKey === alice.CashierKey);
  assert.equal(checks.length, 2);
  assert(checks.every((row) => row['Cashier.Id'] === 'alice' && row.Department === 'A'));
  assert.equal(
    checks.reduce((sum, row) => sum + row.DiscountSum, 0),
    alice.DiscountSum,
  );
});

test('shared receipt attributes own cashier rows once, preserves signed corrections and full receipt identity', () => {
  const receiptId = discount()['UniqOrderId.Id'];
  const result = operations([
    discount({ DiscountSum: 40 }),
    discount({ DiscountSum: -5, DishSumInt: -10, AuthUser: 'Other manager' }),
    discount({ 'Cashier.Id': 'bob', Cashier: 'Bob', DiscountSum: 20 }),
    discount({ 'Cashier.Id': 'carol', Cashier: 'Carol', DiscountSum: -3, DishSumInt: -5 }),
  ]);
  assert.equal(result.summary.discount, 52);
  assert.equal(result.summary.discountChecks, 1);
  assert.equal(result.summary.flagged, 1, 'a shared flagged receipt counts once');
  assert.deepEqual(
    result.tables.discounts.rows.map((row) => row.DiscountSum),
    [35, 20, -3],
  );
  assert.equal(new Set(result.tables.discounts.rows.map((row) => row.CheckKey)).size, 1);
  for (const row of result.tables.discounts.rows) {
    assert.equal(row['UniqOrderId.Id'], receiptId);
    assert.equal(row['OpenDate.Typed'], '2026-09-01');
    assert.equal(row.OrderNum, 10);
    assert.match(row.CashierKey, /^[a-f0-9]{64}$/);
  }
  assert.equal(
    result.tables.discountCashiers.rows.reduce((sum, row) => sum + row.DiscountSum, 0),
    52,
  );
  assert.deepEqual(
    result.tables.discountCashiersFlagged.rows.map((row) => [row.Cashier, row.DiscountSum]),
    [['Alice', 35]],
  );
});

test('flagged cashier rank and export include only flagged receipts, exact cashier filter, unknown stays isolated', () => {
  const result = operations([
    discount({ DiscountSum: 50 }),
    discount({ 'UniqOrderId.Id': 'small', DiscountSum: 10 }),
    discount({ 'UniqOrderId.Id': 'bob', 'Cashier.Id': 'bob', Cashier: 'Bob', DiscountSum: 40 }),
    discount({ 'UniqOrderId.Id': 'unknown', 'Cashier.Id': null, Cashier: '', DiscountSum: 5 }),
    discount({ 'UniqOrderId.Id': 'named', 'Cashier.Id': null, Cashier: 'Alice', DiscountSum: 6 }),
  ]);
  const flagged = result.tables.discountCashiersFlagged;
  assert.deepEqual(
    flagged.rows.map((row) => [row.Cashier, row.DiscountSum, row.CheckCount]),
    [
      ['Alice', 50, 1],
      ['Bob', 40, 1],
    ],
  );
  const aliceKey = flagged.rows[0].CashierKey;
  const selected = controlsExport(result.tables.discounts, {
    cashierKey: aliceKey,
    flaggedOnly: true,
  });
  assert.equal(selected.rows.length, 1);
  assert.equal(selected.rows[0].DiscountSum, 50);
  assert.equal(selected.rows[0].Flags, 'Высокая скидка');
  assert.equal(
    controlsExport(result.tables.discounts, { cashierKey: '0'.repeat(64) }).rows.length,
    0,
  );
  assert.equal(
    result.tables.discountCashiers.rows.length,
    4,
    'unknown ID never merges into a known ID by display name',
  );
  assert.equal(controlsExport(flagged, { flaggedOnly: true }).rows.length, 2);
});

test('cashier correction receipts that have no net discount do not create extra ranking credit', () => {
  const result = operations([
    discount({ DiscountSum: 10 }),
    discount({ 'Cashier.Id': 'bob', Cashier: 'Bob', DiscountSum: -10 }),
  ]);
  assert.equal(result.summary.discount, 0);
  assert.equal(result.summary.discountChecks, 0);
  assert.deepEqual(result.tables.discountCashiers.rows, []);
  assert.deepEqual(result.tables.discounts.rows, []);
});

test('export contracts explicitly permit new read-only tables and reject malformed cashier identifiers', () => {
  for (const table of ['documentItems', 'discountCashiers', 'discountCashiersFlagged']) {
    assert(controlsExportQuery.safeParse({ query: input, table }).success);
  }
  assert(
    controlsExportQuery.safeParse({ query: input, table: 'discounts', cashierKey: 'a'.repeat(64) })
      .success,
  );
  for (const cashierKey of ['', 'Alice', 'a'.repeat(65), '<script>', [], 123]) {
    assert(
      !controlsExportQuery.safeParse({ query: input, table: 'discounts', cashierKey }).success,
    );
  }
  assert(
    controlsExportQuery.safeParse({ query: input, table: 'documents', documentDepartment: '' })
      .success,
  );
  assert(
    !controlsExportQuery.safeParse({
      query: input,
      table: 'documents',
      documentDepartment: 'a'.repeat(251),
    }).success,
  );
});

test('document export filters the loaded scope exactly, including missing departments', () => {
  const result = writeoffControl(
    input,
    report([writeoff(), writeoff({ Department: 'B' }), writeoff({ Department: null })]),
    report([]),
    report([]),
  );
  for (const table of ['documents', 'documentItems']) {
    const named = controlsExport(result.tables[table], { documentDepartment: 'A' });
    assert.equal(named.rows.length, 1);
    assert.equal(named.rows[0].Department, 'A');
    const missing = controlsExport(result.tables[table], { documentDepartment: '' });
    assert.equal(missing.rows.length, 1);
    assert.equal(missing.rows[0].Department, null);
    assert.equal(controlsExport(result.tables[table], {}).rows.length, 3);
  }
});

test('document counts normalize missing identity fields exactly like the document drilldown', () => {
  const result = writeoffControl(
    input,
    report([
      writeoff({ Department: null, Store: null, Document: null, 'DateTime.DateTyped': undefined }),
      writeoff({
        Department: '',
        Store: '',
        Document: '',
        'DateTime.DateTyped': '',
        WriteoffCost: -5,
        WriteoffQuantity: -1,
      }),
      writeoff({
        Department: undefined,
        Store: undefined,
        Document: undefined,
        'DateTime.DateTyped': null,
      }),
    ]),
    report([]),
    report([]),
  );
  assert.equal(result.summary.documents, 1);
  assert.equal(result.tables.documents.rows.length, 1);
  assert.equal(result.tables.branches.rows.length, 1);
  assert.equal(result.tables.branches.rows[0].DocumentCount, 1);
  assert.equal(new Set(result.tables.documentItems.rows.map((row) => row.DocumentKey)).size, 1);
});

test('live export router enforces role and validates exact filters before returning filtered XLSX', async (t) => {
  const express = require('express');
  const AdmZip = require('adm-zip');
  const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
  const app = express();
  let calls = 0;
  const data = operations([
    discount({ DiscountSum: 50 }),
    discount({ 'UniqOrderId.Id': 'bob', 'Cashier.Id': 'bob', Cashier: 'Bob', DiscountSum: 40 }),
  ]);
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.get('X-Test-Role') };
    next();
  });
  registerIikoDashboardRoutes(app, {
    controls: async (query) => {
      calls++;
      assert.equal(query.serverId, input.serverId);
      assert.equal(query.from, input.from);
      assert.equal(query.to, input.to);
      assert.equal(query.department, 'A');
      return data;
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/controls/export`;
  const body = {
    query: { ...input, mode: 'operations', department: 'A' },
    table: 'discounts',
    cashierKey: data.tables.discountCashiers.rows[0].CashierKey,
    flaggedOnly: true,
  };
  const post = (role, value) =>
    fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Role': role },
      body: JSON.stringify(value),
    });
  assert.equal((await post('cashier', body)).status, 403);
  assert.equal((await post('owner', { ...body, cashierKey: 'Alice' })).status, 400);
  assert.equal(calls, 0);
  const response = await post('iiko_dashboard', body);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /spreadsheetml.sheet/);
  const workbook = new AdmZip(Buffer.from(await response.arrayBuffer()));
  const sheet = workbook.readAsText('xl/worksheets/sheet1.xml');
  assert.match(sheet, /Alice/);
  assert.doesNotMatch(sheet, /Bob/);
  assert.match(sheet, /Высокая скидка/);
  const ranked = await post('owner', {
    query: body.query,
    table: 'discountCashiersFlagged',
    flaggedOnly: true,
  });
  assert.equal(ranked.status, 200);
  const rankingSheet = new AdmZip(Buffer.from(await ranked.arrayBuffer())).readAsText(
    'xl/worksheets/sheet1.xml',
  );
  assert.match(rankingSheet, /Alice/);
  assert.match(rankingSheet, /Bob/);
  assert.equal(calls, 1, 'exports reuse the same scoped report snapshot');
});

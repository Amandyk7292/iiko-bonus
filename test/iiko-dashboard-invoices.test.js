const test = require('node:test');
const assert = require('node:assert/strict');
const { invoiceReport } = require('../src/services/iiko-dashboard-invoices');
const { loadInvoiceDocuments } = require('../src/services/iiko-dashboard-invoice-documents');
const { invoiceQuery } = require('../src/contracts/iiko-dashboard.contract');

const input = { serverId: 'aktau-chain', from: '2026-09-01', to: '2026-09-13', department: '' };
const supplier = { id: 'cb02da80-9b7e-4546-8015-a9c1b9f7c6db', name: 'Поставщик A' };
const document = (id, changes = {}) => ({
  id,
  incomingDocumentNumber: '000042',
  incomingDate: '2026-09-05T12:00:00+05:00',
  dateIncoming: '2026-09-05T12:00:00+05:00',
  supplier: supplier.id,
  defaultStore: 'store-a',
  status: 'PROCESSED',
  comment: 'Доставка утром',
  items: {
    item: [
      {
        product: 'product-a',
        productArticle: 'A-10',
        amountUnit: 'kg',
        actualAmount: '2.5',
        price: '400',
        vatSum: '120',
        sum: '1000',
      },
    ],
  },
  ...changes,
});
const dataset = (documents) => ({
  suppliers: [supplier],
  documents,
  stores: [
    { id: 'store-a', name: 'Основной склад', parentId: 'branch-a' },
    { id: 'store-b', name: 'Другой склад', parentId: 'branch-b' },
  ],
  departments: [
    { id: 'branch-a', name: 'Филиал A' },
    { id: 'branch-b', name: 'Филиал B' },
  ],
  products: [{ id: 'product-a', name: 'Мука', mainUnit: 'kg' }],
  units: [{ id: 'kg', name: 'кг' }],
});

test('incoming invoice report keeps posted document values and item details', () => {
  const first = document('one');
  const report = invoiceReport(
    dataset([
      first,
      first,
      document('draft', { status: 'NEW' }),
      document('outside', { dateIncoming: '2026-08-31T12:00:00+05:00' }),
    ]),
    input,
  );
  assert.deepEqual(report.summary, { invoices: 1, suppliers: 1, productLines: 1, total: 1000 });
  assert.equal(report.invoices[0].Document, '000042');
  assert.equal(report.invoices[0].Comment, 'Доставка утром');
  assert.equal(report.rows[0].Product, 'Мука');
  assert.equal(report.rows[0].Quantity, 2.5);
  assert.equal(report.rows[0].Price, 400);
  assert.equal(report.rows[0].Vat, 120);
  assert.equal(report.rows[0].Total, 1000);
});

test('department filter keeps only matching stores and does not invent unavailable totals', () => {
  const mixed = document('mixed', {
    items: {
      item: [
        { product: 'product-a', store: 'store-a', amount: '1', sum: '100', vatSum: '12' },
        { product: 'product-a', store: 'store-b', amount: '2', sum: '', vatSum: '' },
      ],
    },
  });
  assert.equal(invoiceReport(dataset([mixed]), input).summary.total, null);
  const scoped = invoiceReport(dataset([mixed]), { ...input, department: 'Филиал A' });
  assert.equal(scoped.summary.total, 100);
  assert.equal(scoped.rows.length, 1);
  assert.equal(scoped.invoices[0].Store, 'Основной склад');
});

test('supplier filter scopes invoices, rows and summary by the exact supplier name', () => {
  const otherSupplier = { id: '15b0f001-d8e7-4e16-9399-1074ada28d68', name: 'Поставщик Б' };
  const data = dataset([
    document('one'),
    document('two', { supplier: otherSupplier.id, incomingDocumentNumber: '000043' }),
  ]);
  data.suppliers.push(otherSupplier);
  const report = invoiceReport(data, { ...input, supplier: otherSupplier.name });
  assert.deepEqual(report.summary, { invoices: 1, suppliers: 1, productLines: 1, total: 1000 });
  assert.equal(report.invoices[0].Document, '000043');
  assert.equal(report.rows[0].Supplier, otherSupplier.name);
});

test('loader requests incoming invoices per active supplier and loads reference data only when needed', async () => {
  const calls = [];
  const request = async (path, _body, format) => {
    calls.push(path);
    if (path === 'suppliers') {
      assert.equal(format, 'xml');
      return {
        employees: {
          employee: [supplier, { id: 'deleted', name: 'Удалён', deleted: 'true' }],
        },
      };
    }
    if (path.startsWith('documents/export/incomingInvoice')) {
      const params = new URLSearchParams(path.split('?')[1]);
      assert.equal(params.get('supplierId'), supplier.id);
      assert.equal(params.get('from'), input.from);
      assert.equal(params.get('to'), input.to);
      return { incomingInvoiceDtoes: { document: document('one') } };
    }
    if (path === 'corporation/stores' || path === 'corporation/departments')
      return { corporateItemDtoes: '' };
    return [];
  };
  const data = await loadInvoiceDocuments(request, input);
  assert.equal(data.documents.length, 1);
  assert.equal(calls.filter((path) => path.startsWith('documents/export/')).length, 1);
});

test('invoice query constrains the server and date range', () => {
  assert(invoiceQuery.safeParse(input).success);
  assert(invoiceQuery.safeParse({ ...input, supplier: 'Поставщик A' }).success);
  assert(!invoiceQuery.safeParse({ ...input, serverId: 'other' }).success);
  assert(!invoiceQuery.safeParse({ ...input, from: '2026-02-30' }).success);
  assert(!invoiceQuery.safeParse({ ...input, supplier: 'x'.repeat(251) }).success);
  assert(!invoiceQuery.safeParse({ ...input, total: 1 }).success);
});

test('invoice routes require an admin, poll safely and export numeric values', async (t) => {
  const express = require('express');
  const AdmZip = require('adm-zip');
  const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.get('X-Test-Role') };
    next();
  });
  const report = invoiceReport(dataset([document('one')]), input);
  registerIikoDashboardRoutes(app, { invoices: async () => report });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const send = (suffix = '', role = 'owner') =>
    fetch(`http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/invoices${suffix}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Role': role },
      body: JSON.stringify(input),
    });
  assert.equal((await send('', 'cashier')).status, 403);
  const first = await send();
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { pending: true });
  assert.equal((await (await send()).json()).summary.total, 1000);
  const exported = await send('/export');
  assert.equal(exported.status, 200);
  const sheet = new AdmZip(Buffer.from(await exported.arrayBuffer())).readAsText(
    'xl/worksheets/sheet1.xml',
  );
  assert(sheet.includes('Поставщик A'));
  assert(sheet.includes('<v>1000</v>'));
});

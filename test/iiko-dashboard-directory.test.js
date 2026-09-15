const test = require('node:test');
const assert = require('node:assert/strict');
const { IikoDashboardService } = require('../src/services/iiko-dashboard.service');
const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
const { barterReport } = require('../src/services/iiko-dashboard-barters');

const source = { id: 'bulka-new-branch', city: 'astana', active: true, configured: true };
const query = { serverId: source.id, from: '2026-09-01', to: '2026-09-15' };
const supplierId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
function fixture() {
  const sources = [{ ...source }];
  const calls = [];
  const request = async (path) => {
    calls.push(path);
    if (path === 'suppliers')
      return { employees: { employee: { id: supplierId, name: 'Бартер', deleted: true } } };
    if (path === 'corporation/departments')
      return {
        corporateItemDtoes: {
          corporateItemDto: [
            { id: 'workshop', name: 'Основной цех' },
            { id: 'old', name: 'Старый филиал', deleted: true },
          ],
        },
      };
    if (path === 'corporation/stores')
      return {
        corporateItemDtoes: {
          corporateItemDto: { id: 'store', name: 'Склад', parentId: 'workshop' },
        },
      };
    if (path.startsWith('documents/export/')) {
      const incoming = path.includes('incomingInvoice');
      return {
        [incoming ? 'incomingInvoiceDtoes' : 'outgoingInvoiceDtoes']: {
          document: {
            id: 'posted-1',
            documentNumber: '0001',
            dateIncoming: '2026-09-02T09:00:00+05:00',
            status: 'PROCESSED',
            supplier: supplierId,
            counteragentId: supplierId,
            defaultStore: 'store',
            defaultStoreId: 'store',
            items: {
              item: {
                product: 'product',
                productId: 'product',
                amount: 1,
                actualAmount: 1,
                sum: 350,
              },
            },
          },
        },
      };
    }
    if (path.startsWith('v2/entities/products/list'))
      return [{ id: 'product', name: 'Товар', mainUnit: 'unit' }];
    if (path.startsWith('v2/entities/list')) return [{ id: 'unit', name: 'шт' }];
    throw new Error(`Unexpected fixture path ${path}`);
  };
  return {
    sources,
    calls,
    service: new IikoDashboardService({
      listServers: async () => sources,
      withSession: async (id, work) => {
        assert.equal(id, source.id);
        return work(request);
      },
    }),
  };
}

test('a dynamically registered server supports incoming invoices and barter reports', async () => {
  const { service } = fixture();
  const invoice = await service.invoices(query);
  assert.equal(invoice.summary.total, 350);
  assert.equal(invoice.invoices[0].Document, '0001');
  const barter = await service.barters(query);
  assert.equal(barter.city, 'astana');
  assert.equal(barter.checks[0].Total, 350);
  assert.throws(() => barterReport({}, query, { ...source, id: 'other' }), {
    code: 'IIKO_REPORT_SERVER',
  });
});

test('document caches do not bypass a removed or disabled registry source', async () => {
  const { service, sources } = fixture();
  await service.invoices(query);
  await service.barters(query);
  sources[0].active = false;
  await assert.rejects(service.invoices(query), { code: 'IIKO_REPORT_CLOSED' });
  await assert.rejects(service.barters(query), { code: 'IIKO_REPORT_CLOSED' });
  sources.length = 0;
  await assert.rejects(service.invoices(query), { code: 'IIKO_REPORT_SERVER' });
});

test('department directory includes workshops and archived branches without querying sales', async () => {
  const { service, calls } = fixture();
  const result = await service.departments({ serverId: source.id });
  assert.deepEqual(result.departments, [
    { id: 'workshop', name: 'Основной цех' },
    { id: 'old', name: 'Старый филиал' },
  ]);
  await service.departments({ serverId: source.id });
  assert.deepEqual(calls, ['corporation/departments']);
});

test('department endpoint requires an administrator and validates the source query', async (t) => {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.get('X-Test-Role') };
    next();
  });
  registerIikoDashboardRoutes(app, fixture().service);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const url = `http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/departments`;
  const send = (params, role = 'owner') =>
    fetch(`${url}?${params}`, { headers: { 'X-Test-Role': role } });
  assert.equal((await send(`serverId=${source.id}`, 'cashier')).status, 403);
  assert.equal((await send('serverId=invalid%20id')).status, 400);
  assert.equal((await send(`serverId=${source.id}&from=2026-09-01`)).status, 400);
  const response = await send(`serverId=${source.id}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal((await response.json()).departments.length, 2);
});

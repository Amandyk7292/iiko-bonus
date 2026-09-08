const test = require('node:test');
const assert = require('node:assert/strict');
const { barterReport, withPeople } = require('../src/services/iiko-dashboard-barters');
const { loadDocuments } = require('../src/services/iiko-dashboard-barter-documents');
const { people, savePerson } = require('../src/services/iiko-dashboard-barter-people');
const { barterQuery, barterPersonMutation } = require('../src/contracts/iiko-dashboard.contract');
const { parseXml } = require('../src/services/iiko-dashboard-xml');
const { IikoDashboardClient } = require('../src/services/iiko-dashboard-client');
const input = { serverId: 'aktau-chain', from: '2026-09-01', to: '2026-09-08', department: '' };
const supplier = { id: 'cb02da80-9b7e-4546-8015-a9c1b9f7c6db', name: 'Бартер' };
const invoice = (id, changes = {}) => ({
  id,
  documentNumber: '0001',
  dateIncoming: '2026-09-02T20:12:47.870+05:00',
  status: 'PROCESSED',
  counteragentId: supplier.id,
  defaultStoreId: 'store',
  items: { item: [{ productId: 'product', amount: '0.339', price: '3000', sum: '1084.80' }] },
  ...changes,
});
const dataset = (documents) => ({
  sources: [supplier],
  documents,
  stores: [
    { id: 'store', parentId: 'branch' },
    { id: 'store2', parentId: 'branch2' },
  ],
  departments: [
    { id: 'branch', name: 'Филиал A' },
    { id: 'branch2', name: 'Филиал B' },
  ],
  products: [{ id: 'product', name: 'Кекс', mainUnit: 'kg' }],
  units: [{ id: 'kg', name: 'кг' }],
});

test('barter uses posted invoice sums once, preserves zero-prefixed numbers and fractional units', () => {
  const first = invoice('one');
  const data = dataset([
    first,
    first,
    invoice('two'),
    invoice('draft', { status: 'NEW' }),
    invoice('other', { counteragentId: 'another' }),
    invoice('outside', { dateIncoming: '2026-08-31T20:00:00+05:00' }),
  ]);
  const r = withPeople(barterReport(data, input));
  assert.equal(r.summary.checks, 2);
  assert.equal(r.summary.total, 2169.6); // XML sum is not current price * amount (1017).
  assert.equal(r.checks[0].Document, '0001');
  assert.equal(r.rows[0].Quantity, 0.339);
  assert.equal(r.rows[0].Unit, 'кг');
  assert.notEqual(r.checks[0].identity, r.checks[1].identity);
  assert.equal(r.summary.bloggers, 0);
  assert.equal(r.summary.unnamed, 2);
});
test('same invoice identity survives date/branch filters and Chain/RMS selection; cities stay isolated', () => {
  const data = dataset([invoice('one')]);
  const a = barterReport(data, input).checks[0];
  const b = barterReport(data, {
    ...input,
    serverId: 'bulka-17-mkr-55-dom',
    department: 'Филиал A',
  }).checks[0];
  assert.equal(a.identity, b.identity);
  assert.notEqual(
    a.identity,
    barterReport(data, { ...input, serverId: 'astana-chain' }).checks[0].identity,
  );
  assert.equal(barterReport(data, { ...input, department: 'Филиал B' }).checks.length, 0);
});
test('missing amounts remain unavailable, and per-branch reports include only that branch goods', () => {
  const data = dataset([
    invoice('one', {
      items: {
        item: [
          { productId: 'product', storeId: 'store', amount: '1', sum: '100' },
          { productId: 'product', storeId: 'store2', amount: '2', sum: '' },
        ],
      },
    }),
  ]);
  assert.equal(withPeople(barterReport(data, input)).summary.total, null);
  const scoped = withPeople(barterReport(data, { ...input, department: 'Филиал A' }));
  assert.equal(scoped.summary.total, 100);
  assert.equal(scoped.rows.length, 1);
});
test('explicit blogger assignments group invoices without identifying the cashier as a blogger', () => {
  const report = barterReport(dataset([invoice('one'), invoice('two'), invoice('three')]), input);
  const named = withPeople(
    report,
    report.checks
      .slice(0, 2)
      .map((row, i) => ({ document_key: row.identity, blogger_name: i ? '@BLOGGER' : '@blogger' })),
  );
  assert.equal(named.summary.bloggers, 1);
  assert.equal(named.summary.unnamed, 1);
  assert.equal(named.bloggers.find((row) => row.Blogger).Checks, 2);
  assert.equal(named.summary.total, 3254.4);
  assert(report.checks.every((row) => row.Blogger === ''));
});
test('XML parsing preserves invoice numbers and text; rejects DTDs, malformed responses and entities', () => {
  assert.equal(
    parseXml('<root><number>0001</number><name>A &amp; B</name></root>').root.number,
    '0001',
  );
  assert.equal(parseXml('<root><name>A &amp; B</name></root>').root.name, 'A & B');
  for (const xml of ['<root>', '<!DOCTYPE root [<!ENTITY x "boom">]><root>&x;</root>', '[]'])
    assert.throws(() => parseXml(xml), { code: 'IIKO_REPORT_RESPONSE' });
});
test('client requests XML only when explicitly selected, without exposing tokenized failures', async () => {
  const client = new IikoDashboardClient({
    fetchImpl: async (_url, options) => {
      assert.equal(options.headers.Accept, 'application/xml');
      return { ok: true, text: async () => '<root><id>0001</id></root>' };
    },
  });
  assert.equal(
    (await client.request({ host: 'example.test' }, 'suppliers', 'secret', null, null, 'xml')).root
      .id,
    '0001',
  );
});
test('document loader filters suppliers on the server, includes both barter names, and checks response roots', async () => {
  const calls = [];
  const request = async (path, _body, format) => {
    calls.push(path);
    if (path === 'suppliers') {
      assert.equal(format, 'xml');
      return {
        employees: {
          employee: [
            supplier,
            { id: 'd57bf114-d3a9-4458-8378-ff5f14a213b8', name: 'Блогер' },
            { id: 'ordinary', name: 'Поставщик' },
          ],
        },
      };
    }
    if (path.startsWith('documents/')) {
      const params = new URLSearchParams(path.split('?')[1]);
      assert(params.has('supplierId'));
      assert.equal(params.get('from'), input.from);
      assert.equal(params.get('to'), input.to);
      return { outgoingInvoiceDtoes: { document: invoice('one') } };
    }
    if (path.startsWith('corporation/')) return { corporateItemDtoes: '' };
    return [];
  };
  const data = await loadDocuments(request, input);
  assert.equal(data.sources.length, 2);
  assert.equal(calls.filter((path) => path.startsWith('documents/')).length, 2);
  await assert.rejects(() => loadDocuments(async () => ({}), input), {
    code: 'IIKO_REPORT_RESPONSE',
  });
});
test('query validation constrains scope and names without accepting client-supplied totals', () => {
  assert(barterQuery.safeParse(input).success);
  for (const change of [
    { from: '2026-02-30' },
    { from: '2026-09-09' },
    { serverId: 'other' },
    { source: 'payment' },
  ])
    assert(!barterQuery.safeParse({ ...input, ...change }).success);
  const valid = { query: input, documentKey: 'a'.repeat(64), bloggerName: ' @blogger ' };
  assert.equal(barterPersonMutation.parse(valid).bloggerName, '@blogger');
  for (const change of [
    { documentKey: '0001' },
    { bloggerName: 'a'.repeat(161) },
    { bloggerName: 'a\nb' },
    { total: 100 },
  ])
    assert(!barterPersonMutation.safeParse({ ...valid, ...change }).success);
});
test('name storage verifies an existing scoped invoice and surfaces database failures', async () => {
  const report = barterReport(dataset([invoice('one')]), input);
  const mutation = { documentKey: report.checks[0].identity, bloggerName: '@name' };
  let stored;
  const db = {
    from: () => ({
      upsert: async (row) => {
        stored = row;
        return {};
      },
    }),
  };
  assert.deepEqual(await savePerson(report, mutation, 'owner-1', db), { saved: true });
  assert.equal(stored.blogger_name, '@name');
  assert.equal(stored.updated_by, 'owner-1');
  assert.equal(stored.city, 'aktau');
  assert(!Object.hasOwn(stored, 'total'));
  await assert.rejects(
    () => savePerson(report, { ...mutation, documentKey: 'b'.repeat(64) }, 'owner', db),
    { code: 'IIKO_REPORT_DOCUMENT' },
  );
  const failed = {
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ error: new Error('database') }) }) }),
    }),
  };
  await assert.rejects(() => people(report, failed), { code: 'IIKO_REPORT_PEOPLE' });
});
test('barter routes protect read/write/export and refresh names even while invoice data is cached', async (t) => {
  const express = require('express');
  const { registerIikoDashboardRoutes } = require('../src/routes/admin/iiko-dashboard.routes');
  const { reportWorkbook } = require('../src/services/iiko-dashboard-export');
  const AdmZip = require('adm-zip');
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { role: req.get('X-Test-Role'), sub: 'owner' };
    next();
  });
  const report = barterReport(dataset([invoice('one')]), input);
  let name = '',
    calls = 0;
  registerIikoDashboardRoutes(app, {
    barters: async () => {
      calls++;
      return report;
    },
    barterPeople: async (r) =>
      withPeople(r, [{ document_key: r.checks[0].identity, blogger_name: name }]),
    saveBarterPerson: async (_r, body) => {
      name = body.bloggerName;
      return { saved: true };
    },
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const send = (suffix = '', body = input, role = 'owner') =>
    fetch(`http://127.0.0.1:${server.address().port}/admin/api/iiko-dashboard/barters${suffix}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Test-Role': role },
      body: JSON.stringify(body),
    });
  for (const suffix of ['', '/export', '/person'])
    assert.equal((await send(suffix, input, 'cashier')).status, 403);
  assert.equal((await send('', { ...input, from: 'invalid' })).status, 400);
  const first = await send();
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await first.json(), { pending: true });
  assert.equal((await (await send()).json()).summary.unnamed, 1);
  assert.equal(
    (
      await send('/person', {
        query: input,
        documentKey: report.checks[0].identity,
        bloggerName: '=example',
      })
    ).status,
    200,
  );
  assert.equal((await (await send()).json()).checks[0].Blogger, '=example');
  assert.equal(calls, 1);
  const exported = await send('/export');
  assert.equal(exported.status, 200);
  const sheet = new AdmZip(Buffer.from(await exported.arrayBuffer())).readAsText(
    'xl/worksheets/sheet1.xml',
  );
  assert(sheet.includes('=example'));
  assert(!sheet.includes('<f>'));
  assert(sheet.includes('<v>1084.8</v>'));
  assert(reportWorkbook(withPeople(report)).length > 0);
});

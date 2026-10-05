const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const AdmZip = require('adm-zip');
const { XMLParser } = require('fast-xml-parser');
const { cashierPayroll } = require('../src/services/cashier-payroll.service');
const { createAdminSession } = require('../src/services/admin-session.service');
const { signAdminToken, signCustomerToken } = require('../src/services/auth.service');
const app = require('../src/app');
const parser = new XMLParser({ ignoreAttributes: false });
const path = '/admin/api/bonus/cashier-payroll/export';
const fixture = (overrides = {}) => ({
  id: '101',
  name: 'Алия Кассир',
  city: 'Актау',
  branchName: 'Точка 10',
  pointId: '10',
  completed: 2,
  rewardAmount: 600,
  paidAmount: 300,
  outstandingAmount: 300,
  isArchived: false,
  payments: [
    {
      id: 'payment-101',
      registrations: 1,
      amount: 300,
      paidAt: '2026-10-05T05:00:00Z',
      paidBy: 'payroll-admin',
    },
  ],
  ...overrides,
});
async function sessionFor(role, branchIds = []) {
  const jti = randomUUID();
  const username = `cashier-payroll-export-${role}`;
  await createAdminSession({
    jti,
    subject: username,
    role,
    branchIds,
    expiresAt: new Date(Date.now() + 60000),
  });
  return signAdminToken({ username, role, branchIds }, { jti });
}
function workbookRows(buffer, sheet = 'sheet1') {
  const zip = new AdmZip(buffer);
  const parsed = parser.parse(zip.readAsText(`xl/worksheets/${sheet}.xml`)).worksheet.sheetData.row;
  return Array.isArray(parsed) ? parsed : [parsed];
}
const cellText = (cell) => String(cell.is.t['#text'] ?? cell.is.t);

test('production export route protects access, returns XLSX and applies exact city/point/search filters within server branch scope', async (t) => {
  const calls = [];
  const items = [
    fixture(),
    fixture({
      id: '102',
      name: 'Алия Другой',
      pointId: '11',
      branchName: 'Точка 11',
      payments: [],
    }),
    fixture({ id: '103', name: 'Алия Астана', city: 'Астана', payments: [] }),
    fixture({
      id: '104',
      name: 'Без назначения',
      pointId: null,
      branchName: 'Не назначена',
      payments: [],
    }),
  ];
  t.mock.method(cashierPayroll, 'statement', async (args) => {
    calls.push(args);
    return { month: args.month, items };
  });
  t.mock.method(cashierPayroll, 'markPaid', async () => {
    assert.fail('Export must never mark payroll paid');
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (query, token, headers = {}) =>
    fetch(`${base}${path}${query}`, {
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    });

  assert.equal((await request('?month=2026-10')).status, 401);
  assert.equal(
    (await request('?month=2026-10', signCustomerToken({ id: 'customer', phone: '+77001234567' })))
      .status,
    401,
  );
  assert.equal((await request('?month=2026-10', await sessionFor('cashier'))).status, 403);
  assert.equal(calls.length, 0);
  const owner = await sessionFor('owner');
  const all = await request('?month=2026-10', owner);
  assert.equal(all.status, 200);
  assert.equal(all.headers.get('cache-control'), 'no-store');
  assert.equal(
    all.headers.get('content-type'),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.equal(
    all.headers.get('content-disposition'),
    'attachment; filename="bulka-premii-2026-10.xlsx"',
  );
  assert.deepEqual(calls.at(-1), { month: '2026-10', branches: [] });
  const bytes = Buffer.from(await all.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.equal(workbookRows(bytes).length, 6);
  assert.equal(new AdmZip(bytes).getEntry('xl/worksheets/sheet2.xml') !== null, true);

  const query = new URLSearchParams({
    month: '2026-10',
    city: ' Актау ',
    pointId: '10',
    search: ' АЛИЯ ',
  });
  const filtered = await request(`?${query}`, owner);
  assert.equal(filtered.status, 200);
  const filteredBytes = Buffer.from(await filtered.arrayBuffer());
  const rows = workbookRows(filteredBytes);
  assert.equal(rows.length, 3);
  assert.equal(cellText(rows[1].c[0]), '101');
  assert.equal(cellText(rows[1].c[1]), 'Алия Кассир');
  assert.equal(rows[2].c[5].v, 600);
  assert.equal(rows[2].c[7].v, 300);
  const history = workbookRows(filteredBytes, 'sheet2');
  assert.equal(history.length, 2);
  assert.equal(cellText(history[1].c[0]), '101');
  assert.deepEqual(
    calls.at(-1),
    { month: '2026-10', branches: [] },
    'Only trusted scope and month are passed to the SQL statement',
  );

  const withoutPoint = await request('?month=2026-10&city=Актау&pointId=__unassigned__', owner);
  assert.equal(withoutPoint.status, 200);
  assert.equal(cellText(workbookRows(Buffer.from(await withoutPoint.arrayBuffer()))[1].c[0]), '104');
  const empty = await request('?month=2026-10&city=Астана&pointId=11', owner);
  assert.equal(empty.status, 200);
  const emptyRows = workbookRows(Buffer.from(await empty.arrayBuffer()));
  assert.equal(emptyRows.length, 2);
  assert.equal(emptyRows[1].c[5].v, 0);

  const branch = randomUUID();
  const marketer = await sessionFor('marketer', [branch]);
  const scoped = await request('?month=2026-10&city=Актау&pointId=10&search=101', marketer);
  assert.equal(scoped.status, 200);
  await scoped.arrayBuffer();
  assert.deepEqual(calls.at(-1), { month: '2026-10', branches: [branch] });
  const beforeDenied = calls.length;
  assert.equal(
    (await request('?month=2026-10', marketer, { 'X-Bulka-Branch-Id': randomUUID() })).status,
    403,
  );
  assert.equal(calls.length, beforeDenied);
  const selected = await request('?month=2026-10', owner, { 'X-Bulka-Branch-Id': branch });
  assert.equal(selected.status, 200);
  await selected.arrayBuffer();
  assert.deepEqual(calls.at(-1).branches, [branch]);

  const beforeInvalid = calls.length;
  for (const invalid of [
    '',
    '?month=2026-13',
    '?month=0000-01',
    '?month[]=2026-10',
    '?month=2026-10&branchIds=forged',
    '?month=2026-10&city[]=Актау',
    '?month=2026-10&city=' + 'а'.repeat(121),
    '?month=2026-10&pointId=not-a-point',
    '?month=2026-10&pointId[]=10',
    '?month=2026-10&search=' + 'а'.repeat(101),
    '?month=2026-10&search[]=Алия',
    '?month=2026-10&paidBy=forged',
  ]) {
    assert.equal((await request(invalid, owner)).status, 400, invalid);
  }
  assert.equal(calls.length, beforeInvalid);
  t.mock.method(cashierPayroll, 'statement', async () => {
    throw new Error('private payroll database error');
  });
  const failed = await request('?month=2026-10', owner);
  assert.equal(failed.status, 500);
  assert.equal((await failed.text()).includes('private payroll database'), false);
});

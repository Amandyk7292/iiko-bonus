const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { cashierSignup } = require('../src/services/cashier-signup.service');
const { createAdminSession } = require('../src/services/admin-session.service');
const { signAdminToken, signCustomerToken } = require('../src/services/auth.service');
const { publicError } = require('../src/utils/app-error.util');
const app = require('../src/app');
const token = 'a'.repeat(64);
async function tokenFor(role, branchIds = []) {
  const jti = randomUUID();
  const username = `cashier-race-test-${role}`;
  await createAdminSession({
    jti,
    subject: username,
    role,
    branchIds,
    expiresAt: new Date(Date.now() + 60000),
  });
  return signAdminToken({ username, role, branchIds }, { jti });
}
test('production router serves the public portal/QR and enforces schema, sessions, roles and scope', async (t) => {
  const item = {
    id: '123',
    name: 'Алия Кассир',
    branchName: 'Точка',
    city: 'Актау',
    inviteToken: token,
    url: `https://bulka.com.kz/cashier-register?cashier=${token}`,
  };
  const calls = [];
  for (const [method, result] of [
    ['list', { items: [item], cities: ['Актау'] }],
    [
      'invitation',
      {
        cashier: { name: item.name, branchName: item.branchName, city: item.city },
        inviteToken: token,
      },
    ],
    ['resolve', { id: '123', isActive: true }],
    ['ranking', { items: [], totals: { completed: 0, rewardAmount: 0 } }],
  ]) {
    t.mock.method(cashierSignup, method, async (...args) => {
      calls.push({ method, args });
      return result;
    });
  }
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, adminToken) =>
    fetch(base + path, { headers: adminToken ? { Authorization: `Bearer ${adminToken}` } : {} });
  const list = await request('/api/public/cashier-invites?city=Актау&search=Алия');
  assert.equal(list.status, 200);
  assert.equal(list.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await list.json(), { success: true, items: [item], cities: ['Актау'] });
  assert.deepEqual(calls[0].args[0], { city: 'Актау', search: 'Алия' });
  assert.equal((await request(`/api/public/cashier-invites/${token}`)).status, 200);
  const qr = await request(`/api/public/cashier-invites/${token}/qr`);
  assert.equal(qr.status, 200);
  assert.equal(qr.headers.get('content-type'), 'image/png');
  assert.equal(qr.headers.get('cache-control'), 'no-store');
  assert.ok(qr.headers.get('content-disposition').includes('attachment'));
  const beforeInvalid = calls.length;
  for (const path of [
    '/api/public/cashier-invites/bad',
    '/api/public/cashier-invites?city[]=Актау',
    '/api/public/cashier-invites?branchId=other',
  ]) {
    assert.equal((await request(path)).status, 400);
  }
  assert.equal(calls.length, beforeInvalid);
  for (const path of ['/cashier-qr', '/cashier-qr/']) {
    const portal = await request(path);
    assert.equal(portal.status, 200);
    assert.equal(portal.headers.get('cache-control'), 'no-store');
    assert.match(portal.headers.get('content-security-policy'), /script-src 'self'/);
    assert.ok((await portal.text()).includes('/cashier-qr-assets/app.mjs'));
  }
  const script = await request('/cashier-qr-assets/app.mjs');
  assert.equal(script.status, 200);
  assert.equal(script.headers.get('cache-control'), 'no-store');
  const report = '/admin/api/bonus/cashier-race?from=2026-10-01&to=2026-10-03';
  assert.equal((await request(report)).status, 401);
  assert.equal(
    (await request(report, signCustomerToken({ id: 'customer', phone: '+77001234567' }))).status,
    401,
  );
  for (const role of ['owner', 'admin', 'editor', 'marketer']) {
    assert.equal((await request(report, await tokenFor(role))).status, 200, role);
  }
  for (const role of [
    'viewer',
    'cashier',
    'operator',
    'branch_manager',
    'courier',
    'franchisee',
    'whatsapp_operator',
    'iiko_dashboard',
  ]) {
    assert.equal((await request(report, await tokenFor(role))).status, 403, role);
  }
  const branch = randomUUID();
  assert.equal((await request(report, await tokenFor('marketer', [branch]))).status, 200);
  assert.deepEqual(calls.at(-1).args[0].branches, [branch]);
  const owner = await tokenFor('owner');
  assert.equal((await request(report + '&branchIds=forged', owner)).status, 400);
  t.mock.method(cashierSignup, 'list', async () => {
    throw publicError(
      503,
      'STAFF_DIRECTORY_UNAVAILABLE',
      'Список сотрудников временно недоступен.',
    );
  });
  const unavailable = await request('/api/public/cashier-invites');
  assert.equal(unavailable.status, 503);
  assert.equal((await unavailable.json()).code, 'STAFF_DIRECTORY_UNAVAILABLE');
});

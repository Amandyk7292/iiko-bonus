const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  createCashierDirectoryStatus,
  cashierDirectoryStatus,
  publicStatus,
} = require('../src/services/cashier-directory-status.service');
const { cashierSignup } = require('../src/services/cashier-signup.service');
const { createAdminSession } = require('../src/services/admin-session.service');
const { signAdminToken, signCustomerToken } = require('../src/services/auth.service');
const app = require('../src/app');
const good = {
  state: 'ok',
  lastAttemptAt: '2026-10-05T11:00:00+05:00',
  lastSuccessAt: '2026-10-05T11:00:01+05:00',
  lastFailureAt: null,
  failureSince: null,
  consecutiveFailures: 0,
  cashierCount: 0,
};

test('status reader strips all internal fields, keeps successful zero and never calls a source/sync RPC', async () => {
  const calls = [];
  const service = createCashierDirectoryStatus({
    db: {
      async rpc(name, args) {
        calls.push({ name, args });
        return {
          data: { ...good, internalError: 'private details', sourceConfig: 'private setting' },
        };
      },
    },
  });
  const result = await service.getStatus();
  assert.equal(result.cashierCount, 0);
  assert.equal(result.lastSuccessAt, '2026-10-05T06:00:01.000Z');
  assert.deepEqual(Object.keys(result).sort(), Object.keys(good).sort());
  assert.deepEqual(calls, [{ name: 'get_cashier_directory_sync_status', args: {} }]);
  for (const value of [
    null,
    { ...good, state: 'unknown' },
    { ...good, cashierCount: -1 },
    { ...good, consecutiveFailures: '1' },
    { ...good, lastSuccessAt: 'not-date' },
  ]) {
    assert.throws(() => publicStatus(value), { code: 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE' });
  }
});

test('status DB errors never expose their raw text or source configuration', async () => {
  for (const rpc of [
    async () => ({ error: new Error('private failure detail') }),
    async () => {
      throw new Error('private failure detail');
    },
  ]) {
    await assert.rejects(createCashierDirectoryStatus({ db: { rpc } }).getStatus(), {
      code: 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE',
      message: 'Статус синхронизации недоступен.',
    });
  }
});

async function tokenFor(role, branchIds = []) {
  const jti = randomUUID();
  const username = `cashier-status-test-${role}`;
  await createAdminSession({
    jti,
    subject: username,
    role,
    branchIds,
    expiresAt: new Date(Date.now() + 60000),
  });
  return signAdminToken({ username, role, branchIds }, { jti });
}
test('production health route is authenticated, read-only, no-store and hides the global count from restricted roles', async (t) => {
  let reads = 0;
  t.mock.method(cashierDirectoryStatus, 'getStatus', async () => {
    reads++;
    return { ...good, cashierCount: 71 };
  });
  t.mock.method(cashierSignup, 'sync', async () => {
    assert.fail('A health read must not start a source sync');
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/admin/api/bonus/cashier-directory-status`;
  const request = (token) =>
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  assert.equal((await request()).status, 401);
  assert.equal(
    (await request(signCustomerToken({ id: 'customer', phone: '+77001234567' }))).status,
    401,
  );
  assert.equal(reads, 0);
  for (const role of ['owner', 'admin', 'editor', 'marketer']) {
    const response = await request(await tokenFor(role));
    assert.equal(response.status, 200, role);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const result = await response.json();
    assert.equal(result.success, true);
    assert.equal(result.status.cashierCount, ['owner', 'admin'].includes(role) ? 71 : null);
    assert.deepEqual(Object.keys(result.status).sort(), Object.keys(good).sort());
  }
  const allowedReads = reads;
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
    assert.equal((await request(await tokenFor(role))).status, 403, role);
  }
  assert.equal(reads, allowedReads);
  t.mock.method(cashierDirectoryStatus, 'getStatus', async () => {
    throw new Error('private source failure');
  });
  const failed = await request(await tokenFor('owner'));
  assert.equal(failed.status, 503);
  const body = await failed.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE');
  assert.match(body.error, /Статус синхронизации недоступен|Не удалось выполнить действие/);
  assert.ok(!JSON.stringify(body).includes('private source failure'));
});

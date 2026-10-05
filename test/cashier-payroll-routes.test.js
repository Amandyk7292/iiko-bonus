const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { cashierPayroll } = require('../src/services/cashier-payroll.service');
const { createAdminSession } = require('../src/services/admin-session.service');
const { signAdminToken, signCustomerToken } = require('../src/services/auth.service');
const { conflict } = require('../src/utils/app-error.util');
const app = require('../src/app');

const statementPath = '/admin/api/bonus/cashier-payroll?month=2026-10';
const paymentPath = '/admin/api/bonus/cashier-payroll/payments';
const body = {
  month: '2026-10',
  rowKey: 'a'.repeat(64),
  snapshot: 'b'.repeat(64),
  idempotencyKey: randomUUID(),
};
async function sessionFor(role, branchIds = []) {
  const jti = randomUUID();
  const username = `cashier-payroll-test-${role}`;
  await createAdminSession({
    jti,
    subject: username,
    role,
    branchIds,
    expiresAt: new Date(Date.now() + 60000),
  });
  return signAdminToken({ username, role, branchIds }, { jti });
}

test('production payroll routes enforce bonus/session permissions, strict contracts and server actor/selected scope', async (t) => {
  const calls = [];
  t.mock.method(cashierPayroll, 'statement', async (args) => {
    calls.push({ method: 'statement', args });
    return {
      month: args.month,
      items: [],
      totals: { completed: 0, rewardAmount: 0, paidAmount: 0, outstandingAmount: 0 },
    };
  });
  t.mock.method(cashierPayroll, 'markPaid', async (args) => {
    calls.push({ method: 'markPaid', args });
    return {
      payment: {
        id: randomUUID(),
        amount: 300,
        registrations: 1,
        paidAt: '2026-10-05T10:00:00Z',
        paidBy: args.actor,
      },
      replayed: false,
    };
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (path, token, options = {}) =>
    fetch(base + path, {
      ...options,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      },
    });
  const post = (token, data = body, headers = {}, path = paymentPath) =>
    request(path, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(data),
    });
  assert.equal((await request(statementPath)).status, 401);
  assert.equal((await post()).status, 401);
  assert.equal(
    (await request(statementPath, signCustomerToken({ id: 'customer', phone: '+77001234567' })))
      .status,
    401,
  );
  const tokens = new Map();
  for (const role of ['owner', 'admin', 'editor', 'marketer']) {
    const token = await sessionFor(role);
    tokens.set(role, token);
    const result = await request(statementPath, token);
    assert.equal(result.status, 200, role);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await result.json()).canMarkPaid, ['owner', 'admin'].includes(role));
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
    const token = await sessionFor(role);
    assert.equal((await request(statementPath, token)).status, 403, role);
    assert.equal((await post(token)).status, 403, role);
  }
  const beforeForbidden = calls.length;
  assert.equal((await post(tokens.get('editor'))).status, 403);
  assert.equal((await post(tokens.get('marketer'))).status, 403);
  assert.equal(calls.length, beforeForbidden);
  for (const role of ['owner', 'admin']) {
    const result = await post(tokens.get(role));
    assert.equal(result.status, 200, role);
    assert.equal(result.headers.get('cache-control'), 'no-store');
    assert.equal((await result.json()).payment.paidBy, `cashier-payroll-test-${role}`);
    assert.deepEqual(calls.at(-1).args, {
      ...body,
      actor: `cashier-payroll-test-${role}`,
      branches: [],
    });
  }
  const branch = randomUUID();
  assert.equal(
    (await post(tokens.get('owner'), body, { 'X-Bulka-Branch-Id': branch })).status,
    200,
  );
  assert.deepEqual(calls.at(-1).args.branches, [branch]);
  assert.equal(
    (
      await request(statementPath, tokens.get('owner'), {
        headers: { 'X-Bulka-Branch-Id': branch },
      })
    ).status,
    200,
  );
  assert.deepEqual(calls.at(-1).args.branches, [branch]);
  const scoped = await sessionFor('marketer', [branch]);
  assert.equal((await request(statementPath, scoped)).status, 200);
  assert.deepEqual(calls.at(-1).args.branches, [branch]);
  assert.equal(
    (await request(statementPath, scoped, { headers: { 'X-Bulka-Branch-Id': randomUUID() } }))
      .status,
    403,
  );
  const beforeInvalid = calls.length;
  for (const path of [
    '/admin/api/bonus/cashier-payroll',
    '/admin/api/bonus/cashier-payroll?month=2026-13',
    '/admin/api/bonus/cashier-payroll?month[]=2026-10',
    statementPath + '&branchIds=forged',
  ]) {
    assert.equal((await request(path, tokens.get('owner'))).status, 400);
  }
  for (const extra of [
    { paidBy: 'forged' },
    { actor: 'forged' },
    { amount: 900 },
    { registrations: 3 },
    { branchIds: [randomUUID()] },
    { month: '2026-00' },
    { snapshot: null },
    { rowKey: 'invalid' },
    { idempotencyKey: '123' },
  ]) {
    assert.equal((await post(tokens.get('owner'), { ...body, ...extra })).status, 400);
  }
  assert.equal(
    (await post(tokens.get('owner'), body, {}, paymentPath + '?actor=forged')).status,
    400,
  );
  assert.equal(calls.length, beforeInvalid);
  t.mock.method(cashierPayroll, 'markPaid', async () => {
    throw conflict('CASHIER_PAYROLL_SNAPSHOT_CHANGED', 'Начисления изменились.');
  });
  const stale = await post(tokens.get('owner'));
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).code, 'CASHIER_PAYROLL_SNAPSHOT_CHANGED');
  t.mock.method(cashierPayroll, 'statement', async () => {
    throw Object.assign(new Error('private database payroll detail'), { code: 'XX000' });
  });
  const unavailable = await request(statementPath, tokens.get('owner'));
  assert.equal(unavailable.status, 500);
  const failure = await unavailable.json();
  assert.ok(failure.error);
  assert.equal(JSON.stringify(failure).includes('private database'), false);
});

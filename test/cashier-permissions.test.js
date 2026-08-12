const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  ADMIN_ROLES,
  ROLE_AREAS,
  adminMutationRoleMiddleware,
} = require('../src/middlewares/auth.middleware');
const { applyAdminBranchSelection, branchScopeForAdmin } = require('../src/utils/admin-scope.util');

const BRANCH_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ORDER_ID = '33333333-3333-4333-8333-333333333333';

const runMutationGuard = ({ method, path, body = {} }) => {
  let nextCalled = false;
  let responseStatus = 200;
  let responseBody = null;
  const req = {
    method,
    path,
    body,
    params: {},
    query: {},
    admin: { role: 'cashier', branchIds: [BRANCH_ID] },
  };
  const res = {
    status(value) {
      responseStatus = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };
  adminMutationRoleMiddleware(req, res, () => {
    nextCalled = true;
  });
  return { nextCalled, responseStatus, responseBody };
};

test('cashier role is limited to branch-scoped orders, kitchen and own push binding', () => {
  assert.equal(ADMIN_ROLES.has('cashier'), true);
  assert.deepEqual(
    [...ROLE_AREAS.cashier],
    ['session', 'scope', 'events', 'orders', 'kitchen', 'staff'],
  );
  assert.deepEqual(branchScopeForAdmin({ role: 'cashier', branchIds: [BRANCH_ID] }), [BRANCH_ID]);
  assert.throws(
    () => applyAdminBranchSelection({ role: 'cashier', branchIds: [BRANCH_ID] }, OTHER_BRANCH_ID),
    /Филиал не входит/,
  );
});

test('cashier may mutate only own staff push token and test endpoints', () => {
  for (const request of [
    { method: 'POST', path: '/staff/push-token' },
    { method: 'DELETE', path: '/staff/push-token' },
    { method: 'POST', path: '/staff/push-test' },
  ]) {
    assert.equal(runMutationGuard(request).nextCalled, true);
  }
  for (const request of [
    { method: 'PUT', path: '/staff/push-token' },
    { method: 'DELETE', path: '/staff/push-test' },
    { method: 'POST', path: '/staff/credentials' },
  ]) {
    const result = runMutationGuard(request);
    assert.equal(result.nextCalled, false);
    assert.equal(result.responseBody.code, 'CASHIER_ACTION_FORBIDDEN');
  }
});

test('cashier can use kitchen workflow but cannot bypass it through generic orders', () => {
  assert.equal(
    runMutationGuard({
      method: 'PATCH',
      path: `/kitchen/${ORDER_ID}/status`,
      body: { status: 'ready' },
    }).nextCalled,
    true,
  );

  for (const request of [
    { method: 'PATCH', path: `/orders/${ORDER_ID}/status`, body: { status: 'accepted' } },
    { method: 'PATCH', path: `/orders/${ORDER_ID}/status`, body: { status: 'preparing' } },
    { method: 'PATCH', path: `/orders/${ORDER_ID}/status`, body: { status: 'ready' } },
    { method: 'PATCH', path: `/orders/${ORDER_ID}/status`, body: { status: 'completed' } },
    { method: 'PATCH', path: `/orders/${ORDER_ID}/status`, body: { status: 'cancelled' } },
    { method: 'PATCH', path: `/kitchen/${ORDER_ID}/status`, body: { status: 'cancelled' } },
    { method: 'PATCH', path: `/orders/${ORDER_ID}/courier`, body: { courierId: ORDER_ID } },
    { method: 'PATCH', path: `/orders/${ORDER_ID}/delivery-status`, body: { status: 'assigned' } },
  ]) {
    const result = runMutationGuard(request);
    assert.equal(result.nextCalled, false);
    assert.equal(result.responseStatus, 403);
    assert.equal(result.responseBody.code, 'CASHIER_ACTION_FORBIDDEN');
  }
});

test('cashier credential RPCs are executable only by the service role', () => {
  const migration = fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'migrations', '20260807170000_cashier_credentials.sql'),
    'utf8',
  );
  for (const functionName of [
    'get_cashier_auth_record',
    'create_cashier_access',
    'reset_cashier_password',
    'update_cashier_access',
  ]) {
    assert.match(
      migration,
      new RegExp(
        `revoke all on function public\\.${functionName}\\([\\s\\S]*?from public, anon, authenticated;`,
        'i',
      ),
    );
    assert.match(
      migration,
      new RegExp(
        `grant execute on function public\\.${functionName}\\([\\s\\S]*?to service_role;`,
        'i',
      ),
    );
  }
});

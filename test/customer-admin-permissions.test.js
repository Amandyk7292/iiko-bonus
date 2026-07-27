const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CUSTOMER_ACTIONS,
  actionsForRole,
  hasAdminAction,
  requireAdminAction,
} = require('../src/middlewares/auth.middleware');
const {
  manualBonusLimitForAdmin,
  normalizeManualBonusReason,
} = require('../src/controllers/admin.controller');

test('customer action matrix follows least privilege', () => {
  for (const role of ['owner', 'admin']) {
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.DELETE), true);
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.UPDATE), true);
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.BULK_EXPIRE), true);
  }

  assert.equal(
    hasAdminAction({ role: 'branch_manager' }, CUSTOMER_ACTIONS.ADJUST_BONUS),
    true,
  );
  assert.equal(hasAdminAction({ role: 'marketer' }, CUSTOMER_ACTIONS.ADJUST_BONUS), false);
  assert.equal(hasAdminAction({ role: 'operator' }, CUSTOMER_ACTIONS.ADJUST_BONUS), false);

  for (const role of ['branch_manager', 'operator', 'marketer', 'editor', 'viewer']) {
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.READ), true);
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.UPDATE), false);
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.DELETE), false);
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.BULK_NOTIFY), false);
    assert.equal(hasAdminAction({ role }, CUSTOMER_ACTIONS.BULK_EXPIRE), false);
  }

  assert.deepEqual([...actionsForRole('unknown')], []);
});

test('requireAdminAction fails closed with a stable error code', () => {
  const response = {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  let nextCalled = false;
  requireAdminAction(CUSTOMER_ACTIONS.DELETE)(
    { admin: { role: 'operator' } },
    response,
    () => {
      nextCalled = true;
    },
  );

  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
  assert.equal(response.body.code, 'ADMIN_ACTION_FORBIDDEN');
});

test('manual bonus reason and delegated limits are bounded', () => {
  assert.equal(normalizeManualBonusReason('  Ошибка кассира  '), 'Ошибка кассира');
  assert.throws(() => normalizeManualBonusReason(''), /от 5 до 240/);
  assert.throws(() => normalizeManualBonusReason('1234'), /от 5 до 240/);
  assert.equal(manualBonusLimitForAdmin({ role: 'owner' }), 1_000_000);
  assert.equal(manualBonusLimitForAdmin({ role: 'branch_manager' }), 100_000);
});

test('admin customer deletion uses anonymization instead of a hard delete', () => {
  const controllerSource = fs.readFileSync(
    path.join(__dirname, '../src/controllers/admin.controller.js'),
    'utf8',
  );
  const customerServiceSource = fs.readFileSync(
    path.join(__dirname, '../src/services/customer.service.js'),
    'utf8',
  );

  assert.match(controllerSource, /await deleteCustomerData\(req\.params\.id\)/);
  assert.doesNotMatch(controllerSource, /await deleteCustomer\(req\.params\.id\)/);
  assert.doesNotMatch(customerServiceSource, /async function deleteCustomer/);
});

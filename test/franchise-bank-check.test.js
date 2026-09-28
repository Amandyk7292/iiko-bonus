const test = require('node:test');
const assert = require('node:assert/strict');
const { checkBankOrder } = require('../src/services/franchise-bank-check.service');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const { branchScopeForAdmin } = require('../src/utils/admin-scope.util');
const order = {
  payment_method: 'forte_card',
  provider_payment_system: 'forte_widget',
  status: 'paid',
};
const bank = (payment, refund = 'confirmed') => ({
  widget: {
    queryOrder: async () => ({ normalized: { status: payment } }),
    mapWidgetStatus: (n) => n.status,
    reconcileRefund: async () => ({ status: refund }),
  },
});
test('bank check identifies mismatches without applying provider state', async () => {
  assert.equal((await checkBankOrder(order, bank('pending'))).issue, 'payment_unconfirmed');
  assert.equal(
    (await checkBankOrder({ ...order, status: 'pending' }, bank('paid'))).issue,
    'local_unpaid',
  );
  assert.equal((await checkBankOrder(order, bank('paid'))).issue, 'ok');
  assert.equal(
    (
      await checkBankOrder(
        { ...order, status: 'refunded', refund_reference: 'ref' },
        bank('paid', 'pending'),
      )
    ).issue,
    'refund_unconfirmed',
  );
  assert.equal(
    (await checkBankOrder({ ...order, status: 'refunded', refund_reference: 'ref' }, bank('paid')))
      .issue,
    'ok',
  );
  assert.equal(
    (await checkBankOrder({ ...order, partially_refunded_amount: 20 }, bank('paid'))).refund_status,
    'manual',
  );
});
test('bank timeouts never confirm payment or leak provider secrets', async () => {
  const result = await checkBankOrder(order, {
    widget: {
      queryOrder: async () => {
        throw Error('secret-token');
      },
    },
  });
  assert.equal(result.issue, 'unavailable');
  assert.ok(!JSON.stringify(result).includes('secret'));
  assert.equal(
    (await checkBankOrder({ ...order, payment_method: 'personal_account' }, {})).issue,
    'manual',
  );
});
test('franchisee can read settlement endpoints only and cannot mutate', () => {
  for (const [method, path, allowed] of [
    ['GET', '/transactions/settlements', true],
    ['GET', '/transactions/settlements/details', true],
    ['GET', '/transactions', false],
    ['GET', '/customers', false],
    ['GET', '/orders', false],
    ['GET', '/access', false],
    ['GET', '/events', false],
    ['GET', '/scope', true],
    ['POST', '/transactions/settlements/payouts', false],
    ['POST', '/transactions/settlements/months/close', false],
  ]) {
    let next = false,
      status = 200;
    const res = {
      status(v) {
        status = v;
        return this;
      },
      json() {
        return this;
      },
    };
    adminMutationRoleMiddleware(
      { method, path, admin: { role: 'franchisee', branchIds: [] } },
      res,
      () => {
        next = true;
      },
    );
    assert.equal(next, allowed, method + ' ' + path);
    assert.equal(status, allowed ? 200 : 403);
  }
  assert.deepEqual(branchScopeForAdmin({ role: 'franchisee', branchIds: [] }), [
    '00000000-0000-0000-0000-000000000000',
  ]);
});

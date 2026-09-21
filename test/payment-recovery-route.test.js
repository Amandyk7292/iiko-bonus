const assert = require('node:assert/strict');
const test = require('node:test');
const controller = require('../src/controllers/forte.controller');
const widget = require('../src/services/forte-widget.service');
const hosted = require('../src/services/forte.service');
const state = require('../src/services/order-payment-state.service');
const checkoutId = '11111111-1111-4111-8111-111111111111';
const response = () => ({
  statusCode: 200,
  status(value) {
    this.statusCode = value;
    return this;
  },
  json(value) {
    this.body = value;
    return this;
  },
});
const request = { params: { checkoutId }, customerAuth: { id: 'customer-a' }, query: {} };

test('recovery scopes the checkout lookup to its owner and distinguishes a missing operation', async (t) => {
  t.mock.method(widget, 'existingRequest', async (owner, id) => {
    assert.equal(owner, 'customer-a');
    assert.equal(id, checkoutId);
    return null;
  });
  const res = response();
  await controller.checkCheckoutStatus(request, res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.code, 'PAYMENT_CHECKOUT_NOT_FOUND');
});

test('a failed recovery lookup never masquerades as a missing payment', async (t) => {
  t.mock.method(widget, 'existingRequest', async () => {
    throw new Error('db offline');
  });
  const res = response();
  await controller.checkCheckoutStatus(request, res);
  assert.equal(res.statusCode, 500);
  assert.notEqual(res.body.code, 'PAYMENT_CHECKOUT_NOT_FOUND');
});

test('recovery returns the bank operation id for a hosted payment, not its client checkout id', async (t) => {
  const order = { operation_id: '1000000004567', payment_method: 'forte_card', status: 'pending' };
  t.mock.method(widget, 'existingRequest', async () => order);
  t.mock.method(hosted, 'getOrderStatus', async (id, owner) => {
    assert.equal(id, order.operation_id);
    assert.equal(owner, 'customer-a');
    return order;
  });
  t.mock.method(hosted, 'availability', () => true);
  t.mock.method(hosted, 'syncOrder', async () => {});
  const res = response();
  await controller.checkCheckoutStatus(request, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.operationId, order.operation_id);
  assert.equal(res.body.paymentStatus, 'pending');
});

test('confirmed payment state stays readable during a bank outage', async (t) => {
  const order = { operation_id: checkoutId, payment_method: 'forte_card', status: 'paid' };
  t.mock.method(widget, 'existingRequest', async () => order);
  t.mock.method(widget, 'getOrderStatus', async () => order);
  t.mock.method(widget, 'availability', () => false);
  t.mock.method(state, 'recordPaidOrder', async () => order);
  const res = response();
  await controller.checkCheckoutStatus(request, res);
  assert.equal(res.body.paymentStatus, 'paid');
});

test('a finished payment response never reopens or decrypts a bank checkout', async () => {
  for (const service of [
    new widget.ForteWidgetService({ env: {} }),
    new hosted.ForteService({ env: {} }),
  ]) {
    for (const status of ['paid', 'failed', 'expired', 'refunded']) {
      const result = await service.paymentResponse({
        id: 'order',
        operation_id: checkoutId,
        status,
        amount: 600,
      });
      assert.equal(result.paymentStatus, status);
      assert.equal(result.redirectUrl, undefined);
    }
  }
});

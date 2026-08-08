const assert = require('node:assert/strict');
const test = require('node:test');

const forteService = require('../src/services/forte.service');
const forteWidgetService = require('../src/services/forte-widget.service');
const {
  paymentProviderName,
  reconcileRefundForOrder,
  refundPaymentForOrder,
} = require('../src/services/payment-gateway.service');

test('refunds use Forte integration selected by the original order', async (t) => {
  const calls = [];
  const originals = {
    forte: forteService.refundPayment,
    widget: forteWidgetService.refundPayment,
  };
  forteService.refundPayment = async (...args) => {
    calls.push(['forte', ...args]);
    return { reference: 'forte-refund' };
  };
  forteWidgetService.refundPayment = async (...args) => {
    calls.push(['widget', ...args]);
    return { reference: 'widget-refund' };
  };
  t.after(() => {
    forteService.refundPayment = originals.forte;
    forteWidgetService.refundPayment = originals.widget;
  });

  const hostedCardOrder = { operation_id: '456', payment_method: 'forte_card' };
  const widgetCardOrder = {
    operation_id: '789',
    payment_method: 'forte_card',
    provider_payment_system: 'forte_widget',
  };

  await refundPaymentForOrder(hostedCardOrder, 2000, { idempotencyKey: 'hosted-key' });
  await refundPaymentForOrder(widgetCardOrder, 3000, { idempotencyKey: 'widget-key' });

  assert.equal(paymentProviderName(widgetCardOrder), 'ForteBank');
  assert.deepEqual(calls, [
    ['forte', hostedCardOrder, 2000, { idempotencyKey: 'hosted-key' }],
    ['widget', widgetCardOrder, 3000, { idempotencyKey: 'widget-key' }],
  ]);
});

test('historical-provider refunds fail closed without a provider request', async () => {
  const historicalOrder = { operation_id: '123', payment_method: 'invoice' };

  assert.equal(paymentProviderName(historicalOrder), 'Исторический способ оплаты');
  await assert.rejects(
    () => refundPaymentForOrder(historicalOrder, 1000),
    (error) =>
      error.statusCode === 410 &&
      error.code === 'PAYMENT_PROVIDER_RETIRED' &&
      error.retryable === false,
  );
  await assert.rejects(
    () =>
      reconcileRefundForOrder(historicalOrder, {
        id: 'refund-1',
        amount: 1000,
      }),
    (error) => error.statusCode === 410 && error.code === 'PAYMENT_PROVIDER_RETIRED',
  );
});

const assert = require('node:assert/strict');
const test = require('node:test');

const kaspiService = require('../src/services/kaspi.service');
const forteService = require('../src/services/forte.service');
const forteWidgetService = require('../src/services/forte-widget.service');
const {
  paymentProviderName,
  refundPaymentForOrder,
} = require('../src/services/payment-gateway.service');

test('full refunds use the same payment provider as the original order', async (t) => {
  const calls = [];
  const originals = {
    kaspi: kaspiService.refundPayment,
    forte: forteService.refundPayment,
    widget: forteWidgetService.refundPayment,
  };
  kaspiService.refundPayment = async (...args) => {
    calls.push(['kaspi', ...args]);
    return { reference: 'kaspi-refund' };
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
    kaspiService.refundPayment = originals.kaspi;
    forteService.refundPayment = originals.forte;
    forteWidgetService.refundPayment = originals.widget;
  });

  const kaspiOrder = { operation_id: '123', payment_method: 'kaspi' };
  const hostedCardOrder = { operation_id: '456', payment_method: 'forte_card' };
  const widgetCardOrder = {
    operation_id: '789',
    payment_method: 'forte_card',
    provider_payment_system: 'forte_widget',
  };

  await refundPaymentForOrder(kaspiOrder, 1000);
  await refundPaymentForOrder(hostedCardOrder, 2000, { idempotencyKey: 'hosted-key' });
  await refundPaymentForOrder(widgetCardOrder, 3000, { idempotencyKey: 'widget-key' });

  assert.equal(paymentProviderName(kaspiOrder), 'Kaspi Pay');
  assert.equal(paymentProviderName(widgetCardOrder), 'ForteBank');
  assert.deepEqual(calls, [
    ['kaspi', '123', 1000],
    ['forte', hostedCardOrder, 2000, { idempotencyKey: 'hosted-key' }],
    ['widget', widgetCardOrder, 3000, { idempotencyKey: 'widget-key' }],
  ]);
});

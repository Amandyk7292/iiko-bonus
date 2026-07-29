const assert = require('node:assert/strict');
const test = require('node:test');

const forteService = require('../src/services/forte.service');
const {
  SAFE_REFUND_RETRY_WINDOW_MS,
  reconcileRefundForOrder,
} = require('../src/services/payment-gateway.service');

test('lost legacy Forte full-refund response is confirmed from read-only provider state', async (t) => {
  const originalQuery = forteService.queryOrder;
  const originalRefund = forteService.refundPayment;
  let mutationCalls = 0;
  forteService.queryOrder = async (order) => ({
    order,
    normalized: {
      id: order.operation_id,
      status: 'Refunded',
      amount: order.amount,
      currency: 'KZT',
    },
  });
  forteService.refundPayment = async () => {
    mutationCalls += 1;
    throw new Error('idempotent mutation must not run after provider reports Refunded');
  };
  t.after(() => {
    forteService.queryOrder = originalQuery;
    forteService.refundPayment = originalRefund;
  });

  const order = {
    id: 'order-id',
    operation_id: '1000001919999',
    amount: 100,
    payment_method: 'forte_card',
    provider_payment_system: 'forte_legacy',
  };
  const refund = {
    id: '11111111-1111-4111-8111-111111111111',
    amount: 100,
    provider_request_id: '11111111-1111-4111-8111-111111111111',
  };

  const result = await reconcileRefundForOrder(order, refund, {
    knownSucceededAmount: 0,
  });

  assert.deepEqual(result, {
    status: 'confirmed',
    reference: null,
    requestId: refund.provider_request_id,
  });
  assert.equal(mutationCalls, 0);
});

test('legacy Forte refunded state stays pending when local refund totals do not explain it', async (t) => {
  const originalQuery = forteService.queryOrder;
  const originalRefund = forteService.refundPayment;
  forteService.queryOrder = async (order) => ({
    order,
    normalized: { status: 'Voided', amount: order.amount, currency: 'KZT' },
  });
  forteService.refundPayment = async () =>
    assert.fail('ambiguous local totals must not create another refund');
  t.after(() => {
    forteService.queryOrder = originalQuery;
    forteService.refundPayment = originalRefund;
  });

  const result = await reconcileRefundForOrder(
    {
      operation_id: '1000001919999',
      amount: 100,
      payment_method: 'forte_card',
      provider_payment_system: 'forte_legacy',
    },
    {
      id: '22222222-2222-4222-8222-222222222222',
      amount: 30,
    },
    { knownSucceededAmount: 20 },
  );

  assert.equal(result.status, 'pending');
  assert.match(result.message, /локальная сумма/i);
});

test('stale unknown Forte partial refund never performs another mutation', async (t) => {
  const forteWidgetService = require('../src/services/forte-widget.service');
  const originalRefund = forteWidgetService.refundPayment;
  let mutationCalls = 0;
  forteWidgetService.refundPayment = async () => {
    mutationCalls += 1;
    return { reference: 'must-not-happen' };
  };
  t.after(() => {
    forteWidgetService.refundPayment = originalRefund;
  });

  const now = Date.parse('2026-07-29T12:00:00.000Z');
  const result = await reconcileRefundForOrder(
    {
      operation_id: '1000001919999',
      amount: 100,
      payment_method: 'forte_card',
      provider_payment_system: 'forte_widget',
    },
    {
      id: '33333333-3333-4333-8333-333333333333',
      amount: 30,
      created_at: new Date(now - SAFE_REFUND_RETRY_WINDOW_MS).toISOString(),
    },
    { knownSucceededAmount: 20, now },
  );

  assert.equal(result.status, 'pending');
  assert.match(result.message, /безопасное окно/i);
  assert.equal(mutationCalls, 0);
});

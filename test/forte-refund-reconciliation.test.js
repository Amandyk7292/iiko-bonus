const assert = require('node:assert/strict');
const test = require('node:test');

const forteService = require('../src/services/forte.service');
const {
  SAFE_REFUND_RETRY_WINDOW_MS,
  reconcileFullRefundForOrder,
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

test('hosted full refund recovery confirms only matching final payment snapshots and never mutates the bank', async (t) => {
  const originalQuery = forteService.queryOrder;
  const originalRefund = forteService.refundPayment;
  let reads = 0;
  let snapshot;
  forteService.queryOrder = async () => {
    reads++;
    return { normalized: snapshot };
  };
  forteService.refundPayment = async () => assert.fail('Full refund recovery must be read-only');
  t.after(() => {
    forteService.queryOrder = originalQuery;
    forteService.refundPayment = originalRefund;
  });
  const order = {
    operation_id: '1000001919999',
    payment_method: 'forte_card',
    provider_payment_system: null,
    amount: 1000,
    partially_refunded_amount: 100,
    refund_request_id: '33333333-3333-4333-8333-333333333333',
    refund_reference: 'known-reference',
    refund_requested_at: '2020-01-01T00:00:00Z',
  };
  const valid = { id: order.operation_id, amount: 1000, currency: 'KZT', status: 'Refunded' };
  for (const status of ['Refunded', 'Voided']) {
    snapshot = { ...valid, status };
    const result = await reconcileFullRefundForOrder(order);
    assert.equal(result.status, 'confirmed');
    assert.equal(result.requestId, order.refund_request_id);
    assert.equal(result.reference, order.refund_reference);
  }
  for (const mismatch of [
    { status: 'FullyPaid' },
    { status: 'PartPaid' },
    { status: 'Unknown' },
    { id: 'another-payment' },
    { amount: 999 },
    { currency: 'USD' },
  ]) {
    snapshot = { ...valid, ...mismatch };
    assert.equal((await reconcileFullRefundForOrder(order)).status, 'pending');
  }
  const beforeInvalid = reads;
  for (const invalid of [
    { refund_request_id: null },
    { operation_id: null },
    { amount: 0 },
    { partially_refunded_amount: 1000 },
    { partially_refunded_amount: -1 },
  ])
    assert.equal((await reconcileFullRefundForOrder({ ...order, ...invalid })).status, 'pending');
  assert.equal(reads, beforeInvalid);
  forteService.queryOrder = async () => {
    throw new Error('Temporary provider read outage');
  };
  assert.equal((await reconcileFullRefundForOrder(order)).status, 'pending');
});

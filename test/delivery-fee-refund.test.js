const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { buildRefundPreview } = require('../src/services/partial-refund.service');
const {
  calculateDeliveryFeeRefund,
  refundDeliveryReplacementFee,
} = require('../src/services/delivery-fee-refund.service');

const refunded = (delivery = 0) => ({ quantities: new Map([['__delivery_fee__', delivery]]) });
test('replacement returns only the delivery fee and refuses excess or invalid money', () => {
  const order = { amount: 3800, delivery_fee: 700, partially_refunded_amount: 0 };
  const result = calculateDeliveryFeeRefund(order, refunded());
  assert.equal(result.amount, 700);
  assert.equal(result.records.length, 1);
  assert.equal(result.records[0].line_key, '__delivery_fee__');
  assert.equal(result.records[0].refund_amount, 700);
  assert.equal(calculateDeliveryFeeRefund(order, refunded(1)).skip, true);
  assert.equal(calculateDeliveryFeeRefund({ ...order, delivery_fee: 0 }, refunded()).skip, true);
  assert.throws(
    () => calculateDeliveryFeeRefund({ ...order, partially_refunded_amount: 3200 }, refunded()),
    /сверки/,
  );
  assert.throws(
    () => calculateDeliveryFeeRefund({ ...order, delivery_fee: 700.1 }, refunded()),
    /Некорректная/,
  );
});

test('refund preview uses goods value after delivery return and matches the ledger adjustment', () => {
  const order = {
    amount: 1900,
    subtotal: 2000,
    discount_amount: 200,
    bonus_spent: 900,
    delivery_fee: 1000,
    earned_bonus: 45,
    partially_refunded_amount: 1000,
  };
  const preview = buildRefundPreview(
    order,
    {
      amount: 450,
      records: [{ line_key: 'goods:0', refund_amount: 450 }],
    },
    { originalSpent: 900, priorDeliveryFeeRefunded: 1000 },
  );
  assert.equal(preview.adjustment.earnedBonusReversed, 22.5);
  assert.equal(preview.adjustment.spentBonusRestored, 450);
  assert.equal(preview.remainingAfter, 450);
  const feeOnly = buildRefundPreview(
    { amount: 100, subtotal: 600, discount_amount: 600, delivery_fee: 100, earned_bonus: 0 },
    calculateDeliveryFeeRefund({ amount: 100, delivery_fee: 100 }, refunded()),
  );
  assert.equal(feeOnly.adjustment.earnedBonusReversed, 0);
  assert.equal(feeOnly.adjustment.spentBonusRestored, 0);
});

const database = (order) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: order }) }) }) }),
});
test('fee refund reuses resolution id through the normal bank pipeline and rechecks a fresh decision', async () => {
  const id = randomUUID();
  const order = {
    status: 'paid',
    amount: 1500,
    delivery_fee: 500,
    delivery_resolution: { id, status: 'pickup_accepting' },
  };
  let calls = 0;
  const result = await refundDeliveryReplacementFee('order', id, {
    db: database(order),
    refund: async (orderId, payload, actor, calculate) => {
      calls += 1;
      assert.equal(orderId, 'order');
      assert.equal(payload.idempotencyKey, id);
      assert.equal(actor, 'delivery-replacement');
      assert.equal(calculate(order, undefined, refunded()).amount, 500);
      assert.throws(
        () =>
          calculate(
            { ...order, delivery_resolution: { id, status: 'pickup_rejecting' } },
            undefined,
            refunded(),
          ),
        /изменилось/,
      );
      return { status: 'unknown' };
    },
  });
  assert.equal(result.status, 'unknown');
  assert.equal(calls, 1);
  await assert.rejects(
    refundDeliveryReplacementFee('order', randomUUID(), {
      db: database(order),
      refund: () => assert.fail('foreign decision'),
    }),
    /не подтверждена/,
  );
  await assert.rejects(
    refundDeliveryReplacementFee('order', id, {
      db: database({ ...order, delivery_resolution: { id, status: 'pickup_pending_approval' } }),
      refund: () => assert.fail('not accepted'),
    }),
    /не подтверждена/,
  );
});

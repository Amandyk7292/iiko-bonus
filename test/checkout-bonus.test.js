const test = require('node:test');
const assert = require('node:assert/strict');
const { priceCheckoutBonus } = require('../src/services/checkout-bonus.service');

const pricing = { subtotal: 2000, discount: 200, deliveryFee: 1000, total: 2800 };
test('bonus switch applies at most half of discounted merchandise, leaving delivery fully payable', async () => {
  for (const [available, spent] of [
    [1200, 900],
    [100, 100],
    [0, 0],
  ]) {
    const db = { rpc: async () => ({ data: { available } }) };
    const off = await priceCheckoutBonus({ pricing, customerId: 'c' }, { db });
    assert.equal(off.total, 2800);
    const on = await priceCheckoutBonus({ pricing, customerId: 'c', useBonuses: true }, { db });
    assert.equal(on.bonusSpent, spent);
    assert.equal(on.total, 2800 - spent);
    assert.equal(on.deliveryFee, 1000);
    assert.equal(on.discount, 200);
  }
});

test('payment reserves the amount explicitly confirmed, not a stale UI balance', async () => {
  const calls = [];
  const db = {
    rpc: async (name, body) => {
      calls.push({ name, body });
      return name === 'quote_checkout_bonus'
        ? { data: { available: 1200 } }
        : { data: { amount: 900, reservationId: 'hold' } };
    },
  };
  const paid = await priceCheckoutBonus(
    { pricing, customerId: 'c', useBonuses: true, requestId: 'attempt', expectedBonusSpent: 900 },
    { phase: 'payment', db },
  );
  assert.equal(paid.total, 1900);
  assert.equal(paid.bonusReservationId, 'hold');
  assert.deepEqual(calls[1], {
    name: 'reserve_checkout_bonus',
    body: {
      p_customer_id: 'c',
      p_request_id: 'attempt',
      p_order_total: 1800,
      p_expected_amount: 900,
    },
  });
  await assert.rejects(
    priceCheckoutBonus({ pricing, customerId: 'c', useBonuses: true }, { phase: 'payment', db }),
    { code: 'CHECKOUT_BONUS_CHANGED' },
  );
  const changedDb = {
    rpc: async (name) =>
      name === 'quote_checkout_bonus'
        ? { data: { available: 100 } }
        : { error: 'checkout bonus changed' },
  };
  await assert.rejects(
    priceCheckoutBonus(
      { pricing, customerId: 'c', useBonuses: true, requestId: 'attempt', expectedBonusSpent: 900 },
      { phase: 'payment', db: changedDb },
    ),
    { code: 'CHECKOUT_BONUS_CHANGED' },
  );
});

test('legacy checkout without the bonus switch never reserves bonus funds', async () => {
  const result = await priceCheckoutBonus(
    { pricing, customerId: 'c' },
    { phase: 'payment', db: { rpc: () => assert.fail('unexpected reservation') } },
  );
  assert.equal(result.total, pricing.total);
  assert.equal(result.bonusSpent, 0);
});

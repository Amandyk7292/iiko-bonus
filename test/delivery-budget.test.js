const test = require('node:test');
const assert = require('node:assert/strict');
const { DeliveryBudgetService } = require('../src/services/delivery-budget.service');
const { finalJobCost } = require('../src/services/delivery-budget-cost');
const { priceCheckoutDelivery } = require('../src/services/checkout-delivery-pricing.service');

const input = (free = false) => ({
  customerId: 'customer',
  requestId: 'request',
  checkout: { effectiveFulfillmentType: 'delivery', branchId: 'branch', orderType: 'delivery' },
  pricing: {
    subtotal: 35,
    total: 35,
    discount: 0,
    deliveryFee: 0,
    canonicalItems: [],
    freeDelivery: free,
  },
});

test('budget store failures fail closed and a 1000 quote needs 1500 available', async () => {
  let available = 1499;
  const budget = new DeliveryBudgetService({
    db: { rpc: async () => ({ data: { available, bufferPercent: 50 } }) },
  });
  await assert.rejects(budget.check(1000), { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' });
  available = 1500;
  await budget.check(1000);
  const unavailable = new DeliveryBudgetService({
    db: { rpc: async () => ({ error: { code: '08006' } }) },
  });
  await assert.rejects(unavailable.check(1000), { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' });
});

test('insufficient budget rejects the quote before another physical courier probe', async () => {
  let calls = 0;
  const budget = new DeliveryBudgetService({
    db: { rpc: async () => ({ data: { available: 500, bufferPercent: 50 } }) },
  });
  await assert.rejects(
    priceCheckoutDelivery(input(), {
      phase: 'quote',
      version: 1,
      estimate: async () => 1000,
      probe: async () => calls++,
      budget,
      assertAvailable: async () => {},
    }),
    { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' },
  );
  assert.equal(calls, 0);
});

test('free delivery still checks and reserves the full courier estimate without charging the buffer', async () => {
  const calls = [];
  const budget = {
    check: async (amount) => calls.push(['check', amount]),
    reserve: async (...args) => {
      calls.push(['reserve', ...args]);
      return { id: 'hold' };
    },
    releaseUnstarted: async () => {},
  };
  const options = {
    budget,
    assertAvailable: async () => {},
    probe: async () => {},
    estimate: async () => 1000,
  };
  const quote = await priceCheckoutDelivery(input(true), {
    ...options,
    phase: 'quote',
    version: 1,
  });
  const payment = await priceCheckoutDelivery(input(true), {
    ...options,
    phase: 'payment',
    token: quote.deliveryQuoteToken,
  });
  assert.equal(quote.pricing.deliveryFee, 0);
  assert.equal(payment.pricing.total, 35);
  assert.deepEqual(calls, [
    ['check', 1000],
    ['reserve', 'customer', 'request', 1000],
  ]);
  assert.equal(payment.pricing.deliveryBudgetReservationId, 'hold');
});

test('a lost race for budget blocks payment before the probe, even with a valid quote', async () => {
  let probes = 0;
  const budget = {
    check: async () => {},
    reserve: async () => {
      throw Object.assign(new Error('Budget used'), { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' });
    },
  };
  const options = {
    budget,
    assertAvailable: async () => {},
    estimate: async () => 1000,
    probe: async () => probes++,
  };
  const quote = await priceCheckoutDelivery(input(), { ...options, phase: 'quote', version: 1 });
  await assert.rejects(
    priceCheckoutDelivery(input(), {
      ...options,
      phase: 'payment',
      token: quote.deliveryQuoteToken,
    }),
    { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' },
  );
  assert.equal(probes, 1);
});

test('failed courier probe releases only an unstarted payment reservation', async () => {
  let released = false;
  const budget = {
    check: async () => {},
    reserve: async () => ({ id: 'hold' }),
    releaseUnstarted: async (c, r) => {
      assert.equal(c, 'customer');
      assert.equal(r, 'request');
      released = true;
    },
  };
  const options = {
    budget,
    assertAvailable: async () => {},
    estimate: async () => 1000,
    probe: async () => {},
  };
  const quote = await priceCheckoutDelivery(input(), { ...options, phase: 'quote', version: 1 });
  await assert.rejects(
    priceCheckoutDelivery(input(), {
      ...options,
      phase: 'payment',
      token: quote.deliveryQuoteToken,
      probe: async () => {
        throw Error('cancel unknown');
      },
    }),
  );
  assert.equal(released, true);
});

test('final cost never treats a courier offer or an unsuccessful cancellation as a bill', () => {
  const base = {
    api_family: 'cargo_v2',
    currency: 'KZT',
    external_claim_id: 'claim',
    raw_response: { pricing: { offer: { price: '1000' } } },
  };
  assert.equal(
    finalJobCost({ ...base, provider_status: 'accepted', budget_cancellation_cost: 200 }),
    null,
  );
  assert.equal(
    finalJobCost({ ...base, provider_status: 'delivered', budget_cancellation_cost: 200 }),
    null,
  );
  assert.equal(finalJobCost({ ...base, provider_status: 'cancelled' }), 0);
  assert.equal(
    finalJobCost({
      ...base,
      provider_status: 'cancelled_with_payment',
      budget_cancellation_cost: 200,
    }),
    200,
  );
  assert.equal(
    finalJobCost({
      ...base,
      provider_status: 'delivered',
      raw_response: { pricing: { final_price: '1500' } },
    }),
    1500,
  );
  assert.equal(
    finalJobCost({
      ...base,
      currency: 'RUB',
      provider_status: 'delivered',
      budget_final_cost: 1500,
    }),
    null,
  );
});

test('Business API cancellation is not treated as free without price evidence', () => {
  const base = { api_family: 'business_v2', currency: 'KZT', external_claim_id: 'claim' };
  assert.equal(finalJobCost({ ...base, provider_status: 'cancelled' }), null);
  assert.equal(
    finalJobCost({
      ...base,
      provider_status: 'complete',
      raw_response: { billedPriceWithVat: 1500 },
    }),
    1500,
  );
});

test('paid order with a released and unavailable reservation is rejected before fulfilment', async () => {
  const chain = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    maybeSingle: async () => ({ data: { estimate: 1000 } }),
  };
  const budget = new DeliveryBudgetService({
    db: { from: () => chain, rpc: async () => ({ data: { status: 'unavailable' } }) },
  });
  assert.equal(
    await budget.ensurePaid({
      id: 'order',
      customer_id: 'customer',
      client_request_id: 'request',
      fulfillment_type: 'delivery',
      delivery_budget_required: true,
    }),
    false,
  );
});

test('budget adjustment contracts require owner confirmation and reject invalid amounts', () => {
  const { adjustmentSchema } = require('../src/routes/admin/delivery-budget.routes');
  const valid = {
    requestId: '11111111-1111-4111-8111-111111111111',
    revision: 1,
    amount: 5000,
    mode: 'balance',
    confirmed: true,
  };
  assert.equal(adjustmentSchema.safeParse(valid).success, true);
  for (const change of [
    { confirmed: false },
    { amount: -1 },
    { amount: 1.001 },
    { amount: Infinity },
    { revision: 0 },
    { mode: 'withdraw' },
  ]) {
    assert.equal(adjustmentSchema.safeParse({ ...valid, ...change }).success, false);
  }
});

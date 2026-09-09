const assert = require('node:assert/strict');
const test = require('node:test');
const jwt = require('jsonwebtoken');
const { priceCheckoutDelivery } = require('../src/services/checkout-delivery-pricing.service');
const { getJwtSecret } = require('../src/services/auth.service');

test('checkout contracts accept signed quotes and reject a client-supplied fee', () => {
  const {
    checkoutQuoteBodySchema,
    checkoutPaymentBodySchema,
  } = require('../src/contracts/customer-api.contract');
  const body = { items: [{ id: 'bun', quantity: 1 }], deliveryQuoteVersion: 1 };
  assert.equal(checkoutQuoteBodySchema.safeParse(body).success, true);
  const payment = {
    ...body,
    checkoutId: '11111111-1111-4111-8111-111111111111',
    deliveryQuoteToken: 'signed-quote',
  };
  assert.equal(checkoutPaymentBodySchema.safeParse(payment).success, true);
  assert.equal(checkoutPaymentBodySchema.safeParse({ ...payment, deliveryFee: 0 }).success, false);
  assert.equal(
    checkoutPaymentBodySchema.safeParse({ ...payment, deliveryQuoteToken: 'x'.repeat(2049) })
      .success,
    false,
  );
});

const context = (subtotal = 35, discount = 0) => ({
  customerId: 'customer-one',
  checkout: {
    effectiveFulfillmentType: 'delivery',
    orderType: 'delivery',
    branchId: 'branch-one',
    scheduledAt: '2026-09-09T12:00:00.000Z',
    deliveryFee: 600,
    deliveryOrigin: { city: 'Актау', latitude: 43.68, longitude: 51.15 },
    deliveryAddress: {
      city: 'Актау',
      address: '34 микрорайон',
      house: '14',
      latitude: 43.69,
      longitude: 51.16,
    },
  },
  pricing: {
    subtotal,
    discount,
    total: subtotal - discount,
    deliveryFee: 0,
    canonicalItems: [{ id: 'bun', quantity: 1, price: subtotal }],
  },
});

for (const [subtotal, discount, expectedFee] of [
  [9999, 0, 1000],
  [10000, 0, 0],
  [10001, 0, 0],
  [10000, 1, 1000],
  [11000, 1000, 0],
]) {
  test(`delivery threshold uses discounted goods: ${subtotal} - ${discount}`, async () => {
    let calls = 0;
    const result = await priceCheckoutDelivery(context(subtotal, discount), {
      phase: 'quote',
      version: 1,
      estimate: async () => {
        calls++;
        return 1000;
      },
    });
    assert.equal(result.pricing.deliveryFee, expectedFee);
    assert.equal(result.pricing.total, subtotal - discount + expectedFee);
    assert.equal(calls, expectedFee ? 1 : 0);
    assert.ok(result.deliveryQuoteToken);
  });
}

test('payment keeps quoted 1000 even if the courier now costs 1500', async () => {
  const input = context();
  const quoted = await priceCheckoutDelivery(input, {
    phase: 'quote',
    version: 1,
    now: 1000,
    estimate: async () => 1000,
  });
  let requoted = false;
  const paid = await priceCheckoutDelivery(
    { ...input, checkout: { ...input.checkout, deliveryFee: 1500 } },
    {
      phase: 'payment',
      version: 1,
      token: quoted.deliveryQuoteToken,
      now: 1100,
      estimate: async () => {
        requoted = true;
        return 1500;
      },
    },
  );
  assert.equal(paid.pricing.deliveryFee, 1000);
  assert.equal(paid.pricing.total, 1035);
  assert.equal(requoted, false);
  assert.throws(() => jwt.verify(quoted.deliveryQuoteToken, getJwtSecret()));
});

test('expiry, tampering, another customer, changed goods and changed destination need confirmation', async () => {
  const input = context();
  const quoted = await priceCheckoutDelivery(input, {
    phase: 'quote',
    version: 1,
    now: 1000,
    estimate: async () => 1000,
  });
  const payment = { phase: 'payment', version: 1, token: quoted.deliveryQuoteToken, now: 1100 };
  const cases = [
    [input, { ...payment, now: 1900 }],
    [input, { ...payment, token: '' }],
    [input, { ...payment, token: quoted.deliveryQuoteToken.slice(0, -10) + 'tamperedxx' }],
    [{ ...input, customerId: 'customer-two' }, payment],
    [context(70), payment],
    [{ ...input, checkout: { ...input.checkout, branchId: 'another-branch' } }, payment],
    [
      {
        ...input,
        checkout: {
          ...input.checkout,
          deliveryAddress: { ...input.checkout.deliveryAddress, latitude: 43.7 },
        },
      },
      payment,
    ],
  ];
  for (const [candidate, options] of cases) {
    await assert.rejects(priceCheckoutDelivery(candidate, options), {
      code: 'CHECKOUT_QUOTE_CHANGED',
    });
  }
});

test('preorder delivery uses the same policy; pickup has no fee', async () => {
  const input = context();
  input.checkout.orderType = 'preorder';
  const quote = await priceCheckoutDelivery(input, {
    phase: 'quote',
    version: 1,
    estimate: async () => 1000,
  });
  assert.equal(quote.pricing.total, 1035);
  input.checkout.effectiveFulfillmentType = 'pickup';
  const pickup = await priceCheckoutDelivery(input, { phase: 'payment', version: 1 });
  assert.equal(pickup.pricing.total, 35);
});

test('the delivery fee never counts toward the free delivery threshold', async () => {
  const input = context(9500);
  input.pricing = { ...input.pricing, total: 10100, deliveryFee: 600 };
  const result = await priceCheckoutDelivery(input, {
    phase: 'quote',
    version: 1,
    estimate: async () => 1000,
  });
  assert.equal(result.pricing.deliveryFee, 1000);
  assert.equal(result.pricing.total, 10500);
});

test('clients without quote support cannot charge an unconfirmed delivery fee', async () => {
  for (const phase of ['quote', 'payment']) {
    await assert.rejects(priceCheckoutDelivery(context(), { phase }), {
      code: 'CHECKOUT_APP_UPDATE_REQUIRED',
    });
  }
});

test('invalid or unavailable courier estimates never become a zero-priced payment', async () => {
  for (const fee of [NaN, -1, 100001, 1.5]) {
    await assert.rejects(
      priceCheckoutDelivery(context(), { phase: 'quote', version: 1, estimate: async () => fee }),
    );
  }
  await assert.rejects(
    priceCheckoutDelivery(context(), {
      phase: 'quote',
      version: 1,
      estimate: async () => {
        throw new Error('offline');
      },
    }),
    /offline/,
  );
});

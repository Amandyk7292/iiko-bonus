const assert = require('node:assert/strict');
const test = require('node:test');
// Keep this suite independent of a local .env or a configured database client.
const supabase = {
  from() {
    throw new Error('Install the promotion fixture before querying');
  },
};
const databaseModule = require.resolve('../src/config/supabase');
require.cache[databaseModule] = {
  id: databaseModule,
  filename: databaseModule,
  loaded: true,
  exports: { supabase },
};
const {
  resolveTargetedPromotion,
  savePromotion,
} = require('../src/services/commerce-marketing.service');
const { priceCheckoutDelivery } = require('../src/services/checkout-delivery-pricing.service');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const promotionBodySchema = adminMutationSchemas.promotionCreate.body;

function promotionDb(t, overrides = {}) {
  const promotion = {
    id: 'promo-1',
    code: 'DELIVERY',
    discount_type: 'free_delivery',
    discount_value: 0,
    min_order: 0,
    per_customer_limit: 1,
    used_count: 0,
    ...overrides,
  };
  const writes = [];
  t.mock.method(supabase, 'from', (table) => {
    let saved;
    const q = {
      select: () => q,
      eq: () => q,
      lte: () => q,
      or: () => q,
      is: () => q,
      insert: (record) => {
        writes.push(record);
        saved = record;
        return q;
      },
      update: (record) => {
        writes.push(record);
        saved = record;
        return q;
      },
      maybeSingle: async () => ({
        data: table === 'customers' ? { id: 'customer-1', tags: [] } : saved || promotion,
        error: null,
      }),
      then: (resolve, reject) =>
        Promise.resolve({ data: null, count: overrides.redemptions || 0, error: null }).then(
          resolve,
          reject,
        ),
    };
    return q;
  });
  return writes;
}

test('free delivery preserves the goods price and remains zero at payment', async (t) => {
  promotionDb(t);
  const promotion = await resolveTargetedPromotion(35, 'delivery', {
    customerId: 'customer-1',
    fulfillmentType: 'delivery',
  });
  assert.equal(promotion.discount, 0);
  assert.equal(promotion.total, 35);
  assert.equal(promotion.promotionId, 'promo-1');
  const context = {
    customerId: 'customer-1',
    checkout: { effectiveFulfillmentType: 'delivery' },
    pricing: {
      ...promotion,
      subtotal: 35,
      deliveryFee: 0,
      canonicalItems: [{ id: 'bun', price: 35, quantity: 1 }],
    },
  };
  const quote = await priceCheckoutDelivery(context, {
    phase: 'quote',
    version: 1,
    now: 1000,
    estimate: async () => {
      throw new Error('A free customer fee does not need an estimate');
    },
  });
  assert.equal(quote.pricing.deliveryFee, 0);
  assert.equal(quote.pricing.total, 35);
  const payment = { phase: 'payment', version: 1, now: 1010, token: quote.deliveryQuoteToken };
  assert.equal((await priceCheckoutDelivery(context, payment)).pricing.total, 35);
  await assert.rejects(
    priceCheckoutDelivery(
      { ...context, pricing: { ...context.pricing, freeDelivery: false } },
      payment,
    ),
    { code: 'CHECKOUT_QUOTE_CHANGED' },
  );
  await assert.rejects(
    priceCheckoutDelivery({ ...context, customerId: 'another-customer' }, payment),
    { code: 'CHECKOUT_QUOTE_CHANGED' },
  );
});

test('delivery promotion cannot be consumed on pickup or outside its audience and limits', async (t) => {
  promotionDb(t, { min_order: 100 });
  await assert.rejects(
    resolveTargetedPromotion(35, 'DELIVERY', {
      customerId: 'customer-1',
      fulfillmentType: 'delivery',
    }),
    /от 100/,
  );
  await assert.rejects(
    resolveTargetedPromotion(100, 'DELIVERY', {
      customerId: 'customer-1',
      fulfillmentType: 'pickup',
    }),
    { code: 'PROMO_DELIVERY_ONLY' },
  );
  assert.equal(
    (
      await resolveTargetedPromotion(100, 'DELIVERY', {
        customerId: 'customer-1',
        fulfillmentType: 'delivery',
      })
    ).freeDelivery,
    true,
  );
});

test('free delivery respects per-customer redemption limits', async (t) => {
  promotionDb(t, { redemptions: 1 });
  await assert.rejects(
    resolveTargetedPromotion(100, 'DELIVERY', {
      customerId: 'customer-1',
      fulfillmentType: 'delivery',
    }),
    /уже использовали/,
  );
});

test('free delivery stores zero discount and no goods discount cap', async (t) => {
  const writes = promotionDb(t);
  const body = {
    code: 'DELIVERY',
    discountType: 'free_delivery',
    discountValue: 0,
    minOrder: 0,
    maxDiscount: null,
    customerIds: [],
    customerTags: [],
    usageLimit: null,
    perCustomerLimit: 1,
    startsAt: null,
    endsAt: null,
    active: true,
  };
  assert.equal(promotionBodySchema.safeParse(body).success, true);
  assert.equal(promotionBodySchema.safeParse({ ...body, discountType: 'fixed' }).success, false);
  await savePromotion({ ...body, discountValue: 10, maxDiscount: 500 });
  assert.equal(writes[0].discount_type, 'free_delivery');
  assert.equal(writes[0].discount_value, 0);
  assert.equal(writes[0].max_discount, null);
});

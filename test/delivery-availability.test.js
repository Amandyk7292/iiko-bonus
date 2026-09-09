const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DeliveryAvailabilityService,
  isInsufficientFunds,
} = require('../src/services/delivery-availability.service');
const { priceCheckoutDelivery } = require('../src/services/checkout-delivery-pricing.service');

function store() {
  const state = { value: null, fail: false, beforeUpdate: null };
  state.db = {
    from(table) {
      assert.equal(table, 'settings');
      let update;
      const filters = {};
      const query = {
        select() {
          if (!update) return query;
          state.beforeUpdate?.();
          const matches = filters.value === state.value;
          if (!state.fail && matches) state.value = update.value;
          return Promise.resolve({
            data: matches ? [{ key: 'delivery_availability' }] : [],
            error: state.fail,
          });
        },
        eq(key, value) {
          filters[key] = value;
          return query;
        },
        maybeSingle: async () => ({
          data: state.value ? { value: state.value } : null,
          error: state.fail,
        }),
        upsert: async (row) => {
          if (!state.fail) state.value = row.value;
          return { error: state.fail };
        },
        update(value) {
          update = value;
          return query;
        },
      };
      return query;
    },
  };
  return state;
}

test('only an explicit funds error opens the shared delivery stop', async () => {
  const storage = store();
  const service = new DeliveryAvailabilityService({ db: storage.db });
  for (const payload of [
    { code: 'invalid_destination', message: 'Invalid address: недостаточно средств' },
    { code: 'performer_not_found' },
    { code: 'unauthorized' },
    { message: 'timeout' },
    { message: 'Не хватает курьеров' },
    { status: 'ready_for_approval' },
  ])
    assert.equal(await service.recordProviderFailure(payload), false);
  assert.equal(storage.value, null);
  await service.recordProviderFailure({ code: 'insufficient_funds' });
  const anotherProcess = new DeliveryAvailabilityService({ db: storage.db });
  assert.equal((await anotherProcess.get()).disabled, true);
  await assert.rejects(anotherProcess.assertAvailable({ effectiveFulfillmentType: 'delivery' }), {
    code: 'DELIVERY_TEMPORARILY_UNAVAILABLE',
  });
  await anotherProcess.assertAvailable({ effectiveFulfillmentType: 'pickup' });
  assert.equal(
    isInsufficientFunds({
      status: 'failed',
      error_messages: [{ message: 'Недостаточно средств на счете' }],
    }),
    true,
  );
});

test('a persisted stop survives restart and requires a current administrator revision', async () => {
  const storage = store();
  const service = new DeliveryAvailabilityService({ db: storage.db });
  await service.recordProviderFailure({ message: 'Not enough money on account' });
  const revision = (await service.get()).revision;
  const restarted = new DeliveryAvailabilityService({ db: storage.db });
  await assert.rejects(restarted.resume('stale', 'admin'), { statusCode: 409 });
  assert.equal((await restarted.get()).disabled, true);
  assert.equal((await restarted.resume(revision, 'admin')).disabled, false);
  assert.equal((await service.get()).disabled, false);
});

test('new provider failure wins over an admin resume race', async () => {
  const storage = store();
  const service = new DeliveryAvailabilityService({ db: storage.db });
  await service.recordProviderFailure({ code: 'not_enough_balance' });
  const revision = (await service.get()).revision;
  storage.beforeUpdate = () => {
    storage.value = JSON.stringify({ disabled: true, revision: 'new-failure' });
  };
  await assert.rejects(service.resume(revision, 'admin'), { statusCode: 409 });
  assert.equal((await service.get()).disabled, true);
});

test('a storage failure blocks delivery only and retries persisting the stop', async () => {
  const storage = store();
  const service = new DeliveryAvailabilityService({ db: storage.db });
  storage.fail = true;
  await assert.rejects(service.assertAvailable({ effectiveFulfillmentType: 'delivery' }), {
    statusCode: 503,
  });
  await service.assertAvailable({ effectiveFulfillmentType: 'pickup' });
  await service.recordProviderFailure({ code: 'insufficient_funds' });
  assert.equal((await service.get()).disabled, true);
  storage.fail = false;
  assert.equal((await service.get()).disabled, true);
  assert.equal(JSON.parse(storage.value).disabled, true);
});

test('both free delivery and a previously signed quote are blocked before a payment is created', async () => {
  const storage = store();
  const service = new DeliveryAvailabilityService({ db: storage.db });
  const context = {
    customerId: 'customer',
    checkout: { effectiveFulfillmentType: 'delivery' },
    pricing: { subtotal: 10000, discount: 0, total: 10000, deliveryFee: 0, canonicalItems: [] },
  };
  const options = { version: 1, assertAvailable: (checkout) => service.assertAvailable(checkout) };
  const quote = await priceCheckoutDelivery(context, { ...options, phase: 'quote' });
  await service.recordProviderFailure({ code: 'insufficient_balance' });
  await assert.rejects(priceCheckoutDelivery(context, { ...options, phase: 'quote' }), {
    code: 'DELIVERY_TEMPORARILY_UNAVAILABLE',
  });
  await assert.rejects(
    priceCheckoutDelivery(context, {
      ...options,
      phase: 'payment',
      token: quote.deliveryQuoteToken,
    }),
    { code: 'DELIVERY_TEMPORARILY_UNAVAILABLE' },
  );
  const pickup = await priceCheckoutDelivery(
    { ...context, checkout: { effectiveFulfillmentType: 'pickup' } },
    options,
  );
  assert.equal(pickup.pricing.total, 10000);
});

test('resume request explicitly requires balance confirmation and a revision', () => {
  const { resumeBodySchema } = require('../src/routes/admin/delivery-availability.routes');
  assert.equal(resumeBodySchema.safeParse({ balanceConfirmed: true }).success, false);
  assert.equal(
    resumeBodySchema.safeParse({
      revision: '3eb9b4bc-b538-4c75-b06b-9eb2aa0adcd5',
      balanceConfirmed: false,
    }).success,
    false,
  );
});

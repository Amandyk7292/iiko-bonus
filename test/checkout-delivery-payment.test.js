const assert = require('node:assert/strict');
const test = require('node:test');

function install(t, name, value) {
  const id = require.resolve(name);
  const before = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports: value };
  t.after(() => {
    if (before) require.cache[id] = before;
    else delete require.cache[id];
  });
}

function fresh(t, name) {
  const id = require.resolve(name);
  const before = require.cache[id];
  delete require.cache[id];
  t.after(() => {
    if (before) require.cache[id] = before;
    else delete require.cache[id];
  });
  return require(name);
}

function response() {
  return {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
}

function controllerHarness(t) {
  const state = {
    courierFee: 1000,
    charges: [],
    existing: null,
    quoteCalls: 0,
    validations: 0,
    bonusAvailable: 0,
    fundsBlocked: false,
    probeBlocked: false,
    photoReservations: [],
    pricingCalls: 0,
  };
  const {
    deliveryAvailability,
    unavailableError,
  } = require('../src/services/delivery-availability.service');
  t.mock.method(deliveryAvailability, 'assertAvailable', async () => {
    if (state.fundsBlocked) throw unavailableError();
  });
  install(t, '../src/services/checkout-delivery-probe.service', {
    checkoutDeliveryProbe: {
      ensure: async (context) => {
        assert.equal(context.customerPhone, '+77001112233');
        if (state.probeBlocked) throw unavailableError();
      },
    },
  });
  const bonusService = require('../src/services/checkout-bonus.service');
  install(t, '../src/services/checkout-bonus.service', {
    ...bonusService,
    priceCheckoutBonus: (context, options) =>
      bonusService.priceCheckoutBonus(context, {
        ...options,
        db: {
          rpc: async (name, body) => ({
            data:
              name === 'quote_checkout_bonus'
                ? { available: state.bonusAvailable }
                : { amount: body.p_expected_amount, reservationId: 'bonus-hold' },
          }),
        },
      }),
  });
  const checkout = {
    effectiveFulfillmentType: 'delivery',
    orderType: 'delivery',
    branchId: 'branch',
    scheduledAt: '2026-09-10T12:00:00.000Z',
    deliveryFee: 600,
    deliveryMinimumOrder: 35,
    deliveryAddress: {
      city: 'Актау',
      address: '34 микрорайон',
      house: '14',
      latitude: 43.69,
      longitude: 51.16,
    },
  };
  const photoService = require('../src/services/pickup-photo-gift.service');
  install(t, '../src/services/pickup-photo-gift.service', {
    ...photoService,
    reserveCheckoutPhoto: async (customerId, checkoutId, payload, context) =>
      photoService.reserveCheckoutPhoto(customerId, checkoutId, payload, context, {
        rpc: async (_name, body) => {
          state.photoReservations.push(body);
          return {
            data: state.photoError ? { error: state.photoError } : { photoId: body.p_photo },
          };
        },
      }),
  });
  const merchandise = {
    subtotal: 35,
    discount: 0,
    total: 35,
    deliveryFee: 0,
    canonicalItems: [{ id: 'bun', quantity: 1, price: 35 }],
  };
  const payment = {
    existingRequest: async () => state.existing,
    paymentResponse: async (order) => ({
      success: true,
      amount: order.amount,
      operationId: 'same-operation',
    }),
    createCheckout: async (_phone, pricing, _customer, context) => {
      if (state.preflightFailure) throw state.preflightFailure;
      if (state.beforePayment) await state.beforePayment(context);
      state.charges.push(pricing);
      state.paymentPhotoId = context.pickupPhotoId;
      return { success: true, amount: pricing.total };
    },
  };
  install(t, '../src/services/forte-widget.service', payment);
  install(t, '../src/services/order-payment-state.service', {});
  install(t, '../src/services/forte.service', {
    existingRequest: async () => null,
    availability: () => false,
  });
  install(t, '../src/services/payment-operations.service', {
    getForteCheckoutDecision: async () => ({ effectiveIntegration: 'widget' }),
  });
  install(t, '../src/services/order.service', {
    priceOrder: async () => {
      state.pricingCalls++;
      return { ...merchandise };
    },
  });
  install(t, '../src/services/location.service', { getCitiesWithPoints: async () => [] });
  install(t, '../src/services/checkout.service', {
    normalizeOrderType() {},
    validateCheckout() {
      state.validations++;
      return checkout;
    },
  });
  install(t, '../src/services/eta.service', { forecastOrderEta: async () => ({}) });
  install(t, '../src/services/commerce-marketing.service', {
    reservePromotionForCheckout: async () => {},
    releasePromotionReservation: async () => {},
  });
  install(t, '../src/services/inventory.service', {
    reserveCheckout: async () => {},
    releaseCheckoutRequest: async () => {},
  });
  install(t, '../src/services/yandex-delivery.service', {
    estimateCheckoutDelivery: async () => {
      state.quoteCalls++;
      return state.courierFee;
    },
  });
  const controller = fresh(t, '../src/controllers/forte.controller');
  const request = {
    body: {
      items: [],
      deliveryQuoteVersion: 1,
      checkoutId: '11111111-1111-4111-8111-111111111111',
    },
    customerAuth: { id: 'customer', phone: '+77001112233' },
    headers: {},
  };
  return { state, controller, request, checkout };
}

test('optional pickup photo is validated before the gateway and passed with the paid checkout', async (t) => {
  const { state, controller, request, checkout } = controllerHarness(t);
  checkout.effectiveFulfillmentType = checkout.orderType = 'pickup';
  request.body.pickupPhotoId = '22222222-2222-4222-8222-222222222222';
  await controller.createPayment(request, response());
  assert.equal(state.charges.length, 1);
  assert.equal(state.paymentPhotoId, request.body.pickupPhotoId);
  assert.equal(state.photoReservations[0].p_photo, request.body.pickupPhotoId);
});

test('concurrent changed photo cannot join an active payment or release its reservation', async (t) => {
  const { state, controller, request, checkout } = controllerHarness(t);
  checkout.effectiveFulfillmentType = checkout.orderType = 'pickup';
  request.body.pickupPhotoId = '22222222-2222-4222-8222-222222222222';
  let finishPayment;
  const gate = new Promise((resolve) => {
    finishPayment = resolve;
  });
  const started = new Promise((resolve) => {
    state.beforePayment = async () => {
      resolve();
      await gate;
    };
  });
  const { deliveryBudget } = require('../src/services/delivery-budget.service');
  const releases = [];
  t.mock.method(deliveryBudget, 'releaseUnstarted', async (...args) => releases.push(args));
  const firstResult = response();
  const first = controller.createPayment(request, firstResult);
  await started;
  const result = response();
  await controller.createPayment(
    {
      ...request,
      body: { ...request.body, pickupPhotoId: '33333333-3333-4333-8333-333333333333' },
    },
    result,
  );
  assert.equal(result.statusCode, 409);
  assert.equal(result.body.code, 'PICKUP_PHOTO_REQUEST_CHANGED');
  assert.deepEqual(releases, []);
  assert.equal(state.photoReservations.length, 1);
  finishPayment();
  await first;
  assert.equal(state.charges.length, 1);
  assert.equal(firstResult.statusCode, 200);
});

test('expired/foreign photos and unsupported printers never create a payment', async (t) => {
  const { state, controller, request, checkout } = controllerHarness(t);
  checkout.effectiveFulfillmentType = checkout.orderType = 'pickup';
  request.body.pickupPhotoId = '22222222-2222-4222-8222-222222222222';
  const { deliveryBudget } = require('../src/services/delivery-budget.service');
  const releases = [];
  t.mock.method(deliveryBudget, 'releaseUnstarted', async (...args) => releases.push(args));
  for (const [reason, code] of [
    ['photo_unavailable', 'PICKUP_PHOTO_EXPIRED'],
    ['printer_unavailable', 'PICKUP_PHOTO_PRINTER_UNAVAILABLE'],
    ['request_changed', 'PICKUP_PHOTO_REQUEST_CHANGED'],
  ]) {
    state.photoError = reason;
    const result = response();
    await controller.createPayment(request, result);
    assert.equal(result.body.code, code);
    assert.equal(state.charges.length, 0);
    assert.equal(state.pricingCalls, 0, 'photo is verified before any price/delivery/bonus hold');
    assert.deepEqual(releases, [], 'a rejected photo cannot release another process payment hold');
  }
});

test('delivery rejects a photo before any bank call', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  request.body.pickupPhotoId = '22222222-2222-4222-8222-222222222222';
  const result = response();
  await controller.createPayment(request, result);
  assert.equal(result.body.code, 'PICKUP_PHOTO_PICKUP_ONLY');
  assert.equal(state.charges.length, 0);
  assert.equal(state.photoReservations.length, 0);
});

test('an existing checkout cannot replace its photo or pay again', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  state.existing = {
    amount: 35,
    payment_method: 'forte_card',
    provider_payment_system: 'forte_widget',
    pickup_photo_id: '22222222-2222-4222-8222-222222222222',
  };
  request.body.pickupPhotoId = '33333333-3333-4333-8333-333333333333';
  const result = response();
  await controller.createPayment(request, result);
  assert.equal(result.body.code, 'PICKUP_PHOTO_REQUEST_CHANGED');
  assert.equal(state.charges.length, 0);
  assert.equal(state.validations, 0);
  request.body.pickupPhotoId = state.existing.pickup_photo_id;
  const retry = response();
  await controller.createPayment(request, retry);
  assert.equal(retry.body.amount, 35);
  assert.equal(state.charges.length, 0);
});

test('quote and payment charge exactly the displayed delivery fee, not the later provider price', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  assert.equal(quote.statusCode, 200);
  assert.equal(quote.body.total, 1035);
  assert.equal(quote.body.deliveryFee, 1000);
  state.courierFee = 1500;
  const payment = response();
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 200);
  assert.equal(payment.body.amount, 1035);
  assert.equal(state.charges[0].deliveryFee, 1000);
  assert.equal(state.quoteCalls, 1);
});

test('a valid quoted payment cannot charge a saved card after other orders reserve the remaining budget', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  const { deliveryBudget, budgetError } = require('../src/services/delivery-budget.service');
  t.mock.method(deliveryBudget, 'reserve', async () => {
    throw budgetError();
  });
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 503);
  assert.equal(payment.body.code, 'DELIVERY_TEMPORARILY_UNAVAILABLE');
  assert.equal(state.charges.length, 0);
});

test('a changed displayed total stops checkout before any bank payment is created', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  request.body.expectedTotal = quote.body.total - 1;
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 409);
  assert.equal(payment.body.code, 'CHECKOUT_QUOTE_CHANGED');
  assert.equal(state.charges.length, 0);
});

test('a failed payment preflight releases the unused delivery reservation', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  const { deliveryBudget } = require('../src/services/delivery-budget.service');
  state.preflightFailure = Object.assign(new Error('Saved card is no longer available'), {
    statusCode: 409,
  });
  const released = [];
  t.mock.method(deliveryBudget, 'releaseUnstarted', async (...args) => {
    released.push(args);
  });
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 409);
  assert.equal(state.charges.length, 0);
  assert.deepEqual(released, [[request.customerAuth.id, request.body.checkoutId]]);
});

test('missing quote is rejected before reserving goods or charging a saved card', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 409);
  assert.equal(payment.body.code, 'CHECKOUT_QUOTE_CHANGED');
  assert.equal(state.charges.length, 0);
});

test('an unconfirmed probe cancellation cannot charge a previously quoted saved card', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  assert.equal(quote.statusCode, 200);
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  state.probeBlocked = true;
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 503);
  assert.equal(state.charges.length, 0);
});

test('confirmed bonuses reduce the goods charge while the delivery stays payable by card', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  state.bonusAvailable = 100;
  request.body.useBonuses = true;
  const quote = response();
  await controller.quotePayment(request, quote);
  assert.equal(quote.statusCode, 200);
  assert.equal(quote.body.bonusSpent, 17);
  request.body.expectedBonusSpent = quote.body.bonusSpent;
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 200);
  assert.equal(state.charges[0].total, 1018);
  assert.equal(state.charges[0].deliveryFee, 1000);
  assert.equal(state.charges[0].bonusSpent, 17);
});

test('global funds stop rejects a previously quoted delivery without charging the saved card', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const quote = response();
  await controller.quotePayment(request, quote);
  assert.equal(quote.statusCode, 200);
  request.body.deliveryQuoteToken = quote.body.deliveryQuoteToken;
  state.fundsBlocked = true;
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 503);
  assert.equal(payment.body.code, 'DELIVERY_TEMPORARILY_UNAVAILABLE');
  assert.equal(state.charges.length, 0);
});

test('retry returns the existing payment even with an expired quote and slot', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  state.existing = {
    payment_method: 'forte_card',
    provider_payment_system: 'forte_widget',
    amount: 1035,
  };
  request.body.deliveryQuoteToken = 'expired-token';
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 200);
  assert.equal(payment.body.amount, 1035);
  assert.equal(payment.body.operationId, 'same-operation');
  assert.equal(state.charges.length, 0);
  assert.equal(state.validations, 0);
});

test('saved order and customer details keep the charged fee while provider overage stays private', () => {
  const service = require('../src/services/order-payment-state.service');
  const { normalizeOrder } = require('../src/services/customer-order.service');
  const saved = service.orderRecord({
    customerId: 'customer',
    operationId: 'operation',
    pricing: { subtotal: 35, discount: 0, deliveryFee: 1000, total: 1035 },
    cartItems: [{ id: 'bun', name: 'Булочка', quantity: 1, price: 35 }],
    checkout: { orderType: 'delivery', effectiveFulfillmentType: 'delivery' },
  });
  assert.equal(saved.delivery_fee, 1000);
  assert.equal(saved.amount, 1035);
  const visible = normalizeOrder({
    ...saved,
    id: 'order',
    delivery_jobs: [
      {
        id: 'job',
        provider_price: 1500,
        provider_status: 'performer_found',
        courier_name: 'Курьер',
      },
    ],
  });
  assert.equal(visible.deliveryFee, 1000);
  assert.equal(visible.amount, 1035);
  assert.equal(visible.courier.name, 'Курьер');
  assert.equal(Object.hasOwn(visible, 'providerDeliveryPrice'), false);
});

test('checkout quote calls check-price only and sends the same full address and cargo requirements', async (t) => {
  const values = {
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_API_TOKEN: 'test-token',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001112233',
    YANDEX_DELIVERY_MAX_PRICE_KZT: '5000',
  };
  for (const [key, value] of Object.entries(values)) {
    const before = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (before === undefined) delete process.env[key];
      else process.env[key] = before;
    });
  }
  let calls = 0;
  install(t, 'node-fetch', async (url, options) => {
    calls++;
    assert.equal(new URL(url).pathname, '/b2b/cargo/integration/v2/check-price');
    const body = JSON.parse(options.body);
    assert.deepEqual(body.route_points[1].coordinates, [51.16, 43.69]);
    assert.equal(body.route_points[1].fullname, 'Актау, 34 микрорайон, дом 14');
    assert.ok(body.requirements.cargo_options.includes('auto_courier'));
    assert.ok(body.requirements.cargo_options.includes('thermobag'));
    assert.equal(body.skip_door_to_door, false);
    return {
      ok: true,
      text: async () => JSON.stringify({ price: '1000.25', currency_rules: { code: 'KZT' } }),
    };
  });
  install(t, '../src/config/supabase', {
    supabase: {
      from() {
        assert.fail('estimation must not create a delivery job or order');
      },
    },
  });
  const service = fresh(t, '../src/services/yandex-delivery.service');
  const fee = await service.estimateCheckoutDelivery(
    {
      deliveryOrigin: {
        city: 'Актау',
        address: '18А микрорайон, 1',
        latitude: 43.68,
        longitude: 51.15,
      },
      deliveryAddress: {
        city: 'Актау',
        address: '34 микрорайон',
        house: '14',
        latitude: 43.69,
        longitude: 51.16,
      },
    },
    { canonicalItems: [{ id: 'bun', quantity: 1 }] },
  );
  assert.equal(fee, 1001);
  assert.equal(calls, 1);
});

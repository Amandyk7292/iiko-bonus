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
  const state = { courierFee: 1000, charges: [], existing: null, quoteCalls: 0, validations: 0 };
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
    createCheckout: async (_phone, pricing) => {
      state.charges.push(pricing);
      return { success: true, amount: pricing.total };
    },
  };
  install(t, '../src/services/forte-widget.service', payment);
  install(t, '../src/services/order-payment-state.service', {});
  install(t, '../src/services/forte.service', { existingRequest: async () => null });
  install(t, '../src/services/payment-operations.service', {
    getForteCheckoutDecision: async () => ({ effectiveIntegration: 'widget' }),
  });
  install(t, '../src/services/order.service', { priceOrder: async () => ({ ...merchandise }) });
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
  install(t, '../src/services/inventory.service', { reserveCheckout: async () => {} });
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
  return { state, controller, request };
}

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

test('missing quote is rejected before reserving goods or charging a saved card', async (t) => {
  const { state, controller, request } = controllerHarness(t);
  const payment = response();
  await controller.createPayment(request, payment);
  assert.equal(payment.statusCode, 409);
  assert.equal(payment.body.code, 'CHECKOUT_QUOTE_CHANGED');
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

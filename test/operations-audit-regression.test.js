const assert = require('node:assert/strict');
const test = require('node:test');
const Module = require('node:module');
const contexts = new WeakMap();

function service(t, name, overrides) {
  let context = contexts.get(t);
  if (!context) {
    const original = Module._load;
    context = { mocks: new Map(), previous: new Map() };
    contexts.set(t, context);
    Module._load = function (request, parent, main) {
      const mocks = context.mocks.get(parent?.filename);
      if (mocks && Object.hasOwn(mocks, request)) return mocks[request];
      return original.call(this, request, parent, main);
    };
    t.after(() => {
      Module._load = original;
      for (const [filename, previous] of context.previous) {
        if (previous) require.cache[filename] = previous;
        else delete require.cache[filename];
      }
    });
  }
  const filename = require.resolve(`../src/services/${name}`);
  context.previous.set(filename, require.cache[filename]);
  context.mocks.set(filename, overrides);
  delete require.cache[filename];
  return require(filename);
}

function memoryOrders(initial) {
  let row = structuredClone(initial);
  const db = {
    from() {
      let update;
      const predicates = [];
      const q = {
        select() {
          return q;
        },
        order() {
          return q;
        },
        or(filter) {
          if (
            filter === 'fulfillment_status.is.null,fulfillment_status.not.in.(completed,cancelled)'
          )
            predicates.push(
              (r) =>
                r.fulfillment_status == null ||
                !['completed', 'cancelled'].includes(r.fulfillment_status),
            );
          return q;
        },
        eq(key, value) {
          predicates.push((r) => r[key] === value);
          return q;
        },
        is(key, value) {
          predicates.push((r) => (r[key] ?? null) === value);
          return q;
        },
        in(key, values) {
          predicates.push((r) => values.includes(r[key]));
          return q;
        },
        update(value) {
          update = value;
          return q;
        },
        async maybeSingle() {
          if (!predicates.every((p) => p(row))) return { data: null };
          if (update) row = { ...row, ...update };
          return { data: structuredClone(row) };
        },
        async limit() {
          return { data: predicates.every((p) => p(row)) ? [structuredClone(row)] : [] };
        },
      };
      return q;
    },
  };
  return { db, read: () => row };
}

test('legacy completed Kitchen card is excluded before the active queue limit', async (t) => {
  const f = memoryOrders({
    id: 'order',
    order_number: 7,
    status: 'paid',
    fulfillment_type: 'pickup',
    fulfillment_status: 'completed',
    kitchen_status: 'ready',
    branch_id: 'branch',
    cart_items: [],
  });
  const kitchen = service(t, 'kitchen.service', {
    ...kitchenMocks,
    '../config/supabase': { supabase: f.db },
  });
  assert.deepEqual(await kitchen.listKitchenOrders({ branchId: 'branch' }), []);
});
const quiet = {
  './realtime.service': { publish() {} },
  '../utils/background-task.util': { runBackgroundTask() {} },
};
const orderMocks = {
  ...quiet,
  './order-images.service': {},
  './push.service': {},
  './order-payment-state.service': {},
  './inventory.service': {},
  './live-activity.service': {},
  './payment-receipt.service': {},
  './payment-gateway.service': {},
  './external-delivery-lifecycle.service': {},
};
const kitchenMocks = {
  ...quiet,
  './courier.service': {},
  './eta.service': {},
  './inventory.service': {},
  './delivery-orchestration.service': {},
  './admin-session.service': {},
};

test('custom weighted inventory reaches checkout pricing with correct unit and stock validation', async (t) => {
  const custom = {
    id: 'weighted',
    name: 'Cake',
    price: 5000,
    is_available: true,
    category_name: 'Cakes',
  };
  const stock = new Map([
    [custom.id, { isAvailable: true, availableQuantity: 2, quantityStep: 0.001, unit: 'кг' }],
  ]);
  const db = {
    from() {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle: async () => ({ data: { city: 'aktau', default_preparation_minutes: 15 } }),
      };
    },
  };
  const orders = service(t, 'order.service', {
    '../config/supabase': { supabase: db },
    './settings.service': {},
    './product-options.service': {},
    './commerce-marketing.service': {},
    './iiko-city-profile.service': { getIikoClientForCity: () => ({ profileKey: 'aktau' }) },
    './menu.service': {
      getProductOverrides: async () => [],
      getCategoryOverrides: async () => [],
      getCustomProducts: async () => [custom],
    },
    './inventory.service': { getBranchAvailability: async () => stock },
    './branch-catalog-source.service': {
      branchCatalogSource: async () => ({
        rawMenu: { products: [], groups: [] },
        stopIds: new Set(),
      }),
      branchProductAvailable: (s, id) => s.get(id).isAvailable,
    },
  });
  const catalog = await orders.loadOrderCatalog({ branchId: 'branch' });
  const priced = orders.calculateOrderTotal([{ id: custom.id, quantity: 0.5 }], catalog);
  assert.equal(priced.subtotal, 2500);
  assert.equal(priced.canonicalItems[0].unit, 'кг');
  assert.throws(
    () => orders.calculateOrderTotal([{ id: custom.id, quantity: 2.001 }], catalog),
    /Доступно/,
  );
  assert.throws(
    () => orders.calculateOrderTotal([{ id: custom.id, quantity: 0.0005 }], catalog),
    /Некорректная позиция/,
  );
});

for (const kitchenStatus of ['queued', 'preparing', 'ready']) {
  test(`Orders pickup completion closes ${kitchenStatus} kitchen work atomically`, async (t) => {
    const f = memoryOrders({
      id: 'order',
      order_number: 7,
      status: 'paid',
      fulfillment_type: 'pickup',
      fulfillment_status: kitchenStatus === 'queued' ? 'new' : kitchenStatus,
      kitchen_status: kitchenStatus,
      branch_id: 'branch',
      cart_items: [],
    });
    const orders = service(t, 'customer-order.service', {
      ...orderMocks,
      '../config/supabase': { supabase: f.db },
    });
    const kitchen = service(t, 'kitchen.service', {
      ...kitchenMocks,
      '../config/supabase': { supabase: f.db },
    });
    assert.equal(
      (await orders.updateAdminOrderStatus('order', 'completed')).orderStatus,
      'completed',
    );
    assert.equal(f.read().kitchen_status, 'handed_over');
    assert.ok(f.read().fulfilled_at && f.read().handed_to_courier_at);
    assert.deepEqual(await kitchen.listKitchenOrders({ branchId: 'branch' }), []);
  });
}

test('Kitchen returns actual successful refund/cancellation and never submits a second refund', async (t) => {
  const f = memoryOrders({
    id: 'order',
    status: 'paid',
    fulfillment_type: 'pickup',
    fulfillment_status: 'ready',
    kitchen_status: 'ready',
    order_number: 7,
    branch_id: 'branch',
    amount: 1000,
    refund_status: null,
    cart_items: [],
  });
  let bankCalls = 0;
  service(t, 'customer-order.service', {
    ...orderMocks,
    '../config/supabase': { supabase: f.db },
    './inventory.service': { releaseOrderReservations: async () => {} },
    './order-payment-state.service': { reverseOrderLoyalty: async (order) => order },
    './payment-gateway.service': {
      paymentProviderName: () => 'Fixture Bank',
      refundPaymentForOrder: async () => {
        bankCalls++;
        return { reference: 'local' };
      },
    },
    './external-delivery-lifecycle.service': {
      assertExternalDeliveryCancelled: async () => {},
      cancelExternalDeliveryForOrder: async () => {},
    },
  });
  const kitchen = service(t, 'kitchen.service', {
    ...kitchenMocks,
    '../config/supabase': { supabase: f.db },
  });
  const cancelled = await kitchen.updateKitchenStatus('order', 'cancelled', null, {
    cancellationReason: 'Out of stock',
  });
  assert.equal(cancelled.kitchenStatus, 'cancelled');
  assert.equal(f.read().status, 'refunded');
  assert.equal(f.read().refund_status, 'succeeded');
  await kitchen.updateKitchenStatus('order', 'cancelled');
  assert.equal(bankCalls, 1);
});

test('GPS preserves break, busy and offline dispatcher selections', async (t) => {
  let courier;
  const db = {
    from(table) {
      let changes;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        not() {
          return q;
        },
        order() {
          return q;
        },
        limit() {
          return q;
        },
        update(value) {
          changes = value;
          return q;
        },
        async maybeSingle() {
          if (table === 'couriers') {
            Object.assign(courier, changes);
            return { data: { ...courier } };
          }
          return { data: { created_at: new Date().toISOString() } };
        },
        then(resolve, reject) {
          return Promise.resolve({ data: [] }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const couriers = service(t, 'courier.service', {
    ...quiet,
    '../config/supabase': { supabase: db },
    './otpStore.service': {},
    './push.service': {},
    './live-activity.service': {},
    './eta.service': {},
  });
  for (const status of ['break', 'busy', 'offline']) {
    courier = { id: 'courier', active: true, availability_status: status };
    const updated = await couriers.updateCourierLocation('courier', 43.65, 51.15);
    assert.equal(updated.availabilityStatus, status);
    assert.equal(courier.availability_status, status);
    assert.equal(courier.current_latitude, 43.65);
    assert.ok(courier.location_updated_at);
  }
});

test('receipt polling selects runnable job21 before limiting the page', async (t) => {
  const blocked = Array.from({ length: 20 }, (_, n) => ({
    order_id: `blocked-${n}`,
    fiscal_due: true,
    kaspi_orders: {
      status: 'paid',
      refund_status: null,
      order_number: n,
      delivery_resolution: { status: 'pending' },
    },
  }));
  const eligible = {
    order_id: 'eligible',
    fiscal_due: true,
    kaspi_orders: {
      status: 'paid',
      refund_status: null,
      order_number: 21,
      delivery_resolution: null,
    },
  };
  const db = {
    from() {
      let rows = [...blocked, eligible];
      let limit;
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        neq() {
          return q;
        },
        order() {
          return q;
        },
        or(filter, options) {
          if (
            options?.referencedTable === 'kaspi_orders' &&
            filter.includes('delivery_resolution->>status')
          ) {
            const statuses = filter.match(/not\.in\.\(([^)]+)\)/)[1].split(',');
            rows = rows.filter(
              (r) => !statuses.includes(r.kaspi_orders.delivery_resolution?.status),
            );
          }
          return q;
        },
        limit(value) {
          limit = value;
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: rows.slice(0, limit) }).then(resolve, reject);
        },
      };
      return q;
    },
  };
  const receipts = service(t, 'front-auto-receipt.service', {
    '../config/supabase': { supabase: db },
    './front-stock-guard.service': {},
  });
  assert.deepEqual(
    (
      await receipts.listAutoReceipts('branch', { terminalId: 'terminal', assemblyVersion: 1 })
    ).jobs.map((job) => job.orderId),
    ['eligible'],
  );
});

test('receipt PostgREST request retains both refund and delivery-resolution filters', async (t) => {
  const { createClient } = require('@supabase/supabase-js');
  let request;
  const db = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        request = new URL(typeof input === 'string' ? input : input.url);
        return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  const receipts = service(t, 'front-auto-receipt.service', {
    '../config/supabase': { supabase: db },
    './front-stock-guard.service': {},
  });
  await receipts.listAutoReceipts('branch', { terminalId: 'terminal', assemblyVersion: 1 });
  const conditions = request.searchParams.get('kaspi_orders.or');
  assert.match(conditions, /^\(and\(or\(refund_status\.is\.null,/);
  assert.match(conditions, /refund_status\.in\.\(partial,failed\)/);
  assert.match(
    conditions,
    /or\(delivery_resolution->>status\.is\.null,delivery_resolution->>status\.not\.in\./,
  );
  assert.equal(request.searchParams.get('limit'), '20');
});

test('automatic dispatch retries the next candidate only after an atomic capacity/unavailable rejection', async (t) => {
  const order = {
    id: 'order',
    branch_id: 'branch',
    status: 'paid',
    fulfillment_type: 'delivery',
    delivery_status: 'unassigned',
    courier_id: null,
    bulka_locations: { latitude: 43, longitude: 51 },
    delivery_latitude: 44,
    delivery_longitude: 51,
  };
  const couriers = ['first', 'second'].map((id) => ({
    id,
    name: id,
    active: true,
    transport_type: 'car',
    availability_status: 'available',
    max_active_orders: 1,
    current_latitude: 43,
    current_longitude: 51,
    location_updated_at: new Date().toISOString(),
  }));
  const db = {
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        not() {
          return q;
        },
        in() {
          return q;
        },
        order() {
          return q;
        },
        then(resolve, reject) {
          return Promise.resolve({ data: table === 'couriers' ? couriers : [order] }).then(
            resolve,
            reject,
          );
        },
      };
      return q;
    },
  };
  const attempts = [];
  const dispatch = service(t, 'dispatch.service', {
    '../config/supabase': { supabase: db },
    './courier.service': {
      assignCourier: async (_id, courierId, _eta, options) => {
        attempts.push(courierId);
        assert.deepEqual(options.branchIds, ['branch']);
        if (courierId === 'first')
          throw Object.assign(new Error('full'), { code: 'COURIER_CAPACITY_REACHED' });
        return { ...order, courier_id: courierId };
      },
    },
    './eta.service': { distanceKm: () => 1, refreshOrderEta: async (row) => row },
    './yandex-delivery.service': {
      getConfigurationStatus: () => ({}),
      listJobsForOrders: async () => new Map(),
    },
  });
  const assigned = await dispatch.autoAssignOrder('order', { branchIds: ['branch'] });
  assert.deepEqual(attempts, ['first', 'second']);
  assert.equal(assigned.courier.id, 'second');
});

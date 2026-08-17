const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  buildClaimPayload,
  buildQuotePayload,
  getConfigurationStatus,
  isTerminalStatus,
  mapYandexStatus,
  normalizeCity,
  normalizeDeliveryJob,
  validateDeliveryOrder,
} = require('../src/services/yandex-delivery.service');
const { dispatchAcceptedDeliveryOrder } = require('../src/services/delivery-orchestration.service');

function installModule(t, modulePath, exports) {
  const resolved = require.resolve(modulePath);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

const config = {
  senderName: 'Bulka',
  senderPhone: '+77001234567',
  country: 'Казахстан',
  taxiClass: 'courier',
  cargoOptions: ['thermobag'],
  skipConfirmation: true,
  defaultItem: { length: 0.3, width: 0.25, height: 0.15, weight: 0.5 },
};

const order = {
  id: '11111111-1111-4111-8111-111111111111',
  order_number: 100042,
  status: 'paid',
  fulfillment_status: 'ready',
  fulfillment_type: 'delivery',
  courier_dispatch_requested_at: '2026-07-20T09:59:00.000Z',
  amount: 2590,
  phone: '+77009998877',
  cart_items: [{ id: 'cake-1', name: 'Торт Bulka', quantity: 2, price: 1295 }],
  delivery_address: {
    city: 'Актау',
    address: '17-й микрорайон, дом 34',
    entrance: '2',
    floor: '4',
    apartment: '18',
    comment: 'Позвонить заранее',
  },
  delivery_latitude: 43.6512,
  delivery_longitude: 51.1978,
  customers: { name: 'Аружан', phone: '+77009998877' },
  bulka_locations: {
    name: 'ЖК Дукат',
    city: 'Актау',
    address: '17-й микрорайон, 1',
    latitude: 43.6499,
    longitude: 51.2011,
  },
};

test('Yandex quote payload keeps coordinates in longitude-latitude order', () => {
  const payload = buildQuotePayload(order, config);
  assert.deepEqual(payload.route_points[0].coordinates, [51.2011, 43.6499]);
  assert.deepEqual(payload.route_points[1].coordinates, [51.1978, 43.6512]);
  assert.equal(payload.items[0].dropoff_point, 2);
  assert.equal(payload.requirements.taxi_class, 'courier');
  assert.deepEqual(payload.requirements.cargo_options, ['thermobag', 'auto_courier']);
  assert.equal(payload.requirements.assign_robot, false);
});

test('Yandex claim payload contains contacts, address details and API-compatible item fields', () => {
  const payload = buildClaimPayload(order, config);
  assert.equal(payload.route_points[0].contact.phone, '+77001234567');
  assert.equal(payload.route_points[1].contact.phone, '+77009998877');
  assert.equal(payload.route_points[1].address.porch, '2');
  assert.equal(payload.route_points[1].address.sfloor, '4');
  assert.equal(payload.route_points[1].address.sflat, '18');
  assert.equal(payload.route_points[1].external_order_cost.currency, 'KZT');
  assert.equal(payload.items[0].droppof_point, 2);
  assert.equal(payload.items[0].cost_currency, 'KZT');
  assert.equal(payload.skip_client_notify, false);
  assert.match(payload.route_points[0].address.comment, /Торт Bulka × 2/);
  assert.match(payload.route_points[0].address.comment, /Только автокурьер/);
  assert.deepEqual(payload.client_requirements.cargo_options, ['thermobag', 'auto_courier']);
  assert.equal(payload.client_requirements.assign_robot, false);
});

test('delivery validation matches the saved address city to the branch and prefers the registered app phone', () => {
  assert.equal(normalizeCity('г. Актау'), 'актау');
  assert.equal(normalizeCity('Актау'), 'актау');
  const candidate = {
    ...order,
    phone: '+77001112222',
    additional_phone: '+77003334455',
    customers: { name: 'Аружан', phone: '+77009998877' },
  };
  const validated = validateDeliveryOrder(candidate, config);
  assert.equal(validated.customerPhone, '+77009998877');
  assert.equal(validated.destination.city, 'Актау');
});

test('delivery validation fails closed on a city mismatch before a provider call', () => {
  assert.throws(
    () =>
      buildClaimPayload(
        {
          ...order,
          delivery_address: { ...order.delivery_address, city: 'Астана' },
        },
        config,
      ),
    (error) =>
      error.code === 'DELIVERY_CITY_MISMATCH' &&
      error.retryable === false &&
      /Актау/.test(error.message) &&
      /Астана/.test(error.message),
  );
});

test('delivery validation requires an explicit city in the saved destination address', () => {
  assert.throws(
    () =>
      buildClaimPayload(
        {
          ...order,
          delivery_address: { address: '17-й микрорайон, дом 34' },
        },
        config,
      ),
    (error) => error.code === 'DELIVERY_CITY_REQUIRED' && error.retryable === false,
  );
});

test('Yandex statuses map to Bulka delivery lifecycle', () => {
  assert.equal(mapYandexStatus('performer_found'), 'assigned');
  assert.equal(mapYandexStatus('pickuped'), 'picked_up');
  assert.equal(mapYandexStatus('delivery_arrived'), 'en_route');
  assert.equal(mapYandexStatus('delivered_finish'), 'delivered');
  assert.equal(mapYandexStatus('performer_not_found'), 'cancelled');
  assert.equal(isTerminalStatus('cancelled_with_payment'), true);
  assert.equal(isTerminalStatus('performer_lookup'), false);
});

test('external delivery is normalized for the Russian admin interface', () => {
  const normalized = normalizeDeliveryJob({
    id: 'job-1',
    provider: 'yandex',
    external_claim_id: 'claim-1',
    provider_status: 'performer_found',
    internal_status: 'assigned',
    provider_price: '890.00',
    currency: 'KZT',
    courier_name: 'Ерлан',
    courier_car_model: 'Toyota Camry',
    courier_car_number: '123 ABC 12',
    created_at: '2026-07-20T10:00:00.000Z',
    updated_at: '2026-07-20T10:01:00.000Z',
  });
  assert.equal(normalized.statusLabel, 'Курьер назначен');
  assert.equal(normalized.price, 890);
  assert.equal(normalized.courier.name, 'Ерлан');
  assert.match(normalized.courier.vehicle, /Toyota Camry/);
  assert.equal(normalized.courier.isAutomobile, true);
  assert.equal(normalized.transportWarning, null);
});

test('accepted delivery prefers opt-in Yandex dispatch over an internal courier', async () => {
  const calls = [];
  const yandexDelivery = {
    getConfigurationStatus: () => ({ configured: true, autoDispatch: true }),
    dispatchOrder: async (orderId) => {
      calls.push(`yandex:${orderId}`);
      return { claimId: 'claim-1' };
    },
  };
  const dispatchService = {
    autoAssignOrder: async (orderId) => calls.push(`internal:${orderId}`),
  };

  const result = await dispatchAcceptedDeliveryOrder(
    { ...order, delivery_status: 'unassigned', courier_id: null },
    { yandexDelivery, dispatchService },
  );

  assert.equal(result.provider, 'yandex');
  assert.deepEqual(calls, [`yandex:${order.id}`]);
});

test('automatic dispatch validates the destination before calling Yandex', async () => {
  const calls = [];
  await assert.rejects(
    () =>
      dispatchAcceptedDeliveryOrder(
        {
          ...order,
          delivery_status: 'unassigned',
          courier_id: null,
          delivery_address: { ...order.delivery_address, city: 'Астана' },
        },
        {
          yandexDelivery: {
            getConfigurationStatus: () => ({ configured: true, autoDispatch: true }),
            validateDeliveryOrder: (candidate) => validateDeliveryOrder(candidate, config),
            dispatchOrder: async () => calls.push('yandex'),
          },
          dispatchService: {
            autoAssignOrder: async () => calls.push('internal'),
          },
        },
      ),
    (error) => error.code === 'DELIVERY_CITY_MISMATCH' && error.retryable === false,
  );
  assert.deepEqual(calls, []);
});

test('accepted delivery keeps the internal dispatcher when Yandex auto-dispatch is disabled', async () => {
  const calls = [];
  const result = await dispatchAcceptedDeliveryOrder(
    { ...order, delivery_status: 'unassigned', courier_id: null },
    {
      yandexDelivery: {
        getConfigurationStatus: () => ({ configured: true, autoDispatch: false }),
        dispatchOrder: async () => calls.push('yandex'),
      },
      dispatchService: {
        autoAssignOrder: async (orderId) => {
          calls.push(`internal:${orderId}`);
          return { courier: { id: 'courier-1' } };
        },
      },
    },
  );

  assert.equal(result.provider, 'internal');
  assert.deepEqual(calls, [`internal:${order.id}`]);
});

test('an uncertain Yandex failure never falls back to a second courier provider', async () => {
  const calls = [];
  await assert.rejects(
    () =>
      dispatchAcceptedDeliveryOrder(
        { ...order, delivery_status: 'unassigned', courier_id: null },
        {
          yandexDelivery: {
            getConfigurationStatus: () => ({ configured: true, autoDispatch: true }),
            dispatchOrder: async () => {
              calls.push('yandex');
              throw new Error('provider timeout');
            },
          },
          dispatchService: {
            autoAssignOrder: async () => calls.push('internal'),
          },
        },
      ),
    /provider timeout/,
  );
  assert.deepEqual(calls, ['yandex']);
});

test('automatic dispatch skips an order that already has a delivery lifecycle', async () => {
  const result = await dispatchAcceptedDeliveryOrder({
    ...order,
    delivery_status: 'assigned',
    courier_id: null,
  });
  assert.deepEqual(result, { skipped: true, reason: 'already_dispatched' });
});

test('payment alone never calls a courier before kitchen acceptance', async () => {
  const calls = [];
  const result = await dispatchAcceptedDeliveryOrder(
    { ...order, courier_dispatch_requested_at: null },
    {
      yandexDelivery: {
        getConfigurationStatus: () => ({ configured: true, autoDispatch: true }),
        dispatchOrder: async () => calls.push('yandex'),
      },
      dispatchService: { autoAssignOrder: async () => calls.push('internal') },
    },
  );
  assert.deepEqual(result, { skipped: true, reason: 'not_accepted' });
  assert.deepEqual(calls, []);
});

test('Yandex configuration reports the automatic dispatch switch', () => {
  const status = getConfigurationStatus({
    YANDEX_DELIVERY_ENABLED: 'true',
    YANDEX_DELIVERY_AUTO_DISPATCH: 'true',
    YANDEX_DELIVERY_API_TOKEN: 'token-value',
    YANDEX_DELIVERY_SENDER_PHONE: '+77001234567',
  });
  assert.equal(status.configured, true);
  assert.equal(status.autoDispatch, true);
  assert.equal(status.automobileOnly, true);
  assert.deepEqual(status.cargoOptions, ['auto_courier', 'thermobag']);
});

test('canonical Yandex delivery migration contains the required constraints', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260720090000_yandex_delivery.sql'),
    'utf8',
  );
  assert.match(migration, /delivery_jobs_one_active_per_order_idx/);
  assert.match(migration, /client_request_id uuid not null/);
});

test('terminal Yandex delivery projection stays retryable after a transient failure', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'services', 'yandex-delivery.service.js'),
    'utf8',
  );
  assert.doesNotMatch(source, /updateAdminOrderStatus\(job\.order_id, 'completed'\)\.catch/);
  assert.match(
    source,
    /if \(internalStatus === 'delivered'\) \{[\s\S]*?updateOrderFromJob\([\s\S]*?updateJob\(job\.id, updates\)/,
  );
  assert.match(
    source,
    /\.in\('internal_status', \['delivered', 'cancelled'\]\)[\s\S]*?\.not\('last_error'/,
  );
  assert.match(
    source,
    /if \(isTerminalStatus\(job\.provider_status\)\) \{[\s\S]*?updateOrderFromJob\(job, \{\}\)[\s\S]*?last_error: null/,
  );
});

test('Yandex completion retries the same job after a transient order failure', async (t) => {
  const state = {
    order: {
      id: order.id,
      order_number: order.order_number,
      customer_id: 'customer-1',
      branch_id: 'branch-1',
      fulfillment_status: 'ready',
      delivery_status: 'en_route',
      courier_assigned_at: '2026-08-08T09:00:00.000Z',
      handed_to_courier_at: '2026-08-08T09:10:00.000Z',
      out_for_delivery_at: '2026-08-08T09:20:00.000Z',
      delivered_at: null,
    },
    job: {
      id: 'delivery-job-1',
      order_id: order.id,
      provider: 'yandex',
      external_claim_id: 'claim-1',
      provider_status: 'delivery_arrived',
      internal_status: 'en_route',
      external_version: 4,
      last_error: null,
      last_synced_at: '2026-08-08T09:20:00.000Z',
    },
  };
  let insertCalls = 0;
  const fakeSupabase = {
    async rpc(name, args) {
      assert.equal(name, 'project_yandex_delivery_status');
      assert.equal(args.p_job_id, state.job.id);
      assert.equal(args.p_expected_provider_status, state.job.provider_status);
      state.job.internal_status = args.p_internal_status;
      state.order.delivery_status =
        args.p_internal_status === 'cancelled' ? 'unassigned' : args.p_internal_status;
      return { data: { ...state.job }, error: null };
    },
    from(table) {
      let action = 'select';
      let payload = null;
      const run = async () => {
        const target = table === 'kaspi_orders' ? state.order : state.job;
        if (action === 'update') Object.assign(target, payload);
        if (action === 'insert') insertCalls += 1;
        return { data: { ...target }, error: null };
      };
      const builder = {
        select() {
          return builder;
        },
        update(value) {
          action = 'update';
          payload = value;
          return builder;
        },
        insert(value) {
          action = 'insert';
          payload = value;
          return builder;
        },
        eq() {
          return builder;
        },
        is() {
          return builder;
        },
        maybeSingle: run,
        single: run,
        then(resolve, reject) {
          return run().then(resolve, reject);
        },
      };
      return builder;
    },
  };

  installModule(t, '../src/config/supabase', { supabase: fakeSupabase });
  installModule(t, '../src/services/realtime.service', { publish: () => undefined });
  let completionCalls = 0;
  installModule(t, '../src/services/customer-order.service', {
    updateAdminOrderStatus: async (orderId, nextStatus) => {
      assert.equal(orderId, order.id);
      assert.equal(nextStatus, 'completed');
      completionCalls += 1;
      if (completionCalls === 1) throw new Error('transient order completion failure');
      state.order.fulfillment_status = 'completed';
    },
  });
  installModule(t, 'node-fetch', async () => ({
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        status: 'delivered_finish',
        version: 5,
        route_points: [],
        performer_info: {},
      }),
  }));

  const envKeys = [
    'YANDEX_DELIVERY_ENABLED',
    'YANDEX_DELIVERY_API_TOKEN',
    'YANDEX_DELIVERY_SENDER_PHONE',
  ];
  const previousEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  process.env.YANDEX_DELIVERY_ENABLED = 'true';
  process.env.YANDEX_DELIVERY_API_TOKEN = 'test-token';
  process.env.YANDEX_DELIVERY_SENDER_PHONE = '+77001234567';
  t.after(() => {
    for (const key of envKeys) {
      if (previousEnv[key] === undefined) delete process.env[key];
      else process.env[key] = previousEnv[key];
    }
  });

  const servicePath = require.resolve('../src/services/yandex-delivery.service');
  const previousService = require.cache[servicePath];
  delete require.cache[servicePath];
  t.after(() => {
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  const service = require(servicePath);

  await assert.rejects(
    service.syncDeliveryJob({ ...state.job }),
    /transient order completion failure/,
  );
  assert.equal(state.job.provider_status, 'delivery_arrived');
  // The active job keeps its reservation while durably publishing the exact
  // order projection that the DB guard will permit on the retry.
  assert.equal(state.job.internal_status, 'delivered');
  assert.match(state.job.last_error, /transient order completion failure/);

  const completed = await service.syncDeliveryJob({ ...state.job });
  assert.equal(completed.status, 'delivered_finish');
  assert.equal(completed.deliveryStatus, 'delivered');
  assert.equal(completed.lastError, null);
  assert.equal(state.order.fulfillment_status, 'completed');
  assert.equal(completionCalls, 2);
  assert.equal(insertCalls, 0);
});

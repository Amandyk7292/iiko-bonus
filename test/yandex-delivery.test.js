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
  normalizeDeliveryJob,
} = require('../src/services/yandex-delivery.service');
const { dispatchPaidDeliveryOrder } = require('../src/services/kaspi.service');

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
  assert.deepEqual(payload.requirements.cargo_options, ['thermobag']);
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
});

test('automatic Yandex dispatch is opt-in and preferred over an internal courier', async () => {
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

  const result = await dispatchPaidDeliveryOrder(
    { ...order, delivery_status: 'unassigned', courier_id: null },
    { yandexDelivery, dispatchService },
  );

  assert.equal(result.provider, 'yandex');
  assert.deepEqual(calls, [`yandex:${order.id}`]);
});

test('paid delivery keeps the internal dispatcher when Yandex auto-dispatch is disabled', async () => {
  const calls = [];
  const result = await dispatchPaidDeliveryOrder(
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
      dispatchPaidDeliveryOrder(
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
  const result = await dispatchPaidDeliveryOrder({
    ...order,
    delivery_status: 'assigned',
    courier_id: null,
  });
  assert.deepEqual(result, { skipped: true, reason: 'already_dispatched' });
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
});

test('canonical Yandex delivery migration contains the required constraints', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260720090000_yandex_delivery.sql',
    ),
    'utf8',
  );
  assert.match(migration, /delivery_jobs_one_active_per_order_idx/);
  assert.match(migration, /client_request_id uuid not null/);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  isPointInPolygon,
  normalizeSchedule,
  validateCheckout,
} = require('../src/services/checkout.service');
const {
  eligibleOrderAmount,
  pendingReconciliationWindowMs,
  paymentStatusCanTransition,
} = require('../src/services/kaspi.service');
const {
  canMarkCustomerArrived,
  normalizeOrder,
} = require('../src/services/customer-order.service');
const { slotHorizonDays, timezoneOffsetMinutes } = require('../src/services/slot.service');

const primaryBranchId = '11111111-1111-4111-8111-111111111111';
const branchHours = { daily: { open: '08:00', close: '21:00' } };
const cities = [
  {
    id: 'aktau',
    name: 'Актау',
    points: [
      {
        id: primaryBranchId,
        name: 'ТЦ Ardager',
        address: '9-й микрорайон, 30/3',
        latitude: 43.6532,
        longitude: 51.1975,
        hours: branchHours,
        active: true,
        pickupEnabled: true,
        preorderEnabled: true,
        deliveryEnabled: true,
        deliveryRadiusKm: 10,
        deliveryFee: 700,
        deliveryMinOrder: 3000,
      },
      {
        id: '22222222-2222-4222-8222-222222222222',
        name: 'ЖК Premium Plaza',
        address: '18A микрорайон, 1',
        latitude: 43.6419,
        longitude: 51.1707,
        hours: branchHours,
        active: true,
        pickupEnabled: true,
        preorderEnabled: true,
        deliveryEnabled: false,
      },
    ],
  },
];

const env = {
  ORDER_TIMEZONE_OFFSET_MINUTES: '300',
  ORDER_MIN_LEAD_MINUTES: '10',
  PREORDER_MIN_LEAD_MINUTES: '120',
};

test('pickup checkout validates a real branch and normalizes Aktau local time to UTC', () => {
  const checkout = validateCheckout(
    {
      orderType: 'pickup',
      branchId: primaryBranchId,
      pickupTime: '2026-07-13T18:00:00',
      additionalPhone: '8 777 123 45 67',
    },
    cities,
    { now: new Date('2026-07-13T12:00:00.000Z'), env },
  );

  assert.equal(checkout.orderType, 'pickup');
  assert.equal(checkout.branchId, primaryBranchId);
  assert.equal(checkout.branch, 'ТЦ Ardager, 9-й микрорайон, 30/3');
  assert.equal(checkout.scheduledAt, '2026-07-13T13:00:00.000Z');
  assert.equal(checkout.additionalPhone, '+77771234567');
  assert.equal(checkout.deliveryFee, 0);
});

test('delivery uses only an enabled branch with explicit radius and tariffs', () => {
  const checkout = validateCheckout(
    {
      orderType: 'delivery',
      deliveryAddress: {
        city: 'Актау',
        address: '11-й микрорайон, дом 25',
        latitude: 43.654,
        longitude: 51.198,
        entrance: '2',
        apartment: '41',
      },
      scheduledAt: '2026-07-13T18:00:00+05:00',
    },
    cities,
    { now: new Date('2026-07-13T12:00:00.000Z'), env },
  );

  assert.equal(checkout.orderType, 'delivery');
  assert.equal(checkout.branchId, primaryBranchId);
  assert.equal(checkout.scheduledAt, '2026-07-13T13:00:00.000Z');
  assert.equal(checkout.deliveryFee, 700);
  assert.equal(checkout.deliveryMinimumOrder, 3000);
  assert.equal(checkout.deliveryAddress.apartment, '41');
});

test('delivery selects the first matching tariff zone by real distance', () => {
  const zonedCities = structuredClone(cities);
  zonedCities[0].points[0].deliveryZones = [
    { id: 'near', radiusKm: 1, fee: 300, minOrder: 2000, color: '#66BB6A' },
    { id: 'far', radiusKm: 5, fee: 700, minOrder: 3000, color: '#29B6F6' },
  ];

  const near = validateCheckout(
    {
      orderType: 'delivery',
      deliveryAddress: {
        city: 'Актау',
        address: 'Рядом с филиалом',
        latitude: 43.654,
        longitude: 51.198,
      },
      scheduledAt: '2026-07-13T18:00:00+05:00',
    },
    zonedCities,
    { now: new Date('2026-07-13T12:00:00.000Z'), env },
  );
  const far = validateCheckout(
    {
      orderType: 'delivery',
      deliveryAddress: {
        city: 'Актау',
        address: 'Внешнее кольцо',
        latitude: 43.675,
        longitude: 51.1975,
      },
      scheduledAt: '2026-07-13T18:00:00+05:00',
    },
    zonedCities,
    { now: new Date('2026-07-13T12:00:00.000Z'), env },
  );

  assert.equal(near.deliveryFee, 300);
  assert.equal(near.deliveryMinimumOrder, 2000);
  assert.equal(near.deliveryZone.id, 'near');
  assert.equal(far.deliveryFee, 700);
  assert.equal(far.deliveryMinimumOrder, 3000);
  assert.equal(far.deliveryZone.id, 'far');
});

test('delivery rejects coordinates outside every configured branch radius', () => {
  const polygon = [
    [43.62, 51.12],
    [43.69, 51.118],
    [43.721, 51.197],
    [43.686, 51.285],
    [43.612, 51.279],
    [43.59, 51.19],
  ];
  assert.equal(isPointInPolygon(43.6532, 51.1975, polygon), true);
  assert.equal(isPointInPolygon(43.8, 51.5, polygon), false);
  assert.throws(
    () =>
      validateCheckout(
        {
          orderType: 'delivery',
          deliveryAddress: {
            city: 'Актау',
            address: 'Адрес вне зоны',
            latitude: 44.8,
            longitude: 52.5,
          },
        },
        cities,
        { now: new Date('2026-07-13T12:00:00.000Z'), env },
      ),
    /вне зоны доставки/,
  );
});

test('preorder enforces lead time and the selected branch hours', () => {
  assert.throws(
    () =>
      normalizeSchedule(
        '2026-07-13T19:00:00+05:00',
        'preorder',
        new Date('2026-07-13T13:00:00.000Z'),
        env,
        branchHours,
      ),
    /доступное время/,
  );
  assert.equal(
    normalizeSchedule(
      '2026-07-14T09:00:00+05:00',
      'preorder',
      new Date('2026-07-13T13:00:00.000Z'),
      env,
      branchHours,
    ),
    '2026-07-14T04:00:00.000Z',
  );
});

test('preorder supports delivery with future slots and delivery tariff', () => {
  const checkout = validateCheckout(
    {
      orderType: 'preorder',
      preorderFulfillmentType: 'delivery',
      deliveryAddress: {
        city: 'Актау',
        address: '11-й микрорайон, дом 25',
        latitude: 43.654,
        longitude: 51.198,
      },
      scheduledAt: '2026-07-14T09:00:00+05:00',
    },
    cities,
    { now: new Date('2026-07-13T12:00:00.000Z'), env },
  );

  assert.equal(checkout.orderType, 'preorder');
  assert.equal(checkout.preorderFulfillmentType, 'delivery');
  assert.equal(checkout.branchId, primaryBranchId);
  assert.equal(checkout.deliveryFee, 700);
  assert.equal(checkout.deliveryMinimumOrder, 3000);
  assert.equal(checkout.deliveryAddress.address, '11-й микрорайон, дом 25');
  assert.equal(checkout.scheduledAt, '2026-07-14T04:00:00.000Z');
});

test('preorder pickup remains the default receiving method', () => {
  const checkout = validateCheckout(
    {
      orderType: 'preorder',
      branchId: primaryBranchId,
      scheduledAt: '2026-07-14T09:00:00+05:00',
    },
    cities,
    { now: new Date('2026-07-13T12:00:00.000Z'), env },
  );

  assert.equal(checkout.preorderFulfillmentType, 'pickup');
  assert.equal(checkout.deliveryAddress, null);
  assert.equal(checkout.deliveryFee, 0);
});

test('pickup and delivery expose only today while preorder keeps future dates', () => {
  assert.throws(
    () =>
      normalizeSchedule(
        '2026-07-14T09:00:00+05:00',
        'pickup',
        new Date('2026-07-13T12:00:00.000Z'),
        env,
        branchHours,
      ),
    /время на сегодня/,
  );
  assert.throws(
    () =>
      normalizeSchedule(null, 'delivery', new Date('2026-07-13T12:00:00.000Z'), env, branchHours),
    /время доставки/,
  );
  assert.throws(
    () =>
      normalizeSchedule(
        '2026-07-13T18:30:00+05:00',
        'pickup',
        new Date('2026-07-13T12:00:00.000Z'),
        env,
        branchHours,
        60,
      ),
    /доступное время/,
  );
  assert.equal(slotHorizonDays('pickup', 7), 1);
  assert.equal(slotHorizonDays('delivery', 3), 1);
  assert.equal(slotHorizonDays('preorder', 7), 7);
  assert.equal(timezoneOffsetMinutes({ ORDER_TIMEZONE_OFFSET_MINUTES: '300' }), 300);
  assert.equal(timezoneOffsetMinutes({ ORDER_TIMEZONE_OFFSET_MINUTES: 'invalid' }), 300);
});

test('payment state machine never downgrades paid or refunded orders', () => {
  assert.equal(paymentStatusCanTransition('pending', 'paid'), true);
  assert.equal(paymentStatusCanTransition('failed', 'paid'), true);
  assert.equal(paymentStatusCanTransition('paid', 'failed'), false);
  assert.equal(paymentStatusCanTransition('paid', 'expired'), false);
  assert.equal(paymentStatusCanTransition('refunded', 'paid'), false);
  assert.equal(paymentStatusCanTransition('refunded', 'failed'), false);
});

test('Kaspi reconciliation keeps a safe payment verification window', () => {
  const previous = process.env.KASPI_PENDING_RECONCILIATION_MS;
  try {
    delete process.env.KASPI_PENDING_RECONCILIATION_MS;
    assert.equal(pendingReconciliationWindowMs(), 24 * 60 * 60 * 1000);
    process.env.KASPI_PENDING_RECONCILIATION_MS = '1000';
    assert.equal(pendingReconciliationWindowMs(), 15 * 60 * 1000);
  } finally {
    if (previous === undefined) delete process.env.KASPI_PENDING_RECONCILIATION_MS;
    else process.env.KASPI_PENDING_RECONCILIATION_MS = previous;
  }
});

test('delivery fee is excluded from loyalty earning and fulfillment metadata is returned', () => {
  const databaseOrder = {
    id: 'order-id',
    order_number: 100001,
    status: 'paid',
    fulfillment_status: 'new',
    fulfillment_type: 'delivery',
    amount: 4200,
    subtotal: 4000,
    discount_amount: 500,
    delivery_fee: 700,
    branch_id: primaryBranchId,
    branch_name: 'ТЦ Ardager, 9-й микрорайон, 30/3',
    scheduled_at: null,
    delivery_address: { address: '11-й микрорайон, дом 25' },
    cart_items: [],
    created_at: '2026-07-13T12:00:00.000Z',
    updated_at: '2026-07-13T12:01:00.000Z',
  };

  assert.equal(eligibleOrderAmount(databaseOrder), 3500);
  assert.equal(normalizeOrder(databaseOrder).branchId, primaryBranchId);
  assert.equal(normalizeOrder(databaseOrder).fulfillmentType, 'delivery');
  assert.equal(normalizeOrder(databaseOrder).deliveryFee, 700);
});

test('customer arrival is allowed only for paid ready pickup and preorder orders', () => {
  const readyPickup = {
    status: 'paid',
    fulfillment_status: 'ready',
    fulfillment_type: 'pickup',
  };

  assert.equal(canMarkCustomerArrived(readyPickup), true);
  assert.equal(canMarkCustomerArrived({ ...readyPickup, fulfillment_type: 'preorder' }), true);
  assert.equal(canMarkCustomerArrived({ ...readyPickup, fulfillment_type: 'delivery' }), false);
  assert.equal(canMarkCustomerArrived({ ...readyPickup, fulfillment_status: 'preparing' }), false);
  assert.equal(canMarkCustomerArrived({ ...readyPickup, status: 'pending' }), false);
});

test('normalized customer order includes the arrival timestamp', () => {
  const customerArrivedAt = '2026-07-16T12:00:00.000Z';
  const normalized = normalizeOrder({
    id: 'arrival-order',
    order_number: 100124,
    status: 'paid',
    fulfillment_status: 'ready',
    fulfillment_type: 'pickup',
    amount: 2400,
    subtotal: 2400,
    discount_amount: 0,
    cart_items: [],
    customer_arrived_at: customerArrivedAt,
    created_at: customerArrivedAt,
    updated_at: customerArrivedAt,
  });

  assert.equal(normalized.customerArrivedAt, customerArrivedAt);
});

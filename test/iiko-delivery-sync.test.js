const assert = require('node:assert/strict');
const test = require('node:test');

const fetchPath = require.resolve('node-fetch');
const iikoServicePath = require.resolve('../src/services/iiko.service');

const jsonResponse = (payload, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  async text() {
    return JSON.stringify(payload);
  },
});

async function withIikoFetchMock(fetchMock, callback) {
  const previousFetch = require.cache[fetchPath];
  const previousService = require.cache[iikoServicePath];
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: fetchMock,
  };
  delete require.cache[iikoServicePath];
  try {
    return await callback(require(iikoServicePath));
  } finally {
    delete require.cache[iikoServicePath];
    if (previousService) require.cache[iikoServicePath] = previousService;
    if (previousFetch) require.cache[fetchPath] = previousFetch;
    else delete require.cache[fetchPath];
  }
}

test('iiko item reconciliation keeps the externally paid total exact and deterministic', () => {
  const { reconcileIikoItems } = require('../src/services/iiko.service');
  const order = {
    id: '11111111-1111-4111-8111-111111111111',
    amount: 2470,
    cart_items: [
      {
        iikoProductId: '22222222-2222-4222-8222-222222222222',
        quantity: 2,
        price: 1000,
      },
      {
        iikoProductId: '33333333-3333-4333-8333-333333333333',
        quantity: 1,
        price: 700,
      },
    ],
  };

  const first = reconcileIikoItems(order);
  const second = reconcileIikoItems(order);
  const paidCents = first.reduce(
    (total, item) => total + Math.round(item.price * 100) * item.amount,
    0,
  );

  assert.equal(paidCents, 247000);
  assert.deepEqual(first, second);
  assert.ok(first.every((item) => item.type === 'Product' && item.positionId));
});

test('iiko delivery rejects a manual product without an iiko product id', () => {
  const { reconcileIikoItems } = require('../src/services/iiko.service');
  assert.throws(
    () =>
      reconcileIikoItems({
        id: '11111111-1111-4111-8111-111111111111',
        amount: 1000,
        cart_items: [{ name: 'Ручной товар', quantity: 1, price: 1000 }],
      }),
    /без iiko productId/,
  );
});

test('iiko delivery payload is visible as a paid courier delivery in iikoFront', async () => {
  const requests = [];
  const previousExport = process.env.IIKO_ORDER_EXPORT_ENABLED;
  process.env.IIKO_ORDER_EXPORT_ENABLED = 'true';
  try {
    await withIikoFetchMock(
      async (url, options) => {
        const body = JSON.parse(options.body);
        requests.push({ url: String(url), body });
        return jsonResponse({
          orderInfo: {
            id: body.order.id,
            posId: '44444444-4444-4444-8444-444444444444',
            creationStatus: 'Success',
            order: { status: 'Unconfirmed' },
          },
        });
      },
      async ({ IikoAPI }) => {
        const client = new IikoAPI({
          organizationId: '55555555-5555-4555-8555-555555555555',
          terminalGroupId: '66666666-6666-4666-8666-666666666666',
          paymentTypeId: '77777777-7777-4777-8777-777777777777',
          deliveryAddressFormat: 'city',
        });
        client.token = 'cached-test-token';
        client.tokenExpiresAt = Date.now() + 60 * 60 * 1000;

        await client.createDeliveryOrder({
          id: '11111111-1111-4111-8111-111111111111',
          order_number: 812,
          branch_name: 'Сарыарка',
          amount: 2470,
          subtotal: 2700,
          discount_amount: 430,
          delivery_fee: 200,
          phone: '+7 701 123 45 67',
          delivery_latitude: 51.1605,
          delivery_longitude: 71.4704,
          delivery_address: {
            city: 'Астана',
            address: 'проспект Сарыарка, 12',
            apartment: '45',
            entrance: '2',
            comment: 'Домофон не работает',
          },
          customers: { name: 'Айжан' },
          comment: 'Позвонить за пять минут',
          cart_items: [
            {
              name: 'Булочка',
              iikoProductId: '22222222-2222-4222-8222-222222222222',
              quantity: 2,
              price: 1000,
            },
            {
              name: 'Круассан',
              iikoProductId: '33333333-3333-4333-8333-333333333333',
              quantity: 1,
              price: 700,
            },
          ],
        });
      },
    );
  } finally {
    if (previousExport === undefined) delete process.env.IIKO_ORDER_EXPORT_ENABLED;
    else process.env.IIKO_ORDER_EXPORT_ENABLED = previousExport;
  }

  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /\/api\/1\/deliveries\/create$/);
  const payload = requests[0].body;
  assert.equal(payload.order.orderServiceType, 'DeliveryByCourier');
  assert.equal(payload.order.customer.type, 'one-time');
  assert.equal(payload.order.deliveryPoint.address.type, 'city');
  assert.equal(payload.order.deliveryPoint.address.line1, 'Астана, проспект Сарыарка, 12');
  assert.match(payload.order.comment, /ТОЛЬКО АВТОКУРЬЕР/);
  assert.match(payload.order.comment, /Bulka «Сарыарка»/);
  assert.deepEqual(payload.order.payments, [
    {
      paymentTypeKind: 'External',
      sum: 2470,
      paymentTypeId: '77777777-7777-4777-8777-777777777777',
      isProcessedExternally: true,
      isFiscalizedExternally: false,
      isPrepay: true,
    },
  ]);
  assert.equal(
    payload.order.items.reduce(
      (total, item) => total + Math.round(item.price * 100) * item.amount,
      0,
    ),
    247000,
  );
});

test('iiko delivery refuses missing coordinates instead of silently sending zeroes', async () => {
  const previousExport = process.env.IIKO_ORDER_EXPORT_ENABLED;
  process.env.IIKO_ORDER_EXPORT_ENABLED = 'true';
  try {
    await withIikoFetchMock(
      async () => {
        throw new Error('fetch must not be called');
      },
      async ({ IikoAPI }) => {
        const client = new IikoAPI({
          organizationId: '55555555-5555-4555-8555-555555555555',
          terminalGroupId: '66666666-6666-4666-8666-666666666666',
          paymentTypeId: '77777777-7777-4777-8777-777777777777',
        });
        client.token = 'cached-test-token';
        client.tokenExpiresAt = Date.now() + 60 * 60 * 1000;
        await assert.rejects(
          () =>
            client.createDeliveryOrder({
              id: '11111111-1111-4111-8111-111111111111',
              amount: 1000,
              phone: '+77011234567',
              delivery_address: { city: 'Астана', address: 'Улица 1' },
              cart_items: [
                {
                  iikoProductId: '22222222-2222-4222-8222-222222222222',
                  quantity: 1,
                  price: 1000,
                },
              ],
            }),
          /координаты доставки/,
        );
      },
    );
  } finally {
    if (previousExport === undefined) delete process.env.IIKO_ORDER_EXPORT_ENABLED;
    else process.env.IIKO_ORDER_EXPORT_ENABLED = previousExport;
  }
});

test('iiko sync ids and status extraction are stable', () => {
  const {
    IIKO_ACCEPTED_STATUSES,
    iikoStatusFromInfo,
    stableIikoOrderId,
  } = require('../src/services/iiko-order-sync.service');
  const first = stableIikoOrderId({ id: 'order-812' });
  const second = stableIikoOrderId({ id: 'order-812' });

  assert.equal(first, second);
  assert.match(first, /^[0-9a-f-]{36}$/);
  assert.equal(iikoStatusFromInfo({ order: { status: 'CookingStarted' } }), 'CookingStarted');
  assert.equal(IIKO_ACCEPTED_STATUSES.has('Unconfirmed'), false);
  assert.equal(IIKO_ACCEPTED_STATUSES.has('WaitCooking'), true);
  assert.equal(IIKO_ACCEPTED_STATUSES.has('ReadyForCooking'), true);
});

test('iiko acceptance starts the local kitchen flow that requests a courier', async () => {
  const { applyIikoDeliveryStatus } = require('../src/services/iiko-order-sync.service');
  const transitions = [];
  const updateKitchenStatus = async (orderId, status) => {
    transitions.push([orderId, status]);
  };

  await applyIikoDeliveryStatus({ id: 'order-812', kitchen_status: 'queued' }, 'WaitCooking', {
    updateKitchenStatus,
  });
  assert.deepEqual(transitions, [['order-812', 'preparing']]);

  transitions.length = 0;
  await applyIikoDeliveryStatus({ id: 'order-813', kitchen_status: 'queued' }, 'CookingCompleted', {
    updateKitchenStatus,
  });
  assert.deepEqual(transitions, [
    ['order-813', 'preparing'],
    ['order-813', 'ready'],
  ]);
});

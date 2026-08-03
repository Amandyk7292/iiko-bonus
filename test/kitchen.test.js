const assert = require('node:assert/strict');
const test = require('node:test');
const { waitForBackgroundTasks } = require('../src/utils/background-task.util');

const modulePath = (value) => require.resolve(value);

function installModule(t, path, exports) {
  const resolved = modulePath(path);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

function loadKitchen(
  t,
  initialOrder,
  {
    beforeKitchenUpdate = null,
    refreshOrderEta = async (value) => value,
    notifyOrderStatus = async () => {},
  } = {},
) {
  let order = structuredClone(initialOrder);
  const events = [];
  const db = {
    from(table) {
      assert.equal(table, 'kaspi_orders');
      let operation = 'select';
      let updates = {};
      const equalFilters = [];
      const nullFilters = [];
      const orFilters = [];
      return {
        select() {
          return this;
        },
        update(value) {
          operation = 'update';
          updates = value;
          return this;
        },
        eq(column, value) {
          equalFilters.push([column, value]);
          return this;
        },
        is(column, value) {
          nullFilters.push([column, value]);
          return this;
        },
        or(value) {
          orFilters.push(value);
          return this;
        },
        maybeSingle() {
          if (operation !== 'update') {
            return Promise.resolve({ data: structuredClone(order), error: null });
          }
          if (beforeKitchenUpdate) {
            order = structuredClone(beforeKitchenUpdate(structuredClone(order)));
            beforeKitchenUpdate = null;
          }
          events.push(['update-filters', equalFilters, nullFilters, orFilters]);
          const equalMatches = equalFilters.every(
            ([column, value]) => String(order[column]) === String(value),
          );
          const nullMatches = nullFilters.every(
            ([column, value]) => value === null && order[column] == null,
          );
          const refundMatches = orFilters.every(
            (value) =>
              value !== 'refund_status.is.null,refund_status.not.in.(processing,unknown)' ||
              order.refund_status == null ||
              !['processing', 'unknown'].includes(order.refund_status),
          );
          if (!equalMatches || !nullMatches || !refundMatches) {
            return Promise.resolve({ data: null, error: null });
          }
          order = { ...order, ...updates };
          return Promise.resolve({ data: structuredClone(order), error: null });
        },
      };
    },
  };
  installModule(t, '../src/config/supabase', { supabase: db });
  installModule(t, '../src/services/customer-order.service', {
    cancelPaidOrder: async (_current, reason, options) => {
      events.push(['cancel', reason, options]);
      order = {
        ...order,
        status: 'refunded',
        fulfillment_status: 'cancelled',
        refund_status: 'succeeded',
      };
      return order;
    },
    notifyOrderStatus: async (...args) => {
      events.push(['notify']);
      return notifyOrderStatus(...args);
    },
  });
  installModule(t, '../src/services/courier.service', {
    notifyDeliveryStatus: async () => events.push(['delivery-notify']),
  });
  installModule(t, '../src/services/inventory.service', {
    releaseOrderReservations: async (orderId) => events.push(['release', orderId]),
  });
  installModule(t, '../src/services/realtime.service', {
    publish: () => events.push(['publish']),
  });
  installModule(t, '../src/services/eta.service', {
    refreshOrderEta,
  });
  const servicePath = modulePath('../src/services/kitchen.service');
  const previous = require.cache[servicePath];
  delete require.cache[servicePath];
  const service = require(servicePath);
  t.after(() => {
    if (previous) require.cache[servicePath] = previous;
    else delete require.cache[servicePath];
  });
  return { service, events, getOrder: () => order };
}

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const baseOrder = (overrides = {}) => ({
  id: ORDER_ID,
  customer_id: '22222222-2222-4222-8222-222222222222',
  branch_id: '33333333-3333-4333-8333-333333333333',
  order_number: 10,
  status: 'paid',
  fulfillment_status: 'new',
  fulfillment_type: 'pickup',
  kitchen_status: 'queued',
  cart_items: [],
  ...overrides,
});

test('kitchen cancellation uses the paid-order refund workflow before closing', async (t) => {
  const { service, events, getOrder } = loadKitchen(t, baseOrder());
  const result = await service.updateKitchenStatus(ORDER_ID, 'cancelled', null, {
    cancellationReason: 'Нет товара',
  });
  assert.equal(result.kitchenStatus, 'cancelled');
  assert.equal(getOrder().status, 'refunded');
  assert.equal(events[0][0], 'cancel');
  assert.equal(events[0][1], 'Нет товара');
  assert.equal(events[0][2].cancelBeforeRefund, true);
  assert.deepEqual(events[0][2].allowedFulfillmentStatuses, ['new']);
  assert.ok(
    events
      .find(([name]) => name === 'update-filters')[1]
      .some(([column, value]) => column === 'refund_status' && value === 'succeeded'),
  );
});

test('handed-over transition releases reservations and repeated close is idempotent', async (t) => {
  const { service, events } = loadKitchen(
    t,
    baseOrder({ fulfillment_status: 'ready', kitchen_status: 'ready' }),
  );
  const first = await service.updateKitchenStatus(ORDER_ID, 'handed_over');
  const second = await service.updateKitchenStatus(ORDER_ID, 'handed_over');
  await waitForBackgroundTasks();
  assert.equal(first.kitchenStatus, 'handed_over');
  assert.equal(second.kitchenStatus, 'handed_over');
  assert.deepEqual(
    events.filter(([name]) => name === 'release'),
    [['release', '11111111-1111-4111-8111-111111111111']],
  );
});

test('kitchen status responds before slow ETA and notification side effects finish', async (t) => {
  let releaseEta;
  let releaseNotification;
  const etaPending = new Promise((resolve) => {
    releaseEta = resolve;
  });
  const notificationPending = new Promise((resolve) => {
    releaseNotification = resolve;
  });
  const { service } = loadKitchen(t, baseOrder(), {
    refreshOrderEta: async (order) => {
      await etaPending;
      return order;
    },
    notifyOrderStatus: async () => notificationPending,
  });

  const result = await Promise.race([
    service.updateKitchenStatus(ORDER_ID, 'preparing', 15),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('status update waited for side effects')), 100),
    ),
  ]);
  assert.equal(result.kitchenStatus, 'preparing');

  releaseEta();
  releaseNotification();
  await waitForBackgroundTasks();
});

test('stale kitchen transition cannot overwrite a concurrent refund claim', async (t) => {
  const { service, events, getOrder } = loadKitchen(t, baseOrder(), {
    beforeKitchenUpdate: (order) => ({
      ...order,
      fulfillment_status: 'cancelled',
      refund_status: 'processing',
      cancellation_reason: 'Нет товара',
    }),
  });

  await assert.rejects(
    () => service.updateKitchenStatus(ORDER_ID, 'preparing'),
    (error) => error.statusCode === 409 && /уже изменился/i.test(error.message),
  );
  assert.equal(getOrder().fulfillment_status, 'cancelled');
  assert.equal(getOrder().refund_status, 'processing');
  assert.equal(getOrder().kitchen_status, 'queued');
  assert.equal(
    events.some(([name]) => name === 'publish'),
    false,
  );
  const [, equalFilters, , orFilters] = events.find(([name]) => name === 'update-filters');
  assert.ok(equalFilters.some(([column, value]) => column === 'status' && value === 'paid'));
  assert.ok(
    equalFilters.some(([column, value]) => column === 'fulfillment_status' && value === 'new'),
  );
  assert.deepEqual(orFilters, ['refund_status.is.null,refund_status.not.in.(processing,unknown)']);
});

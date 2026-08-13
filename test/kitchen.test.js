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
    assertAutomobileCourierForHandoff = async () => true,
    staffDevices = [],
  } = {},
) {
  let order = structuredClone(initialOrder);
  const events = [];
  const db = {
    from(table) {
      if (table === 'staff_push_devices') {
        const staffQuery = {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          is() {
            return this;
          },
          gte() {
            return this;
          },
          limit() {
            return Promise.resolve({ data: structuredClone(staffDevices), error: null });
          },
        };
        return staffQuery;
      }
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
  installModule(t, '../src/services/delivery-orchestration.service', {
    assertAutomobileCourierForHandoff,
    dispatchRequestUpdates: (candidate, now) =>
      candidate.fulfillment_type === 'delivery'
        ? {
            courier_dispatch_status: 'pending',
            courier_dispatch_requested_at: candidate.courier_dispatch_requested_at || now,
            courier_dispatch_next_attempt_at: now,
            courier_dispatch_error: null,
          }
        : {},
    processDeliveryDispatch: async (orderId) => events.push(['dispatch', orderId]),
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
    service.updateKitchenStatus(ORDER_ID, 'preparing', 15, {
      iikoManualEntryConfirmed: true,
    }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('status update waited for side effects')), 100),
    ),
  ]);
  assert.equal(result.kitchenStatus, 'preparing');

  releaseEta();
  releaseNotification();
  await waitForBackgroundTasks();
});

test('accepting a paid delivery queues and starts courier dispatch', async (t) => {
  const { service, events, getOrder } = loadKitchen(
    t,
    baseOrder({ fulfillment_type: 'delivery', delivery_status: 'unassigned' }),
  );
  const result = await service.updateKitchenStatus(ORDER_ID, 'preparing', 20, {
    iikoManualEntryConfirmed: true,
  });
  await waitForBackgroundTasks();
  assert.equal(result.kitchenStatus, 'preparing');
  assert.equal(getOrder().courier_dispatch_status, 'pending');
  assert.ok(getOrder().courier_dispatch_requested_at);
  assert.deepEqual(
    events.filter(([name]) => name === 'dispatch'),
    [['dispatch', ORDER_ID]],
  );
});

test('kitchen cannot hand food to a non-automobile courier', async (t) => {
  const { service, getOrder } = loadKitchen(
    t,
    baseOrder({
      fulfillment_type: 'delivery',
      fulfillment_status: 'ready',
      kitchen_status: 'ready',
      delivery_status: 'assigned',
    }),
    {
      assertAutomobileCourierForHandoff: async () => {
        throw Object.assign(new Error('нужен курьер на автомобиле'), { statusCode: 409 });
      },
    },
  );
  await assert.rejects(() => service.updateKitchenStatus(ORDER_ID, 'handed_over'), /автомобиле/);
  assert.equal(getOrder().kitchen_status, 'ready');
});

test('queued order cannot start until manual iikoFront entry is explicitly confirmed', async (t) => {
  const { service, events, getOrder } = loadKitchen(t, baseOrder());

  await assert.rejects(
    () => service.updateKitchenStatus(ORDER_ID, 'preparing', 15),
    (error) => error.statusCode === 409 && /iikoFront/i.test(error.message),
  );
  assert.equal(getOrder().kitchen_status, 'queued');
  assert.equal(
    events.some(([name]) => name === 'update-filters'),
    false,
  );

  const accepted = await service.updateKitchenStatus(ORDER_ID, 'preparing', 15, {
    iikoManualEntryConfirmed: true,
  });
  assert.equal(accepted.kitchenStatus, 'preparing');
});

test('acceptance audit derives its actor and one current iPad from the authenticated session', async (t) => {
  const { service, getOrder } = loadKitchen(t, baseOrder(), {
    staffDevices: [{ installation_id: 'ipad.branch.SECRETAB12' }],
  });

  const accepted = await service.updateKitchenStatus(ORDER_ID, 'preparing', 15, {
    iikoManualEntryConfirmed: true,
    admin: { sub: 'cashier.oral', jti: 'session-jti-1', role: 'cashier' },
  });

  assert.ok(accepted.acceptedAt);
  assert.equal(accepted.acceptedBy, 'cashier.oral');
  assert.equal(accepted.acceptedDeviceLabel, 'iPad ••••AB12');
  assert.equal(Object.hasOwn(accepted, 'acceptedInstallationId'), false);
  assert.equal(getOrder().staff_accepted_installation_id, 'ipad.branch.SECRETAB12');
  assert.match(getOrder().staff_accepted_session_jti_hash, /^[a-f0-9]{64}$/);
});

test('a concurrent second acceptance returns the first immutable acknowledgement', async (t) => {
  const firstAcceptedAt = '2026-08-13T12:00:00.000Z';
  const { service, events } = loadKitchen(t, baseOrder(), {
    beforeKitchenUpdate: (order) => ({
      ...order,
      kitchen_status: 'preparing',
      fulfillment_status: 'preparing',
      kitchen_started_at: firstAcceptedAt,
      staff_accepted_at: firstAcceptedAt,
      staff_accepted_by: 'cashier.first',
      staff_accepted_installation_id: 'ipad.branch.FIRST001',
    }),
  });

  const accepted = await service.updateKitchenStatus(ORDER_ID, 'preparing', 15, {
    iikoManualEntryConfirmed: true,
  });

  assert.equal(accepted.acceptedAt, firstAcceptedAt);
  assert.equal(accepted.acceptedBy, 'cashier.first');
  assert.equal(accepted.acceptedDeviceLabel, 'iPad ••••T001');
  assert.equal(
    events.some(([name]) => ['publish', 'notify', 'dispatch'].includes(name)),
    false,
  );
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
    () =>
      service.updateKitchenStatus(ORDER_ID, 'preparing', null, {
        iikoManualEntryConfirmed: true,
      }),
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

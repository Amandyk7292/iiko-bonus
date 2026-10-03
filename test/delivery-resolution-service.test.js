const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const service = require('../src/services/delivery-resolution.service');
function harness() {
  const now = new Date('2026-10-03T12:00:00Z');
  const pickupTime = '2026-10-03T14:00:00.000Z';
  const order = {
    id: randomUUID(),
    customer_id: randomUUID(),
    branch_id: randomUUID(),
    branch_name: 'Точка',
    order_number: 100012,
    status: 'paid',
    fulfillment_type: 'delivery',
    fulfillment_status: 'ready',
    refund_status: null,
    amount: 4500,
    delivery_resolution: {
      id: randomUUID(),
      status: 'pending',
      reason: 'courier_not_found',
      requestedAt: now.toISOString(),
    },
  };
  const calls = [],
    notifications = new Map();
  let closeFails = false,
    pushFails = false,
    feeStatus = 'unknown',
    refundStatus = 'succeeded',
    expired = false;
  const value = (row, key) =>
    key.includes('->') ? row[key.split('->')[0]]?.[key.split(/->>?/)[1]] : row[key];
  const db = {
    from(table) {
      const q = {},
        filters = [];
      let patch = null,
        upsert = null,
        single = false;
      q.select = () => q;
      q.eq = (k, v) => {
        filters.push((r) => value(r, k) === v);
        return q;
      };
      q.is = (k, v) => {
        filters.push((r) => (value(r, k) ?? null) === v);
        return q;
      };
      q.in = (k, v) => {
        filters.push((r) => v.includes(value(r, k)));
        return q;
      };
      q.lt = (k, v) => {
        filters.push((r) => value(r, k) < v);
        return q;
      };
      q.limit = () => q;
      q.update = (v) => {
        patch = v;
        return q;
      };
      q.upsert = (v) => {
        upsert = v;
        return q;
      };
      const run = async () => {
        if (table === 'customer_notifications') {
          notifications.set(upsert.id, upsert);
          return { error: null };
        }
        const row =
          table === 'kaspi_orders'
            ? order
            : { id: order.branch_id, name: 'Точка', address: 'Улица 1' };
        if (!filters.every((f) => f(row))) return { data: single ? null : [], error: null };
        if (patch) Object.assign(row, structuredClone(patch));
        return { data: single ? structuredClone(row) : [structuredClone(row)], error: null };
      };
      q.maybeSingle = () => {
        single = true;
        return run();
      };
      q.then = (ok, bad) => run().then(ok, bad);
      return q;
    },
    async rpc(name, args) {
      if (name === 'claim_delivery_resolutions') return { data: [] };
      if (name === 'choose_delivery_resolution') {
        if (order.delivery_resolution.status === 'pending')
          order.delivery_resolution = {
            ...order.delivery_resolution,
            status: `${args.p_action}_cancelling`,
            pickupTime: args.p_pickup,
            retryAt: now.toISOString(),
          };
        return { data: structuredClone(order) };
      }
      if (name === 'claim_delivery_resolution_work') {
        if (
          ![
            'pickup_cancelling',
            'cancel_cancelling',
            'pickup_accepting',
            'pickup_rejecting',
            'cancel_refunding',
          ].includes(order.delivery_resolution.status) ||
          Date.parse(order.delivery_resolution.retryAt) > now.getTime()
        )
          return { data: [] };
        order.delivery_resolution.retryAt = new Date(now.getTime() + 60000).toISOString();
        return { data: [structuredClone(order)] };
      }
      assert.equal(name, 'finish_delivery_resolution');
      calls.push(args.p_next);
      if (args.p_next === 'pickup_accepted' && expired)
        return { error: { message: 'DELIVERY_RESOLUTION_INVALID_SLOT' } };
      order.delivery_resolution = {
        ...order.delivery_resolution,
        status: args.p_next,
        retryAt: now.toISOString(),
      };
      if (args.p_next === 'pickup_accepted') {
        order.fulfillment_type = 'pickup';
        order.scheduled_at = order.delivery_resolution.pickupTime;
      }
      return { data: structuredClone(order) };
    },
  };
  const options = {
    db,
    now,
    normalize: structuredClone,
    publish: () => {},
    slots: async (args) => {
      assert.equal(args.branchId, order.branch_id);
      assert.equal(args.horizonHours, 24);
      return {
        slots: [
          { startsAt: pickupTime, endsAt: '2026-10-03T15:00:00.000Z', remaining: 1, capacity: 1 },
        ],
        serverTime: now.toISOString(),
        timezoneOffsetMinutes: 300,
      };
    },
    closeDelivery: async () => {
      calls.push('provider');
      if (closeFails) throw Error('provider offline');
    },
    refundFee: async () => {
      calls.push('fee');
      if (feeStatus === 'succeeded') order.refund_status = 'partial';
      return { status: feeStatus };
    },
    cancel: async (current, reason, args) => {
      calls.push(['refund', reason, args]);
      assert.equal(args.reuseRefundRequestId, true);
      assert.equal(args.courierTimeout, true);
      order.fulfillment_status = 'cancelled';
      order.refund_status = refundStatus;
      if (refundStatus === 'succeeded') order.status = 'refunded';
      return order;
    },
    send: async (...args) => {
      calls.push(['push', args[3]]);
      if (pushFails) throw Error('push storage unavailable');
      return { queued: true };
    },
  };
  return {
    order,
    calls,
    options,
    notifications,
    pickupTime,
    retry: () => {
      order.delivery_resolution.retryAt = now.toISOString();
    },
    setCloseFails: (v) => {
      closeFails = v;
    },
    setPushFails: (v) => {
      pushFails = v;
    },
    setFee: (v) => {
      feeStatus = v;
    },
    setRefund: (v) => {
      refundStatus = v;
    },
    setExpired: (v) => {
      expired = v;
    },
  };
}
test('options are same point and server schedule; invalid slot never saves a choice', async () => {
  const h = harness();
  const response = await service.getDeliveryResolution(h.order.customer_id, h.order.id, h.options);
  assert.equal(response.options.branch.id, h.order.branch_id);
  assert.equal(response.options.expiresAt, '2026-10-04T12:00:00.000Z');
  assert.equal(response.options.slots[0].startsAt, h.pickupTime);
  await assert.rejects(
    service.chooseDeliveryResolution(
      h.order.customer_id,
      h.order.id,
      { action: 'pickup', pickupTime: '2026-10-03T16:00:00Z' },
      h.options,
    ),
    (e) => e.code === 'DELIVERY_RESOLUTION_INVALID_SLOT',
  );
  assert.equal(h.order.delivery_resolution.status, 'pending');
  assert.equal(h.calls.length, 0);
});
test('uncertain provider cancellation persists choice, retries and waits for fee confirmation before same-order pickup', async () => {
  const h = harness();
  h.setCloseFails(true);
  const choice = { action: 'pickup', pickupTime: h.pickupTime };
  const pending = await service.chooseDeliveryResolution(
    h.order.customer_id,
    h.order.id,
    choice,
    h.options,
  );
  assert.equal(pending.delivery_resolution.status, 'pickup_cancelling');
  assert.equal(pending.amount, 4500);
  assert.equal(pending.fulfillment_type, 'delivery');
  await service.chooseDeliveryResolution(h.order.customer_id, h.order.id, choice, h.options);
  assert.equal(h.calls.filter((c) => c === 'provider').length, 1);
  h.retry();
  h.setCloseFails(false);
  await service.processDeliveryResolutions(h.options);
  assert.equal(h.order.delivery_resolution.status, 'pickup_pending_approval');
  await service.reviewDeliveryResolution(h.order.id, 'accept', {
    ...h.options,
    resolutionId: h.order.delivery_resolution.id,
    branchIds: [h.order.branch_id],
  });
  assert.equal(h.order.delivery_resolution.status, 'pickup_accepting');
  assert.equal(h.order.fulfillment_type, 'delivery');
  h.retry();
  h.setFee('succeeded');
  await service.processDeliveryResolutions(h.options);
  assert.equal(h.order.delivery_resolution.status, 'pickup_accepted');
  assert.equal(h.order.fulfillment_type, 'pickup');
  assert.equal(h.order.scheduled_at, h.pickupTime);
  assert.equal(h.order.amount, 4500);
  assert.equal(
    h.calls.some((c) => Array.isArray(c) && c[0] === 'refund'),
    false,
  );
});
test('cancel waits for provider acknowledgment and bank uncertainty remains durable until confirmed', async () => {
  const h = harness();
  h.setRefund('unknown');
  const result = await service.chooseDeliveryResolution(
    h.order.customer_id,
    h.order.id,
    { action: 'cancel' },
    h.options,
  );
  assert.equal(result.delivery_resolution.status, 'cancel_refunding');
  assert.equal(result.refund_status, 'unknown');
  assert.ok(
    h.calls.indexOf('provider') < h.calls.findIndex((c) => Array.isArray(c) && c[0] === 'refund'),
  );
  h.retry();
  h.setRefund('succeeded');
  await service.processDeliveryResolutions(h.options);
  assert.equal(h.order.delivery_resolution.status, 'cancelled');
  assert.equal(h.order.status, 'refunded');
});
test('fee success after slot expiry safely refunds remaining order instead of sticking in accepting', async () => {
  const h = harness();
  h.order.delivery_resolution.status = 'pickup_accepting';
  h.order.delivery_resolution.pickupTime = h.pickupTime;
  h.retry();
  h.setFee('succeeded');
  h.setExpired(true);
  await service.processDeliveryResolutions(h.options);
  assert.equal(h.order.delivery_resolution.status, 'pickup_rejected');
  assert.equal(h.order.status, 'refunded');
  assert.equal(h.order.delivery_resolution.rejectionReason, 'pickup_slot_unavailable');
  assert.ok(h.calls.includes('pickup_rejecting'));
  assert.match(h.calls.find((c) => Array.isArray(c) && c[0] === 'refund')[1], /истекло/);
});
test('pending notice survives outage, retries one stable inbox/push identity and stops once persisted', async () => {
  const h = harness();
  h.setPushFails(true);
  await assert.rejects(service.processDeliveryResolutions(h.options), AggregateError);
  assert.equal(h.order.delivery_resolution.status, 'pending');
  assert.equal(h.order.delivery_resolution.noticeSentAt, undefined);
  h.setPushFails(false);
  await service.processDeliveryResolutions(h.options);
  await service.processDeliveryResolutions(h.options);
  const pushes = h.calls.filter((c) => Array.isArray(c) && c[0] === 'push');
  assert.equal(pushes.length, 2);
  assert.equal(pushes[0][1].pushDedupeKey, pushes[1][1].pushDedupeKey);
  assert.equal(h.notifications.size, 1);
  assert.equal(h.order.delivery_resolution.noticeSentAt, h.options.now.toISOString());
});
test('cashier branch and resolution identifier prevent stale or foreign approval', async () => {
  const h = harness();
  h.order.delivery_resolution.status = 'pickup_pending_approval';
  h.order.delivery_resolution.pickupTime = h.pickupTime;
  await assert.rejects(
    service.reviewDeliveryResolution(h.order.id, 'accept', {
      ...h.options,
      branchIds: [randomUUID()],
    }),
    (e) => e.statusCode === 404,
  );
  await assert.rejects(
    service.reviewDeliveryResolution(h.order.id, 'accept', {
      ...h.options,
      resolutionId: randomUUID(),
    }),
    (e) => e.code === 'DELIVERY_RESOLUTION_CONFLICT',
  );
  assert.equal(h.calls.length, 0);
});
test('courier-wait configuration defaults to 20 minutes and rejects invalid values', () => {
  assert.equal(service.timeoutMs({}), 20 * 60000);
  assert.equal(service.timeoutMs({ DELIVERY_COURIER_WAIT_MINUTES: '3' }), 3 * 60000);
  for (const v of ['0', '-1', 'bad', '1441'])
    assert.equal(service.timeoutMs({ DELIVERY_COURIER_WAIT_MINUTES: v }), 20 * 60000);
});

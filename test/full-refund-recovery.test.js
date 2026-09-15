const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

function harness(
  t,
  {
    failFinalWrite = false,
    staleProcessing = false,
    partial = false,
    failFollowup = false,
    failMarkerWrite = false,
  } = {},
) {
  let order = {
    id: randomUUID(),
    branch_id: randomUUID(),
    operation_id: randomUUID(),
    order_number: 123456,
    status: 'paid',
    fulfillment_status: 'new',
    kitchen_status: 'queued',
    refund_status: staleProcessing ? 'processing' : null,
    refund_request_id: randomUUID(),
    refund_requested_at: new Date(Date.now() - 10 * 60_000).toISOString(),
    acceptance_timeout_at: null,
    amount: 600,
    partially_refunded_amount: 0,
    payment_method: 'forte_card',
    provider_payment_system: 'forte_widget',
    customer_id: null,
    cart_items: [],
  };
  const reference = randomUUID();
  let bankCalls = 0;
  let failed = false;
  let followupCalls = 0;
  const cached = new Map();
  const stub = (file, exports) => {
    const id = require.resolve(file);
    cached.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  t.after(() => {
    for (const [id, prior] of cached) {
      if (prior) require.cache[id] = prior;
      else delete require.cache[id];
    }
  });
  const db = {
    from(table) {
      const filters = [];
      let patch;
      const result = async (single) => {
        if (table !== 'kaspi_orders')
          return {
            data:
              table === 'order_partial_refunds' && partial
                ? [{ id: randomUUID() }]
                : single
                  ? null
                  : [],
            error: null,
          };
        if (!filters.every((f) => f(order))) return { data: single ? null : [], error: null };
        if (patch?.status === 'refunded' && failFinalWrite && !failed) {
          failed = true;
          return { data: null, error: new Error('Injected final write outage') };
        }
        if (patch?.refund_followup_pending === false && failMarkerWrite && !failed) {
          failed = true;
          return { data: null, error: new Error('Injected followup marker outage') };
        }
        if (patch) order = { ...order, ...patch };
        return { data: single ? { ...order } : [{ ...order }], error: null };
      };
      return {
        select() {
          return this;
        },
        insert() {
          return this;
        },
        update(value) {
          patch = value;
          return this;
        },
        eq(k, v) {
          filters.push((x) => x[k] === v);
          return this;
        },
        is(k, v) {
          filters.push((x) => (x[k] ?? null) === v);
          return this;
        },
        in(k, v) {
          filters.push((x) => v.includes(x[k]));
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        or(value) {
          const cutoff = value.match(/refund_requested_at\.lt\.([^)]*)/)?.[1];
          filters.push(
            (x) =>
              x.refund_status === 'unknown' ||
              (x.refund_status === 'processing' && x.refund_requested_at < cutoff),
          );
          return this;
        },
        maybeSingle() {
          return result(true);
        },
        then(ok, bad) {
          return result(false).then(ok, bad);
        },
      };
    },
  };
  stub('../src/config/supabase', { supabase: db });
  stub('../src/services/order-images.service', { attachOrderImages: async (x) => x });
  stub('../src/services/push.service', { sendPushToCustomer: async () => {} });
  stub('../src/services/order-payment-state.service', {
    reverseOrderLoyalty: async (x) => {
      followupCalls++;
      if (failFollowup && followupCalls === 1) throw new Error('Injected bonus outage');
      return x;
    },
  });
  stub('../src/services/inventory.service', { releaseOrderReservations: async () => {} });
  stub('../src/services/realtime.service', { publish() {} });
  stub('../src/services/live-activity.service', { sendOrderLiveActivity: async () => {} });
  stub('../src/services/payment-receipt.service', { paymentReceiptUrl: () => null });
  stub('../src/services/external-delivery-lifecycle.service', {
    assertExternalDeliveryCancelled: async () => {},
    cancelExternalDeliveryForOrder: async () => {},
  });
  stub('../src/services/payment-gateway.service', {
    paymentProviderName: () => 'TestBank',
    refundPaymentForOrder: async () => {
      bankCalls++;
      return { reference };
    },
    reconcileFullRefundForOrder: async (current) => {
      assert.equal(current.refund_request_id, order.refund_request_id);
      return { status: 'confirmed', reference };
    },
  });
  for (const file of [
    '../src/services/customer-order.service',
    '../src/services/full-refund-reconciliation.service',
  ]) {
    const id = require.resolve(file);
    cached.set(id, require.cache[id]);
    delete require.cache[id];
  }
  const { updateAdminOrderStatus } = require('../src/services/customer-order.service');
  const {
    reconcileUnknownFullRefunds,
  } = require('../src/services/full-refund-reconciliation.service');
  return {
    db,
    get order() {
      return order;
    },
    reference,
    get bankCalls() {
      return bankCalls;
    },
    get followupCalls() {
      return followupCalls;
    },
    cancel: () =>
      updateAdminOrderStatus(order.id, 'cancelled', 'Test cancellation', {
        branchIds: [order.branch_id],
      }),
    recover: (options) => reconcileUnknownFullRefunds({ db, ...options }),
  };
}

test('bank success followed by final DB failure retains reference and worker completes manual cancellation', async (t) => {
  const h = harness(t, { failFinalWrite: true });
  await assert.rejects(h.cancel(), /Injected final write outage/);
  assert.equal(h.order.refund_status, 'unknown');
  assert.equal(h.order.refund_reference, h.reference);
  assert.equal(await h.recover(), 1);
  assert.equal(h.order.status, 'refunded');
  assert.equal(h.order.refund_status, 'succeeded');
  assert.equal(h.bankCalls, 1);
  assert.equal(await h.recover(), 0);
});

test('failure after succeeded is retried without reverting payment state or calling the bank', async (t) => {
  const h = harness(t, { failFollowup: true });
  await h.cancel();
  assert.equal(h.order.status, 'refunded');
  assert.equal(h.order.refund_status, 'succeeded');
  assert.equal(h.order.refund_followup_pending, true);
  assert.match(h.order.last_error, /bonus outage/);
  assert.equal(await h.recover(), 1);
  assert.equal(h.order.refund_followup_pending, false);
  assert.equal(h.order.last_error, null);
  assert.equal(h.bankCalls, 1);
  assert.equal(h.followupCalls, 2);
  assert.equal(await h.recover(), 0);
});

test('failure saving followup completion never downgrades succeeded to unknown', async (t) => {
  const h = harness(t, { failMarkerWrite: true });
  await assert.rejects(h.cancel(), /Injected followup marker outage/);
  assert.equal(h.order.status, 'refunded');
  assert.equal(h.order.refund_status, 'succeeded');
  assert.equal(h.order.refund_followup_pending, true);
  assert.equal(await h.recover(), 1);
  assert.equal(h.order.refund_followup_pending, false);
  assert.equal(h.bankCalls, 1);
});

test('stale ordinary processing recovers without requiring acceptance timeout; active partial claim is excluded', async (t) => {
  const h = harness(t, { staleProcessing: true });
  const key = h.order.refund_request_id;
  assert.equal(await h.recover(), 1);
  assert.equal(h.order.refund_request_id, key);
  assert.equal(h.order.refund_status, 'succeeded');
});

test('full refund worker never converts an active partial refund into a full refund', async (t) => {
  const h = harness(t, { staleProcessing: true, partial: true });
  assert.equal(await h.recover(), 0);
  assert.equal(h.order.refund_status, 'processing');
  assert.equal(h.bankCalls, 0);
});

test('missing-reference full refund repeats only its original key inside the safe window', async (t) => {
  const moduleId = require.resolve('../src/services/forte-widget.service');
  const original = require.cache[moduleId];
  const calls = [];
  require.cache[moduleId] = {
    id: moduleId,
    filename: moduleId,
    loaded: true,
    exports: {
      refundPayment: async (_order, amount, options) => {
        calls.push({ amount, options });
        return { reference: randomUUID() };
      },
      reconcileRefund: async () => ({ status: 'confirmed' }),
    },
  };
  const gatewayId = require.resolve('../src/services/payment-gateway.service');
  const previous = require.cache[gatewayId];
  delete require.cache[gatewayId];
  t.after(() => {
    if (original) require.cache[moduleId] = original;
    else delete require.cache[moduleId];
    if (previous) require.cache[gatewayId] = previous;
    else delete require.cache[gatewayId];
  });
  const { reconcileFullRefundForOrder } = require('../src/services/payment-gateway.service');
  const order = {
    operation_id: randomUUID(),
    payment_method: 'forte_card',
    provider_payment_system: 'forte_widget',
    amount: 600,
    partially_refunded_amount: 100,
    refund_request_id: randomUUID(),
    refund_requested_at: new Date(Date.now() - 10 * 60_000).toISOString(),
  };
  assert.equal((await reconcileFullRefundForOrder(order)).status, 'confirmed');
  assert.equal(calls[0].options.idempotencyKey, order.refund_request_id);
  assert.equal(calls[0].amount, 500);
  assert.equal(
    (
      await reconcileFullRefundForOrder({
        ...order,
        refund_requested_at: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
      })
    ).status,
    'pending',
  );
  assert.equal(
    (await reconcileFullRefundForOrder({ ...order, refund_request_id: null })).status,
    'pending',
  );
  assert.equal(calls.length, 1);
});

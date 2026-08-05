const assert = require('node:assert/strict');
const test = require('node:test');

function installModule(t, path, exports) {
  const resolved = require.resolve(path);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

test('confirmed full refund cancels both fulfillment and kitchen state', async (t) => {
  const order = {
    id: '84ba800e-3275-457b-b079-184d870bd89a',
    order_number: 100039,
    status: 'paid',
    fulfillment_status: 'accepted',
    kitchen_status: 'queued',
    refund_status: 'processing',
    amount: 35,
    payment_method: 'forte_card',
    customer_id: null,
    branch_id: '20cc46be-6108-43f9-a6c7-1f06d7d165a8',
    cart_items: [],
  };
  let updatePayload;
  const filters = [];
  const published = [];
  const released = [];
  const query = {
    update(value) {
      updatePayload = value;
      return this;
    },
    eq(column, value) {
      filters.push([column, value]);
      return this;
    },
    select() {
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: { ...order, ...updatePayload }, error: null });
    },
  };

  installModule(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        assert.equal(table, 'kaspi_orders');
        return query;
      },
    },
  });
  installModule(t, '../src/services/push.service', {
    sendPushToCustomer: async () => {},
  });
  installModule(t, '../src/services/kaspi.service', {
    reverseOrderLoyalty: async (value) => value,
  });
  installModule(t, '../src/services/inventory.service', {
    releaseOrderReservations: async (orderId) => released.push(orderId),
  });
  installModule(t, '../src/services/realtime.service', {
    publish: (...args) => published.push(args),
  });
  installModule(t, '../src/services/live-activity.service', {
    sendOrderLiveActivity: async () => {},
  });
  installModule(t, '../src/services/payment-receipt.service', {
    paymentReceiptUrl: () => null,
  });
  installModule(t, '../src/services/payment-gateway.service', {
    paymentProviderName: () => 'Forte',
    refundPaymentForOrder: async () => {
      throw new Error('not expected');
    },
  });

  const servicePath = require.resolve('../src/services/customer-order.service');
  const previousService = require.cache[servicePath];
  delete require.cache[servicePath];
  t.after(() => {
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { finalizeConfirmedOrderRefund } = require(servicePath);
  const result = await finalizeConfirmedOrderRefund(order, {
    reference: '2e9f2c5c-3abe-49b1-b6aa-cf40d569b998',
    confirmedAt: '2026-08-04T09:26:00.131Z',
  });

  assert.equal(updatePayload.status, 'refunded');
  assert.equal(updatePayload.refund_status, 'succeeded');
  assert.equal(updatePayload.fulfillment_status, 'cancelled');
  assert.equal(updatePayload.kitchen_status, 'cancelled');
  assert.equal(updatePayload.fulfilled_at, null);
  assert.deepEqual(filters, [
    ['id', order.id],
    ['status', 'paid'],
    ['refund_status', 'processing'],
  ]);
  assert.equal(result.paymentStatus, 'refunded');
  assert.equal(result.orderStatus, 'cancelled');
  assert.deepEqual(released, [order.id]);
  assert.equal(published.length, 1);
  assert.equal(published[0][1].orderStatus, 'cancelled');
});

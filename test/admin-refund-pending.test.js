const assert = require('node:assert/strict');
const test = require('node:test');

const order = {
  id: '4ae4a371-8852-4326-9bbf-06b547846cc7',
  order_number: 100043,
  status: 'paid',
  fulfillment_status: 'preparing',
  kitchen_status: 'preparing',
  refund_status: null,
  amount: 2506,
  payment_method: 'forte_card',
  provider_payment_system: 'forte_widget',
  customer_id: null,
  cart_items: [],
};
const reference = 'bf5ec730-f572-4b1f-a151-a3558d442507';

function installModule(t, path, exports) {
  const resolved = require.resolve(path);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

function harness(
  t,
  {
    state = {},
    declined = false,
    saveFails = false,
    deliveryFails = false,
    deliveryRaces = false,
    acceptanceRaces = false,
  } = {},
) {
  let current = { ...order, ...state };
  let bankRequests = 0;
  const updates = [];
  const sequence = [];
  let deliveryCleared = false;
  installModule(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        assert.equal(table, 'kaspi_orders');
        let patch;
        const filters = [];
        return {
          select() {
            return this;
          },
          update(value) {
            patch = value;
            return this;
          },
          eq(column, value) {
            filters.push([column, value]);
            return this;
          },
          is(column, value) {
            filters.push([column, value]);
            return this;
          },
          in(column, values) {
            filters.push([column, (value) => values.includes(value)]);
            return this;
          },
          lte(column, value) {
            filters.push([column, (actual) => actual != null && actual <= value]);
            return this;
          },
          async maybeSingle() {
            if (acceptanceRaces && patch?.acceptance_timeout_at)
              current.fulfillment_status = 'preparing';
            if (patch?.refund_status === 'processing' && (!deliveryCleared || deliveryRaces)) {
              return { data: null, error: new Error('DELIVERY_ACTIVE_JOB_CONFLICT') };
            }
            if (patch?.refund_status === 'unknown' && saveFails) {
              return { data: null, error: new Error('storage unavailable') };
            }
            if (
              !filters.every(([column, value]) =>
                typeof value === 'function' ? value(current[column]) : current[column] === value,
              )
            ) {
              return { data: null, error: null };
            }
            if (patch) {
              updates.push({ patch, filters });
              current = { ...current, ...patch };
            }
            return { data: { ...current }, error: null };
          },
          then(resolve, reject) {
            return this.maybeSingle().then(resolve, reject);
          },
        };
      },
    },
  });
  installModule(t, '../src/services/external-delivery-lifecycle.service', {
    assertExternalDeliveryCancelled: async () => {
      deliveryCleared = true;
    },
    cancelExternalDeliveryForOrder: async () => {
      sequence.push('courier');
      assert.equal(current.refund_status, null);
      assert.equal(current.fulfillment_status, 'preparing');
      if (deliveryFails)
        throw Object.assign(new Error('Курьер не подтвердил отмену'), {
          statusCode: 502,
          code: 'EXTERNAL_DELIVERY_CANCEL_UNCONFIRMED',
        });
      deliveryCleared = true;
    },
  });
  installModule(t, '../src/services/payment-gateway.service', {
    paymentProviderName: () => 'ForteBank',
    refundPaymentForOrder: async (claimed, amount, options) => {
      bankRequests += 1;
      sequence.push('bank');
      if (sequence.includes('courier')) assert.equal(claimed.fulfillment_status, 'cancelled');
      assert.equal(amount, 2506);
      assert.equal(options.idempotencyKey, claimed.refund_request_id);
      throw Object.assign(new Error(declined ? 'Bank declined' : 'Awaiting bank confirmation'), {
        statusCode: declined ? 409 : 502,
        code: declined ? 'FORTE_WIDGET_REFUND_REJECTED' : 'FORTE_WIDGET_REFUND_UNKNOWN',
        refundUncertain: !declined,
        refundReference: reference,
      });
    },
  });
  for (const modulePath of [
    '../src/services/customer-order.service',
    '../src/controllers/order.controller',
  ]) {
    const resolved = require.resolve(modulePath);
    const previous = require.cache[resolved];
    delete require.cache[resolved];
    t.after(() => {
      if (previous) require.cache[resolved] = previous;
      else delete require.cache[resolved];
    });
  }
  return {
    service: require('../src/services/customer-order.service'),
    controller: require('../src/controllers/order.controller'),
    current: () => current,
    bankRequests: () => bankRequests,
    updates,
    sequence,
  };
}

test('admin receives 202 while a saved refund awaits bank confirmation, and retry never resends it', async (t) => {
  const h = harness(t);
  const response = {
    statusCode: 200,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  const request = {
    params: { id: order.id },
    body: { status: 'cancelled', cancellationReason: 'Тестовый заказ' },
    admin: { role: 'admin' },
  };
  await h.controller.updateAdminStatus(request, response);
  assert.equal(response.statusCode, 202);
  assert.equal(response.body.success, true);
  assert.equal(response.body.refundPending, true);
  assert.equal(response.body.order.refundStatus, 'unknown');
  assert.equal(response.body.order.paymentStatus, 'paid');
  assert.equal(h.current().refund_reference, reference);
  assert.equal(h.current().refund_amount, undefined);
  assert.equal(h.bankRequests(), 1);
  assert.deepEqual(h.sequence, ['courier', 'bank']);
  assert.ok(h.updates[1].filters.some(([key, value]) => key === 'refund_request_id' && value));
  await h.controller.updateAdminStatus(request, response);
  assert.equal(response.statusCode, 202);
  assert.equal(h.bankRequests(), 1);
});

test('failed courier cancellation keeps the order open and never requests a bank refund', async (t) => {
  const h = harness(t, { deliveryFails: true });
  await assert.rejects(h.service.updateAdminOrderStatus(order.id, 'cancelled', 'Нет товара'), {
    code: 'EXTERNAL_DELIVERY_CANCEL_UNCONFIRMED',
  });
  assert.equal(h.current().fulfillment_status, 'preparing');
  assert.equal(h.current().refund_status, null);
  assert.equal(h.bankRequests(), 0);
  assert.deepEqual(h.sequence, ['courier']);
});

test('a courier reservation racing cancellation prevents the order closure and bank refund', async (t) => {
  const h = harness(t, { deliveryRaces: true });
  await assert.rejects(h.service.updateAdminOrderStatus(order.id, 'cancelled', 'Нет товара'), {
    statusCode: 409,
    code: 'EXTERNAL_DELIVERY_CANCEL_UNCONFIRMED',
  });
  assert.equal(h.current().fulfillment_status, 'preparing');
  assert.equal(h.current().refund_status, null);
  assert.equal(h.bankRequests(), 0);
});

test('processing admin refunds are returned as pending without a bank request', async (t) => {
  const h = harness(t, { state: { refund_status: 'processing' } });
  const result = await h.service.updateAdminOrderStatus(order.id, 'cancelled', 'Тестовый заказ');
  assert.equal(result.refundStatus, 'processing');
  assert.equal(h.bankRequests(), 0);
});

test('an explicit bank decline remains an error', async (t) => {
  const h = harness(t, { declined: true });
  await assert.rejects(h.service.updateAdminOrderStatus(order.id, 'cancelled', 'Тестовый заказ'), {
    statusCode: 409,
    code: 'FORTE_WIDGET_REFUND_REJECTED',
  });
  assert.equal(h.current().refund_status, 'failed');
  assert.equal(h.bankRequests(), 1);
});

test('an unpersisted uncertain result is not reported as accepted', async (t) => {
  const h = harness(t, { saveFails: true });
  await assert.rejects(h.service.updateAdminOrderStatus(order.id, 'cancelled', 'Тестовый заказ'), {
    code: 'FORTE_WIDGET_REFUND_UNKNOWN',
  });
  assert.equal(h.bankRequests(), 1);
});

test('other refund callers retain their existing uncertain-result handling', async (t) => {
  const h = harness(t);
  await assert.rejects(h.service.cancelPaidOrder(order, 'Тестовый заказ'), {
    code: 'FORTE_WIDGET_REFUND_UNKNOWN',
  });
  assert.equal(h.current().refund_status, 'unknown');
});

test('automatic timeout cannot refund an order accepted during the cancellation claim', async (t) => {
  const h = harness(t, {
    acceptanceRaces: true,
    state: {
      fulfillment_status: 'new',
      staff_acceptance_requested_at: '2026-09-10T10:00:00Z',
      acceptance_timeout_at: null,
    },
  });
  await assert.rejects(
    h.service.cancelPaidOrder(h.current(), 'Не принят', {
      allowedFulfillmentStatuses: ['new'],
      cancelBeforeRefund: true,
      reuseRefundRequestId: true,
      unacceptedBefore: '2026-09-10T10:01:00Z',
    }),
    { code: 'PAYMENT_REFUND_CONFLICT' },
  );
  assert.equal(h.bankRequests(), 0);
  assert.equal(h.current().fulfillment_status, 'preparing');
});

test('automatic timeout persists cancellation and reuses an uncertain refund key', async (t) => {
  const h = harness(t, {
    state: {
      fulfillment_status: 'new',
      staff_acceptance_requested_at: '2026-09-10T10:00:00Z',
      acceptance_timeout_at: null,
    },
  });
  const options = {
    allowedFulfillmentStatuses: ['new'],
    cancelBeforeRefund: true,
    reuseRefundRequestId: true,
    unacceptedBefore: '2026-09-10T10:01:00Z',
  };
  await assert.rejects(h.service.cancelPaidOrder(h.current(), 'Не принят', options), {
    code: 'FORTE_WIDGET_REFUND_UNKNOWN',
  });
  const key = h.current().refund_request_id,
    started = h.current().refund_requested_at;
  assert.equal(h.current().fulfillment_status, 'cancelled');
  assert.ok(h.current().acceptance_timeout_at);
  await assert.rejects(
    h.service.cancelPaidOrder(h.current(), 'Не принят', {
      ...options,
      allowedFulfillmentStatuses: ['cancelled'],
    }),
    { code: 'FORTE_WIDGET_REFUND_UNKNOWN' },
  );
  assert.equal(h.current().refund_request_id, key);
  assert.equal(h.current().refund_requested_at, started);
  assert.equal(h.bankRequests(), 2);
});

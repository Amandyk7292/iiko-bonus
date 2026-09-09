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

function harness(t, { state = {}, declined = false, saveFails = false } = {}) {
  let current = { ...order, ...state };
  let bankRequests = 0;
  const updates = [];
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
          async maybeSingle() {
            if (patch?.refund_status === 'unknown' && saveFails) {
              return { data: null, error: new Error('storage unavailable') };
            }
            if (!filters.every(([column, value]) => current[column] === value)) {
              return { data: null, error: null };
            }
            if (patch) {
              updates.push({ patch, filters });
              current = { ...current, ...patch };
            }
            return { data: { ...current }, error: null };
          },
        };
      },
    },
  });
  installModule(t, '../src/services/external-delivery-lifecycle.service', {
    assertExternalDeliveryCancelled: async () => {},
  });
  installModule(t, '../src/services/payment-gateway.service', {
    paymentProviderName: () => 'ForteBank',
    refundPaymentForOrder: async (claimed, amount, options) => {
      bankRequests += 1;
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
  assert.ok(h.updates[1].filters.some(([key, value]) => key === 'refund_request_id' && value));
  await h.controller.updateAdminStatus(request, response);
  assert.equal(response.statusCode, 202);
  assert.equal(h.bankRequests(), 1);
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

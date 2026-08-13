const assert = require('node:assert/strict');
const test = require('node:test');

const {
  assertExternalDeliveryCancelled,
  isActiveExternalDeliveryJob,
} = require('../src/services/external-delivery-lifecycle.service');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';

const queryDb = (result, calls = []) => ({
  from(table) {
    calls.push(['from', table]);
    return {
      select(fields) {
        calls.push(['select', fields]);
        return this;
      },
      eq(column, value) {
        calls.push(['eq', column, value]);
        return this;
      },
      then(resolve, reject) {
        return Promise.resolve(result).then(resolve, reject);
      },
    };
  },
});

function installModule(t, path, exports) {
  const resolved = require.resolve(path);
  const previous = require.cache[resolved];
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[resolved] = previous;
    else delete require.cache[resolved];
  });
}

test('delivery terminal states are interpreted per immutable API family', () => {
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'cargo_v2', provider_status: 'delivered' }),
    false,
  );
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'business_v2', provider_status: 'complete' }),
    false,
  );
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'cargo_v2', provider_status: 'complete' }),
    true,
  );
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'business_v2', provider_status: 'delivered' }),
    true,
  );
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'business_v2', provider_status: 'expired' }),
    true,
  );
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'future_api', provider_status: 'done' }),
    true,
  );
  assert.equal(
    isActiveExternalDeliveryJob({ api_family: 'cargo_v2', provider_status: null }),
    true,
  );
});

test('refund guard allows only family-specific terminal delivery history', async () => {
  const calls = [];
  await assertExternalDeliveryCancelled(ORDER_ID, {
    db: queryDb(
      {
        data: [
          { api_family: 'cargo_v2', provider_status: 'cancelled_with_payment' },
          { api_family: 'business_v2', provider_status: 'finished' },
        ],
        error: null,
      },
      calls,
    ),
  });
  assert.deepEqual(calls, [
    ['from', 'delivery_jobs'],
    ['select', 'id,api_family,provider_status,external_claim_id'],
    ['eq', 'order_id', ORDER_ID],
    ['eq', 'provider', 'yandex'],
  ]);
});

test('refund guard requires explicit provider cancellation for uncertain jobs', async () => {
  await assert.rejects(
    assertExternalDeliveryCancelled(ORDER_ID, {
      db: queryDb({
        data: [{ api_family: 'business_v2', provider_status: 'creating_uncertain' }],
        error: null,
      }),
    }),
    (error) => error.statusCode === 409 && error.code === 'EXTERNAL_DELIVERY_CANCELLATION_REQUIRED',
  );
});

test('refund guard fails closed when delivery state cannot be read', async () => {
  await assert.rejects(
    assertExternalDeliveryCancelled(ORDER_ID, {
      db: queryDb({ data: null, error: new Error('database unavailable') }),
    }),
    (error) => error.statusCode === 503 && error.code === 'EXTERNAL_DELIVERY_STATE_UNAVAILABLE',
  );
});

test('full cancellation stops before claiming or calling the payment provider', async (t) => {
  let databaseTouched = false;
  let gatewayTouched = false;
  const requiredCancellation = Object.assign(new Error('cancel provider first'), {
    statusCode: 409,
    code: 'EXTERNAL_DELIVERY_CANCELLATION_REQUIRED',
  });

  installModule(t, '../src/config/supabase', {
    supabase: {
      from() {
        databaseTouched = true;
        throw new Error('refund claim must not start');
      },
    },
  });
  installModule(t, '../src/services/external-delivery-lifecycle.service', {
    assertExternalDeliveryCancelled: async () => {
      throw requiredCancellation;
    },
  });
  installModule(t, '../src/services/payment-gateway.service', {
    paymentProviderName: () => 'Forte',
    refundPaymentForOrder: async () => {
      gatewayTouched = true;
    },
  });

  const servicePath = require.resolve('../src/services/customer-order.service');
  const previous = require.cache[servicePath];
  delete require.cache[servicePath];
  t.after(() => {
    if (previous) require.cache[servicePath] = previous;
    else delete require.cache[servicePath];
  });
  const { cancelPaidOrder } = require(servicePath);

  await assert.rejects(
    cancelPaidOrder(
      {
        id: ORDER_ID,
        status: 'paid',
        fulfillment_status: 'new',
        refund_status: null,
        amount: 100,
      },
      'Отмена администратором',
    ),
    (error) => error === requiredCancellation,
  );
  assert.equal(databaseTouched, false);
  assert.equal(gatewayTouched, false);
});

test('partial refund stops before the financial claim when delivery is active', async (t) => {
  let rpcTouched = false;
  let gatewayTouched = false;
  const order = {
    id: ORDER_ID,
    status: 'paid',
    order_kind: 'regular',
    refund_status: null,
    cart_items: [{ id: 'bun', name: 'Булочка', price: 100, quantity: 1 }],
  };
  const requiredCancellation = Object.assign(new Error('cancel provider first'), {
    statusCode: 409,
    code: 'EXTERNAL_DELIVERY_CANCELLATION_REQUIRED',
  });
  installModule(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            return Promise.resolve({
              data: table === 'kaspi_orders' ? order : null,
              error: null,
            });
          },
        };
      },
      rpc() {
        rpcTouched = true;
        throw new Error('partial refund claim must not start');
      },
    },
  });
  installModule(t, '../src/services/external-delivery-lifecycle.service', {
    assertExternalDeliveryCancelled: async () => {
      throw requiredCancellation;
    },
  });
  installModule(t, '../src/services/payment-gateway.service', {
    paymentProviderName: () => 'Forte',
    reconcileRefundForOrder: async () => ({}),
    refundPaymentForOrder: async () => {
      gatewayTouched = true;
    },
  });

  const servicePath = require.resolve('../src/services/partial-refund.service');
  const previous = require.cache[servicePath];
  delete require.cache[servicePath];
  t.after(() => {
    if (previous) require.cache[servicePath] = previous;
    else delete require.cache[servicePath];
  });
  const { createPartialRefund } = require(servicePath);

  await assert.rejects(
    createPartialRefund(ORDER_ID, {
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
      items: [{ lineKey: 'bun:0', quantity: 1 }],
      reason: 'Нет товара',
    }),
    (error) => error === requiredCancellation,
  );
  assert.equal(rpcTouched, false);
  assert.equal(gatewayTouched, false);
});

test('substitution price-difference refund also requires provider cancellation', async (t) => {
  const requestId = '33333333-3333-4333-8333-333333333333';
  const order = {
    id: ORDER_ID,
    order_number: 10,
    status: 'paid',
    fulfillment_type: 'delivery',
    branch_id: '44444444-4444-4444-8444-444444444444',
    cart_items: [{ id: 'bun', name: 'Булочка', price: 100, quantity: 1 }],
  };
  const request = {
    id: requestId,
    order_id: ORDER_ID,
    line_key: 'bun:0',
    product_id: 'bun',
    product_name: 'Булочка',
    quantity: 1,
    action: 'replace_with_approval',
    status: 'approved',
    replacement_product_id: 'croissant',
    replacement_product_name: 'Круассан',
  };
  const rpcCalls = [];
  let gatewayTouched = false;
  const requiredCancellation = Object.assign(new Error('cancel provider first'), {
    statusCode: 409,
    code: 'EXTERNAL_DELIVERY_CANCELLATION_REQUIRED',
  });

  installModule(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          maybeSingle() {
            if (table === 'kaspi_orders') return Promise.resolve({ data: order, error: null });
            if (table === 'order_substitution_requests') {
              return Promise.resolve({ data: request, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      async rpc(name) {
        rpcCalls.push(name);
        if (name === 'prepare_order_substitution_execution') {
          return { data: { status: 'prepared', refundAmount: 30 }, error: null };
        }
        if (name === 'abort_order_substitution_execution') return { data: true, error: null };
        if (name === 'claim_partial_refund') {
          throw new Error('partial refund claim must not start');
        }
        return { data: null, error: null };
      },
    },
  });
  installModule(t, '../src/services/external-delivery-lifecycle.service', {
    assertExternalDeliveryCancelled: async () => {
      throw requiredCancellation;
    },
  });
  installModule(t, '../src/services/partial-refund.service', {
    applyRefundAdjustments: async () => ({}),
    createPartialRefund: async () => {
      throw new Error('generic partial refund must not start');
    },
    getRefundOptions: async () => ({
      lines: [{ lineKey: 'bun:0', unitAmount: 100 }],
    }),
  });
  installModule(t, '../src/services/inventory.service', {
    getBranchAvailability: async () => new Map(),
    listInventory: async () => [],
  });
  installModule(t, '../src/services/order.service', {
    loadOrderCatalog: async () =>
      new Map([
        [
          'croissant',
          {
            iikoProductId: 'croissant',
            productSizeId: 'size-1',
            name: 'Круассан',
            price: 70,
            isAvailable: true,
            availableQuantity: 2,
          },
        ],
      ]),
  });
  installModule(t, '../src/services/product-options.service', {
    validateCartOptions: async () => ({
      canonicalItems: [{ id: 'croissant', name: 'Круассан', price: 70 }],
    }),
  });
  installModule(t, '../src/services/payment-gateway.service', {
    paymentProviderName: () => 'Forte',
    refundPaymentForOrder: async () => {
      gatewayTouched = true;
    },
  });
  installModule(t, '../src/services/loyalty-sync.service', {
    queueCustomerLoyaltySync: () => {},
  });
  installModule(t, '../src/services/push.service', { sendPushToCustomer: async () => {} });
  installModule(t, '../src/services/realtime.service', { publish: () => {} });

  const servicePath = require.resolve('../src/services/order-substitution.service');
  const previous = require.cache[servicePath];
  delete require.cache[servicePath];
  t.after(() => {
    if (previous) require.cache[servicePath] = previous;
    else delete require.cache[servicePath];
  });
  const { completeSubstitution } = require(servicePath);

  await assert.rejects(
    completeSubstitution(ORDER_ID, requestId, 'owner-id', { role: 'owner' }),
    (error) => error === requiredCancellation,
  );
  assert.deepEqual(rpcCalls, [
    'prepare_order_substitution_execution',
    'abort_order_substitution_execution',
  ]);
  assert.equal(gatewayTouched, false);
});

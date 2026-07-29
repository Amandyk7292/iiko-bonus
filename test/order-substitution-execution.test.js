const assert = require('node:assert/strict');
const test = require('node:test');

const ORDER_ID = '317615f9-b35f-4eb4-9f6d-777f2236bb25';
const CUSTOMER_ID = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const BRANCH_ID = '217615f9-b35f-4eb4-9f6d-777f2236bb25';
const REQUEST_ID = '417615f9-b35f-4eb4-9f6d-777f2236bb25';
const REFUND_ID = '517615f9-b35f-4eb4-9f6d-777f2236bb25';

const modulePaths = {
  config: require.resolve('../src/config/supabase'),
  partial: require.resolve('../src/services/partial-refund.service'),
  inventory: require.resolve('../src/services/inventory.service'),
  order: require.resolve('../src/services/order.service'),
  options: require.resolve('../src/services/product-options.service'),
  gateway: require.resolve('../src/services/payment-gateway.service'),
  loyalty: require.resolve('../src/services/loyalty-sync.service'),
  push: require.resolve('../src/services/push.service'),
  realtime: require.resolve('../src/services/realtime.service'),
  service: require.resolve('../src/services/order-substitution.service'),
};

const cacheModule = (modulePath, exports) => {
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
};

function loadHarness({
  action = 'replace_with_approval',
  status = action === 'remove_refund' ? 'processing' : 'approved',
  replacementPrice = 70,
  preparedRefundAmount = Math.max(0, 100 - replacementPrice),
} = {}) {
  const previous = new Map(
    Object.values(modulePaths).map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const order = {
    id: ORDER_ID,
    order_number: 100030,
    customer_id: CUSTOMER_ID,
    branch_id: BRANCH_ID,
    client_request_id: '617615f9-b35f-4eb4-9f6d-777f2236bb25',
    status: 'paid',
    fulfillment_status: 'new',
    fulfillment_type: 'pickup',
    payment_method: 'forte_card',
    amount: 200,
    subtotal: 200,
    cart_items: [{ id: 'bun', name: 'Булочка', price: 100, quantity: 2 }],
  };
  const state = {
    request: {
      id: REQUEST_ID,
      order_id: ORDER_ID,
      customer_id: CUSTOMER_ID,
      line_key: 'bun:0',
      product_id: 'bun',
      product_name: 'Булочка',
      quantity: 1,
      action,
      status,
      replacement_product_id: action === 'replace_with_approval' ? 'croissant' : null,
      replacement_product_name: action === 'replace_with_approval' ? 'Круассан' : null,
      note: null,
      refund_amount: 0,
      waived_amount: 0,
      created_at: '2026-07-29T10:00:00.000Z',
      updated_at: '2026-07-29T10:00:00.000Z',
    },
    rpcCalls: [],
    gatewayCalls: [],
    partialCalls: [],
    published: [],
    inserted: null,
  };

  const builder = (table) => {
    let operation = 'read';
    let payload = null;
    const query = {
      select() {
        return this;
      },
      eq() {
        return this;
      },
      in() {
        return this;
      },
      order() {
        return this;
      },
      limit() {
        return this;
      },
      insert(value) {
        operation = 'insert';
        payload = value;
        return this;
      },
      update(value) {
        operation = 'update';
        payload = value;
        return this;
      },
      async single() {
        if (table === 'order_substitution_requests' && operation === 'insert') {
          state.request = {
            id: REQUEST_ID,
            ...payload,
            refund_amount: 0,
            waived_amount: 0,
            created_at: '2026-07-29T10:00:00.000Z',
            updated_at: '2026-07-29T10:00:00.000Z',
          };
          state.inserted = state.request;
          return { data: state.request, error: null };
        }
        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === 'kaspi_orders') return { data: order, error: null };
        if (table === 'order_substitution_requests') {
          if (operation === 'update') Object.assign(state.request, payload);
          return { data: state.request, error: null };
        }
        if (table === 'order_partial_refunds') return { data: null, error: null };
        return { data: null, error: null };
      },
      then(resolve, reject) {
        try {
          if (table === 'order_substitution_requests' && operation === 'update') {
            Object.assign(state.request, payload);
          }
          resolve({ data: null, error: null });
        } catch (error) {
          reject(error);
        }
      },
    };
    return query;
  };

  const rpc = async (name, args) => {
    state.rpcCalls.push({ name, args });
    if (name === 'prepare_order_substitution_execution') {
      return {
        data: {
          status: 'prepared',
          action,
          refundAmount: action === 'replace_with_approval' ? preparedRefundAmount : 0,
        },
        error: null,
      };
    }
    if (name === 'claim_partial_refund') {
      return {
        data: {
          id: REFUND_ID,
          status: 'processing',
          processor_token: args.p_processor_token,
          amount: args.p_amount,
        },
        error: null,
      };
    }
    if (name === 'complete_partial_refund') return { data: order, error: null };
    if (name === 'complete_order_substitution_execution') {
      Object.assign(state.request, {
        status: 'completed',
        refund_id: args.p_refund_id,
        refund_amount: action === 'replace_with_approval' ? preparedRefundAmount : Number(100),
        completed_at: '2026-07-29T10:01:00.000Z',
        updated_at: '2026-07-29T10:01:00.000Z',
      });
      return { data: { status: 'completed' }, error: null };
    }
    if (name === 'abort_order_substitution_execution') {
      Object.assign(state.request, { status: 'failed', error: args.p_error });
      return { data: true, error: null };
    }
    return { data: null, error: null };
  };

  cacheModule(modulePaths.config, { supabase: { from: builder, rpc } });
  cacheModule(modulePaths.partial, {
    applyRefundAdjustments: async () => ({ duplicate: false }),
    createPartialRefund: async (orderId, payload, requestedBy) => {
      state.partialCalls.push({ orderId, payload, requestedBy });
      return { id: REFUND_ID, status: 'succeeded', amount: 100 };
    },
    getRefundOptions: async () => ({
      lines: [
        {
          lineKey: 'bun:0',
          productId: 'bun',
          name: 'Булочка',
          quantity: 2,
          unitAmount: 100,
          refundableQuantity: 2,
        },
      ],
    }),
  });
  cacheModule(modulePaths.inventory, {
    getBranchAvailability: async () =>
      new Map([
        ['croissant', { productName: 'Круассан', availableQuantity: 5, isAvailable: true }],
      ]),
    listInventory: async () => [
      {
        product_id: 'croissant',
        product_name: 'Круассан',
        source_quantity: 5,
        manual_stop: false,
      },
    ],
  });
  cacheModule(modulePaths.order, {
    loadOrderCatalog: async () =>
      new Map([
        [
          'croissant',
          {
            iikoProductId: 'croissant',
            productSizeId: 'size-1',
            name: 'Круассан',
            price: replacementPrice,
            isAvailable: true,
            availableQuantity: 5,
            preparationMinutes: 15,
            source: 'iiko',
          },
        ],
      ]),
  });
  cacheModule(modulePaths.options, {
    validateCartOptions: async (items) => ({
      subtotal: replacementPrice,
      canonicalItems: [
        {
          ...items[0],
          price: replacementPrice,
          basePrice: replacementPrice,
          lineKey: 'replacement-line',
          configuration: null,
          modifiers: [],
        },
      ],
    }),
  });
  cacheModule(modulePaths.gateway, {
    paymentProviderName: () => 'ForteBank',
    refundPaymentForOrder: async (gatewayOrder, amount, options) => {
      state.gatewayCalls.push({ gatewayOrder, amount, options });
      return { reference: 'refund-reference' };
    },
  });
  cacheModule(modulePaths.loyalty, { queueCustomerLoyaltySync: () => undefined });
  cacheModule(modulePaths.push, { sendPushToCustomer: async () => undefined });
  cacheModule(modulePaths.realtime, {
    publish: (...args) => state.published.push(args),
  });
  delete require.cache[modulePaths.service];

  const restore = () => {
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  };
  return { service: require(modulePaths.service), state, restore };
}

test('approved cheaper replacement refunds only the price difference before atomic finalization', async (t) => {
  const harness = loadHarness({ replacementPrice: 70, preparedRefundAmount: 30 });
  t.after(harness.restore);

  const completed = await harness.service.completeSubstitution(ORDER_ID, REQUEST_ID, 'admin-1', {
    role: 'admin',
  });

  assert.equal(completed.status, 'completed');
  assert.equal(completed.refundId, REFUND_ID);
  assert.equal(completed.refundAmount, 30);
  assert.equal(harness.state.gatewayCalls.length, 1);
  assert.equal(harness.state.gatewayCalls[0].amount, 30);
  assert.deepEqual(
    harness.state.rpcCalls.map((call) => call.name),
    [
      'prepare_order_substitution_execution',
      'claim_partial_refund',
      'complete_partial_refund',
      'complete_order_substitution_execution',
    ],
  );
  assert.equal(
    harness.state.rpcCalls.at(-1).args.p_refund_id,
    REFUND_ID,
    'database finalization must bind the succeeded refund',
  );
});

test('higher-priced replacement is rejected without a charge or staged execution', async (t) => {
  const harness = loadHarness({ replacementPrice: 120, preparedRefundAmount: 0 });
  t.after(harness.restore);

  await assert.rejects(
    harness.service.completeSubstitution(ORDER_ID, REQUEST_ID, 'admin-1', { role: 'admin' }),
    (error) => error.code === 'REPLACEMENT_REQUIRES_ADDITIONAL_PAYMENT' && error.statusCode === 409,
  );
  assert.equal(harness.state.gatewayCalls.length, 0);
  assert.deepEqual(
    harness.state.rpcCalls.map((call) => call.name),
    ['abort_order_substitution_execution'],
  );
  assert.equal(harness.state.request.status, 'failed');
});

test('remove-and-refund executes the refund and cart/inventory finalization idempotency path', async (t) => {
  const harness = loadHarness({
    action: 'remove_refund',
    status: 'processing',
    replacementPrice: 70,
    preparedRefundAmount: 0,
  });
  t.after(harness.restore);

  const completed = await harness.service.createSubstitution(
    ORDER_ID,
    {
      lineKey: 'bun:0',
      quantity: 1,
      action: 'remove_refund',
      note: 'Нет в наличии',
    },
    'admin-2',
  );

  assert.equal(completed.status, 'completed');
  assert.equal(harness.state.partialCalls.length, 1);
  assert.deepEqual(harness.state.partialCalls[0].payload.items, [
    { lineKey: 'bun:0', quantity: 1 },
  ]);
  assert.deepEqual(
    harness.state.rpcCalls.map((call) => call.name),
    ['prepare_order_substitution_execution', 'complete_order_substitution_execution'],
  );
  assert.equal(harness.state.rpcCalls.at(-1).args.p_refund_id, REFUND_ID);
});

test('operator cannot complete an approved financial substitution', async (t) => {
  const harness = loadHarness({ replacementPrice: 70, preparedRefundAmount: 30 });
  t.after(harness.restore);

  await assert.rejects(
    harness.service.completeSubstitution(ORDER_ID, REQUEST_ID, 'operator-1', {
      role: 'operator',
    }),
    (error) =>
      error.code === 'SUBSTITUTION_FINANCIAL_PERMISSION_REQUIRED' && error.statusCode === 403,
  );

  assert.equal(harness.state.gatewayCalls.length, 0);
  assert.deepEqual(harness.state.rpcCalls, []);
});

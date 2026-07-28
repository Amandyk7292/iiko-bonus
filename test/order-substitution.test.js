const assert = require('node:assert/strict');
const test = require('node:test');

test('replacement workflow waits for explicit customer approval', async (t) => {
  const paths = {
    config: require.resolve('../src/config/supabase'),
    partial: require.resolve('../src/services/partial-refund.service'),
    inventory: require.resolve('../src/services/inventory.service'),
    push: require.resolve('../src/services/push.service'),
    realtime: require.resolve('../src/services/realtime.service'),
    service: require.resolve('../src/services/order-substitution.service'),
  };
  const previous = new Map(
    Object.values(paths).map((modulePath) => [modulePath, require.cache[modulePath]]),
  );
  const order = {
    id: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
    order_number: 100030,
    customer_id: '117615f9-b35f-4eb4-9f6d-777f2236bb25',
    branch_id: '217615f9-b35f-4eb4-9f6d-777f2236bb25',
    status: 'paid',
    fulfillment_status: 'new',
  };
  let inserted;
  const published = [];
  const builder = (table) => {
    let operation = 'read';
    let payload;
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
          inserted = {
            id: '417615f9-b35f-4eb4-9f6d-777f2236bb25',
            ...payload,
            created_at: '2026-07-28T12:00:00.000Z',
            updated_at: '2026-07-28T12:00:00.000Z',
          };
          return { data: inserted, error: null };
        }
        return { data: null, error: null };
      },
      async maybeSingle() {
        if (table === 'kaspi_orders') return { data: order, error: null };
        if (table === 'customer_notifications')
          return { data: { id: 'notification-1' }, error: null };
        if (table === 'order_substitution_requests' && operation === 'update') {
          return {
            data: {
              ...inserted,
              ...payload,
              status: payload.status,
            },
            error: null,
          };
        }
        return { data: null, error: null };
      },
    };
    return query;
  };

  require.cache[paths.config] = {
    id: paths.config,
    filename: paths.config,
    loaded: true,
    exports: { supabase: { from: builder } },
  };
  require.cache[paths.partial] = {
    id: paths.partial,
    filename: paths.partial,
    loaded: true,
    exports: {
      createPartialRefund: async () => {
        throw new Error('refund must not run before approval');
      },
      getRefundOptions: async () => ({
        lines: [
          {
            lineKey: 'bun:0',
            productId: 'bun',
            name: 'Булочка',
            refundableQuantity: 2,
          },
        ],
      }),
    },
  };
  require.cache[paths.inventory] = {
    id: paths.inventory,
    filename: paths.inventory,
    loaded: true,
    exports: {
      getBranchAvailability: async () =>
        new Map([
          [
            'croissant',
            {
              productName: 'Круассан',
              availableQuantity: 5,
              isAvailable: true,
            },
          ],
        ]),
      listInventory: async () => [
        {
          product_id: 'croissant',
          product_name: 'Круассан',
          source_quantity: 5,
          manual_stop: false,
        },
      ],
    },
  };
  require.cache[paths.push] = {
    id: paths.push,
    filename: paths.push,
    loaded: true,
    exports: { sendPushToCustomer: async () => undefined },
  };
  require.cache[paths.realtime] = {
    id: paths.realtime,
    filename: paths.realtime,
    loaded: true,
    exports: { publish: (...args) => published.push(args) },
  };
  delete require.cache[paths.service];
  t.after(() => {
    for (const [modulePath, cached] of previous) {
      if (cached) require.cache[modulePath] = cached;
      else delete require.cache[modulePath];
    }
  });

  const service = require(paths.service);
  const created = await service.createSubstitution(
    order.id,
    {
      lineKey: 'bun:0',
      quantity: 1,
      action: 'replace_with_approval',
      replacementProductId: 'croissant',
      note: 'Свежий круассан',
    },
    'admin',
  );
  assert.equal(created.status, 'awaiting_customer');
  assert.equal(created.replacementProductName, 'Круассан');

  const approved = await service.respondToSubstitution(
    order.customer_id,
    order.id,
    created.id,
    true,
  );
  assert.equal(approved.status, 'approved');
  assert.ok(published.length >= 2);
});

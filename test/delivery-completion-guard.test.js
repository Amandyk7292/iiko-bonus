const assert = require('node:assert/strict');
const test = require('node:test');

const { assertDeliveryCompletionAllowed } = require('../src/services/customer-order.service');

test('general status endpoint cannot complete an unconfirmed delivery', () => {
  for (const deliveryStatus of ['unassigned', 'assigned', 'picked_up', 'en_route', null]) {
    assert.throws(
      () =>
        assertDeliveryCompletionAllowed(
          {
            fulfillment_type: 'delivery',
            fulfillment_status: 'ready',
            delivery_status: deliveryStatus,
          },
          'completed',
        ),
      (error) => error.statusCode === 409 && error.code === 'DELIVERY_CONFIRMATION_REQUIRED',
    );
  }
});

test('confirmed Yandex delivery can finish through order reconciliation', () => {
  assert.doesNotThrow(() =>
    assertDeliveryCompletionAllowed(
      {
        fulfillment_type: 'delivery',
        fulfillment_status: 'ready',
        delivery_status: 'delivered',
      },
      'completed',
    ),
  );
});

test('pickup completion and non-terminal delivery updates remain available', () => {
  assert.doesNotThrow(() =>
    assertDeliveryCompletionAllowed(
      { fulfillment_type: 'pickup', fulfillment_status: 'ready' },
      'completed',
    ),
  );
  assert.doesNotThrow(() =>
    assertDeliveryCompletionAllowed(
      {
        fulfillment_type: 'delivery',
        fulfillment_status: 'preparing',
        delivery_status: 'assigned',
      },
      'ready',
    ),
  );
});

test('delivery preorder also requires trusted delivery confirmation', () => {
  assert.throws(
    () =>
      assertDeliveryCompletionAllowed(
        {
          fulfillment_type: 'preorder',
          preorder_fulfillment_type: 'delivery',
          fulfillment_status: 'ready',
          delivery_status: 'en_route',
        },
        'completed',
      ),
    (error) => error.code === 'DELIVERY_CONFIRMATION_REQUIRED',
  );
});

test('admin status service rejects an unconfirmed delivery before issuing an update', async (t) => {
  let updateCalls = 0;
  const current = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'paid',
    fulfillment_type: 'delivery',
    fulfillment_status: 'ready',
    delivery_status: 'en_route',
    branch_id: 'branch-1',
  };
  const query = {
    select() {
      return this;
    },
    eq() {
      return this;
    },
    update() {
      updateCalls += 1;
      return this;
    },
    maybeSingle() {
      return Promise.resolve({ data: { ...current }, error: null });
    },
  };
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/customer-order.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: { from: () => query } },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { updateAdminOrderStatus } = require(servicePath);
  await assert.rejects(
    updateAdminOrderStatus(current.id, 'completed'),
    (error) => error.code === 'DELIVERY_CONFIRMATION_REQUIRED',
  );
  assert.equal(updateCalls, 0);
});

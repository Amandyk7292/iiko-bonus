const assert = require('node:assert/strict');
const test = require('node:test');

test('automatic dispatch loads the branch and registered customer before route validation', async (t) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/delivery-orchestration.service');
  const yandexPath = require.resolve('../src/services/yandex-delivery.service');
  const previous = new Map(
    [configPath, servicePath, yandexPath].map((key) => [key, require.cache[key]]),
  );
  t.after(() => {
    for (const [key, value] of previous) {
      if (value) require.cache[key] = value;
      else delete require.cache[key];
    }
  });
  const order = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'paid',
    fulfillment_type: 'delivery',
    fulfillment_status: 'preparing',
    courier_dispatch_requested_at: '2026-09-09T06:00:00Z',
    courier_dispatch_status: 'pending',
    delivery_latitude: 43.68,
    delivery_longitude: 51.16,
    delivery_address: { city: 'Актау', address: '34 микрорайон', house: '14' },
  };
  const branch = {
    id: 'branch-1',
    name: 'Premium Plaza',
    city: 'Актау',
    address: '18A, 1',
    latitude: 43.67,
    longitude: 51.13,
  };
  const customer = { name: 'Customer', phone: '77760000000' };
  const supabase = {
    from(table) {
      assert.equal(table, 'kaspi_orders');
      let columns = '*';
      let updates;
      const query = {
        select(value) {
          columns = value;
          return query;
        },
        update(value) {
          updates = value;
          return query;
        },
        eq() {
          return query;
        },
        is() {
          return query;
        },
        async maybeSingle() {
          Object.assign(order, updates);
          return {
            data: {
              ...order,
              ...(columns.includes('bulka_locations(') && { bulka_locations: branch }),
              ...(columns.includes('customers(') && { customers: customer }),
            },
            error: null,
          };
        },
        then(resolve, reject) {
          return query.maybeSingle().then(resolve, reject);
        },
      };
      return query;
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  delete require.cache[servicePath];
  delete require.cache[yandexPath];
  const { processDeliveryDispatch } = require(servicePath);
  const { validateDeliveryOrder } = require(yandexPath);
  let dispatched = 0;
  const result = await processDeliveryDispatch(order.id, {
    yandexDelivery: {
      getConfigurationStatus: () => ({ autoDispatch: true, configured: true, apiMode: 'cargo_v2' }),
      validateDeliveryOrder(value) {
        const route = validateDeliveryOrder(value, { senderPhone: '+77000000000' });
        assert.equal(route.branchCity, 'Актау');
        assert.equal(route.customerPhone, '+77760000000');
      },
      async dispatchOrder(id) {
        assert.equal(id, order.id);
        dispatched++;
        return { id };
      },
    },
    dispatchService: {},
    realtime: { publish() {} },
  });
  assert.equal(result.provider, 'yandex');
  assert.equal(dispatched, 1);
  assert.equal(order.courier_dispatch_status, 'succeeded');
});

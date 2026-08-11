const assert = require('node:assert/strict');
const test = require('node:test');

const ORDER_ID = '11111111-1111-4111-8111-111111111111';
const deliveryOrder = {
  id: ORDER_ID,
  fulfillment_type: 'delivery',
  courier_id: null,
};

const loadService = (t, job) => {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/delivery-orchestration.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  const fakeSupabase = {
    from(table) {
      assert.equal(table, 'delivery_jobs');
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        async limit(value) {
          assert.equal(value, 1);
          return { data: job ? [{ ...job }] : [], error: null };
        },
      };
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: fakeSupabase },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  return require(servicePath);
};

test('terminal Yandex jobs cannot hand off retained automobile metadata', async (t) => {
  for (const providerStatus of ['cancelled', 'failed']) {
    await t.test(providerStatus, async (t) => {
      const { assertAutomobileCourierForHandoff } = loadService(t, {
        provider_status: providerStatus,
        courier_transport_type: 'car',
        courier_car_model: 'Toyota Camry',
        courier_car_number: '123 ABC 12',
        created_at: '2026-08-11T10:00:00.000Z',
      });

      await assert.rejects(
        () => assertAutomobileCourierForHandoff(deliveryOrder),
        (error) =>
          error.statusCode === 409 &&
          error.code === 'YANDEX_DELIVERY_NOT_ACTIVE' &&
          error.message.includes(`«${providerStatus}»`),
      );
    });
  }
});

test('active assigned Yandex automobile jobs remain handoff eligible', async (t) => {
  for (const providerStatus of ['performer_found', 'pickup_arrived']) {
    await t.test(providerStatus, async (t) => {
      const { assertAutomobileCourierForHandoff } = loadService(t, {
        provider_status: providerStatus,
        courier_transport_type: 'car',
        courier_car_model: 'Toyota Camry',
        courier_car_number: '123 ABC 12',
        created_at: '2026-08-11T10:00:00.000Z',
      });

      assert.equal(await assertAutomobileCourierForHandoff(deliveryOrder), true);
    });
  }
});

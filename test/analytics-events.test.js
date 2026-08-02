const assert = require('node:assert/strict');
const test = require('node:test');

const servicePath = require.resolve('../src/services/analytics-event.service');
const configPath = require.resolve('../src/config/supabase');

function loadAnalyticsService(capture) {
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        from(table) {
          assert.equal(table, 'customer_app_events');
          return {
            async insert(rows) {
              capture(Array.isArray(rows) ? rows : [rows]);
              return { error: null };
            },
          };
        },
      },
    },
  };
  delete require.cache[servicePath];

  return {
    service: require(servicePath),
    restore() {
      if (previousConfig) require.cache[configPath] = previousConfig;
      else delete require.cache[configPath];
      if (previousService) require.cache[servicePath] = previousService;
      else delete require.cache[servicePath];
    },
  };
}

test('analytics normalizes legacy funnel names before persistence', async (t) => {
  const rows = [];
  const loaded = loadAnalyticsService((captured) => rows.push(...captured));
  t.after(loaded.restore);

  await loaded.service.recordCustomerEvents(
    '117615f9-b35f-4eb4-9f6d-777f2236bb25',
    [
      { type: 'checkout_start' },
      { type: 'checkout_started' },
    ],
    { headers: { 'x-bulka-session': 'analytics-test-session' } },
  );
  await loaded.service.recordSystemEvent(null, { type: 'payment_created' });

  assert.deepEqual(
    rows.map((row) => row.event_type),
    ['checkout_started', 'checkout_started', 'payment_started'],
  );
  assert.equal(loaded.service.EVENT_TYPES.has('checkout_started'), true);
  assert.equal(loaded.service.EVENT_TYPES.has('payment_started'), true);
  assert.equal(loaded.service.EVENT_TYPES.has('checkout_start'), false);
});

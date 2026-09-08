const assert = require('node:assert/strict');
const test = require('node:test');

for (const status of ['pending', 'cancelled', 'refunded', 'paid']) {
  test(`Live Activity registration requires an owned, paid order: ${status}`, async (t) => {
    const configPath = require.resolve('../src/config/supabase');
    const servicePath = require.resolve('../src/services/live-activity.service');
    const oldConfig = require.cache[configPath];
    const oldService = require.cache[servicePath];
    t.after(() => {
      if (oldConfig) require.cache[configPath] = oldConfig;
      else delete require.cache[configPath];
      if (oldService) require.cache[servicePath] = oldService;
      else delete require.cache[servicePath];
    });
    let writes = 0;
    const filters = [];
    require.cache[configPath] = {
      id: configPath,
      filename: configPath,
      loaded: true,
      exports: {
        supabase: {
          from(table) {
            return {
              select() {
                return this;
              },
              eq(key, value) {
                filters.push([key, value]);
                return this;
              },
              maybeSingle: async () => ({
                data: { id: 'order', status, fulfillment_status: 'new' },
                error: null,
              }),
              upsert(value) {
                assert.equal(table, 'customer_live_activity_tokens');
                writes++;
                return this;
              },
              single: async () => ({ data: { active: true }, error: null }),
            };
          },
        },
      },
    };
    delete require.cache[servicePath];
    const { registerLiveActivityToken } = require(servicePath);
    const run = () =>
      registerLiveActivityToken('customer', {
        pushToken: 'a'.repeat(64),
        activityId: 'activity',
        installationId: 'phone',
        orderId: 'order',
      });
    if (status === 'paid') {
      await run();
      assert.equal(writes, 1);
    } else {
      await assert.rejects(run, (error) => error.statusCode === 409);
      assert.equal(writes, 0);
    }
    assert.ok(filters.some(([key, value]) => key === 'customer_id' && value === 'customer'));
  });
}

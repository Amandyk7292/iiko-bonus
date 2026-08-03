const assert = require('node:assert/strict');
const test = require('node:test');

function loadSettingsService(t, rows = []) {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/settings.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  const calls = { select: 0, upsert: [] };
  const supabase = {
    from(table) {
      assert.equal(table, 'settings');
      return {
        async select() {
          calls.select += 1;
          return { data: structuredClone(rows), error: null };
        },
        async upsert(payload, options) {
          calls.upsert.push({ payload: structuredClone(payload), options });
          return { error: null };
        },
      };
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase },
  };
  delete require.cache[servicePath];
  const service = require(servicePath);
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  return { service, calls };
}

test('settings reads are coalesced and cached for hot request paths', async (t) => {
  const { service, calls } = loadSettingsService(t, [{ key: 'base_cashback_percent', value: '5' }]);

  const [first, second] = await Promise.all([service.getSettings(), service.getSettings()]);
  assert.equal(calls.select, 1);
  assert.equal(first.base_cashback_percent, 5);
  assert.equal(second, first);

  assert.equal((await service.getSettings()).base_cashback_percent, 5);
  assert.equal(calls.select, 1);
  service.clearSettingsCache();
  await service.getSettings();
  assert.equal(calls.select, 2);
});

test('settings updates use one bulk upsert and refresh the cache', async (t) => {
  const { service, calls } = loadSettingsService(t);
  await service.getSettings();
  await service.updateSettings({
    base_cashback_percent: 4,
    tier_silver_th: 60000,
  });

  assert.equal(calls.upsert.length, 1);
  assert.deepEqual(calls.upsert[0], {
    payload: [
      { key: 'base_cashback_percent', value: '4' },
      { key: 'tier_silver_th', value: '60000' },
    ],
    options: { onConflict: 'key' },
  });
  const settings = await service.getSettings();
  assert.equal(settings.base_cashback_percent, 4);
  assert.equal(settings.tier_silver_th, 60000);
  assert.equal(calls.select, 1);
});

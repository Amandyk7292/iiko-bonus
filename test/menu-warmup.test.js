const test = require('node:test');
const assert = require('node:assert/strict');
const { warmMenus } = require('../src/services/menu-warmup.service');

test('warmup refreshes before expiry, skips fresh/unconfigured clients and deduplicates profiles', async () => {
  const calls = [];
  const client = {
    apiLogin: 'test',
    cachedMenu: {},
    cachedMenuExpiresAt: Date.now() + 20000,
    getMenu: async (options) => calls.push(options),
  };
  await warmMenus([client, client, { apiLogin: '' }]);
  assert.deepEqual(calls, [{ strict: true, forceRefresh: true }]);
  client.cachedMenuExpiresAt = Date.now() + 300000;
  await warmMenus([client]);
  assert.equal(calls.length, 1);
  client.cachedMenu = null;
  await warmMenus([client]);
  assert.deepEqual(calls[1], { strict: true, forceRefresh: false });
});

test('one unavailable iiko profile does not block warming another', async () => {
  let loaded = false;
  await warmMenus([
    {
      apiLogin: 'a',
      getMenu: async () => {
        throw new Error('offline');
      },
    },
    {
      apiLogin: 'b',
      getMenu: async () => {
        loaded = true;
      },
    },
  ]);
  assert.equal(loaded, true);
});

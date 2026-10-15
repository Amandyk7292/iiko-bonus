const test = require('node:test');
const assert = require('node:assert/strict');

function worker(t, rpc) {
  const cached = new Map();
  const synchronized = [];
  const stub = (path, exports) => {
    const id = require.resolve(path);
    cached.set(id, require.cache[id]);
    require.cache[id] = { id, filename: id, loaded: true, exports };
  };
  stub('../src/config/supabase', { supabase: { rpc } });
  stub('../src/services/loyalty-sync.service', {
    queueCustomerLoyaltySync(id) {
      synchronized.push(id);
    },
  });
  stub('../src/services/realtime.service', { publish() {} });
  stub('../src/services/settings.service', { getSettings: async () => ({}) });
  const path = require.resolve('../src/services/customer.service');
  cached.set(path, require.cache[path]);
  delete require.cache[path];
  t.after(() => {
    for (const [id, old] of cached)
      if (old) require.cache[id] = old;
      else delete require.cache[id];
  });
  return { run: require(path).checkAndExpireInactiveBonuses, synchronized };
}

test('expiry worker batches due lots and synchronizes only changed wallets; old days are ignored', async (t) => {
  let calls = 0;
  const { run, synchronized } = worker(t, async (name, args) => {
    assert.equal(name, 'expire_due_bonus_credit_lots');
    assert.deepEqual(args, { p_limit: 200 });
    calls++;
    return {
      data:
        calls === 1
          ? {
              expiredCount: 2,
              totalExpiredAmount: 300.15,
              customerIds: ['one', 'two'],
              hasMore: true,
            }
          : { expiredCount: 1, totalExpiredAmount: 200.25, customerIds: ['three'], hasMore: false },
    };
  });
  assert.deepEqual(await run(1), { expiredCount: 3, totalExpiredAmount: 500.4 });
  assert.deepEqual(synchronized, ['one', 'two', 'three']);
  assert.equal(calls, 2);
});

test('expiry worker exposes database failure and never substitutes whole-wallet write off', async (t) => {
  const { run, synchronized } = worker(t, async () => ({ error: { message: 'database offline' } }));
  await assert.rejects(run(), /database offline/);
  assert.deepEqual(synchronized, []);
});

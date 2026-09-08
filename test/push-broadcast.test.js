const assert = require('node:assert/strict');
const test = require('node:test');
const { broadcastCustomerPush } = require('../src/services/push-broadcast.service');
const titles = { ru: 'Русский', kk: 'Қазақша', en: 'English' };
const bodies = { ru: 'Текст', kk: 'Мәтін', en: 'Body' };
function fixture(customers, { readError, outcome } = {}) {
  const calls = [],
    ranges = [],
    notifications = [];
  return {
    calls,
    ranges,
    notifications,
    deps: {
      db: {
        from(table) {
          if (table === 'customers')
            return {
              select() {
                return this;
              },
              order() {
                return this;
              },
              async range(start, end) {
                ranges.push([start, end]);
                return { data: customers.slice(start, end + 1), error: readError };
              },
            };
          assert.equal(table, 'customer_notifications');
          return {
            insert(rows) {
              notifications.push(...rows);
              return {
                async select() {
                  return {
                    data: rows.map((r) => ({
                      id: `n-${r.customer_id}`,
                      customer_id: r.customer_id,
                    })),
                  };
                },
              };
            },
          };
        },
      },
      send: async (...args) => {
        calls.push(args);
        return typeof outcome === 'function'
          ? outcome(args[0])
          : outcome || { attempted: 0, delivered: 0 };
      },
    },
  };
}
test('zero registered devices is not reported as a successful push', async () => {
  const f = fixture([{ id: 'a' }]);
  const result = await broadcastCustomerPush(titles, bodies, f.deps);
  assert.equal(result.success, false);
  assert.equal(result.status, 'no_recipients');
  assert.equal(result.savedCount, 1);
  assert.equal(result.count, 0);
});
test('invalid device token, queued delivery and partial delivery are distinct', async () => {
  for (const [outcome, expected, success] of [
    [{ attempted: 1, delivered: 0, failed: 1 }, 'failed', false],
    [{ attempted: 1, delivered: 0, failed: 1, queued: true }, 'queued', true],
    [{ attempted: 2, delivered: 1, failed: 1 }, 'partial', true],
  ]) {
    const f = fixture([{ id: 'a' }], { outcome });
    const result = await broadcastCustomerPush(titles, bodies, f.deps);
    assert.equal(result.status, expected);
    assert.equal(result.success, success);
  }
});
test('recipients count people, includes token-table-only customers and preserves language', async () => {
  const f = fixture([{ id: 'a', fcm_token: null, preferred_language: 'kk' }], {
    outcome: { attempted: 2, delivered: 2 },
  });
  const result = await broadcastCustomerPush(titles, bodies, f.deps);
  assert.equal(result.count, 1);
  assert.equal(result.deliveredDevices, 2);
  assert.deepEqual(f.calls[0], [
    'a',
    titles.kk,
    bodies.kk,
    { notificationId: 'n-a', type: 'broadcast' },
    null,
  ]);
});
test('database failures do not look like an empty successful audience', async () => {
  const f = fixture([], { readError: new Error('database unavailable') });
  await assert.rejects(broadcastCustomerPush(titles, bodies, f.deps), /database unavailable/);
  assert.equal(f.calls.length, 0);
});
test('the audience is paginated past the database default row limit', async () => {
  const f = fixture(Array.from({ length: 1001 }, (_, id) => ({ id: String(id) })));
  const result = await broadcastCustomerPush(titles, bodies, f.deps);
  assert.equal(result.savedCount, 1001);
  assert.equal(f.calls.length, 1001);
  assert.equal(new Set(f.calls.map((c) => c[0])).size, 1001);
  assert.equal(f.ranges.length, 5);
});

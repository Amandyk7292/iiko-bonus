const assert = require('node:assert/strict');
const test = require('node:test');
const {
  pickupLiveActivityExpiresAt,
  isPickupLiveActivityExpired,
} = require('../src/utils/live-activity-expiry.util');
const { expireReadyPickupActivities } = require('../src/services/live-activity-expiry.service');
const now = Date.parse('2026-09-09T06:00:00Z');
const ready = {
  id: 'ready',
  status: 'paid',
  fulfillment_status: 'ready',
  fulfillment_type: 'pickup',
  kitchen_ready_at: '2026-09-09T05:00:00Z',
};

test('expiry uses actual readiness and covers pickup preorders only', () => {
  assert.equal(pickupLiveActivityExpiresAt(ready), '2026-09-09T06:00:00.000Z');
  assert.equal(isPickupLiveActivityExpired(ready, now - 1), false);
  assert.equal(isPickupLiveActivityExpired(ready, now), true);
  assert.equal(
    isPickupLiveActivityExpired({ ...ready, updated_at: '2026-09-09T05:59:59Z' }, now),
    true,
  );
  assert.equal(
    isPickupLiveActivityExpired(
      { ...ready, fulfillment_type: 'preorder', preorder_fulfillment_type: 'pickup' },
      now,
    ),
    true,
  );
  for (const order of [
    { ...ready, fulfillment_type: 'delivery' },
    { ...ready, fulfillment_status: 'preparing' },
    { ...ready, kitchen_ready_at: 'invalid' },
  ])
    assert.equal(pickupLiveActivityExpiresAt(order), null);
});

function clientFor(rows) {
  return {
    from(table) {
      assert.equal(table, 'customer_live_activity_tokens');
      let cursor = '';
      return {
        select() {
          return this;
        },
        eq(key, value) {
          assert.equal(key, 'active');
          assert.equal(value, true);
          return this;
        },
        order() {
          return this;
        },
        limit() {
          return this;
        },
        gt(key, value) {
          assert.equal(key, 'id');
          cursor = value;
          return this;
        },
        then(resolve) {
          return Promise.resolve({
            data: rows.filter((row) => row.id > cursor).slice(0, 200),
          }).then(resolve);
        },
      };
    },
  };
}

test('worker pages active tokens, deduplicates orders and leaves deliveries alone', async () => {
  const rows = Array.from({ length: 201 }, (_, index) => ({
    id: String(index).padStart(4, '0'),
    order: index < 200 ? { ...ready, fulfillment_type: 'delivery' } : ready,
  }));
  rows.push({ id: '0201', order: ready });
  const sent = [];
  const result = await expireReadyPickupActivities({
    now,
    client: clientFor(rows),
    send: async (order) => {
      sent.push(order.id);
      return { attempted: 2, delivered: 2, failed: 0 };
    },
  });
  assert.deepEqual(sent, ['ready']);
  assert.deepEqual(result, { orders: 1, attempted: 2, delivered: 2, failed: 0 });
});

test('worker reports a failed expiry and retries the active order next run', async () => {
  const client = clientFor([{ id: '1', order: ready }]);
  await assert.rejects(
    expireReadyPickupActivities({ now, client, send: async () => ({ attempted: 1, failed: 1 }) }),
    /need retry/,
  );
  const result = await expireReadyPickupActivities({
    now,
    client,
    send: async () => ({ attempted: 1, delivered: 1 }),
  });
  assert.equal(result.delivered, 1);
});

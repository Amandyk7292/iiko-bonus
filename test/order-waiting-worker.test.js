const test = require('node:test');
const assert = require('node:assert/strict');
const { processOrderWaiting } = require('../src/services/order-waiting-policy.service');
function harness({ retry = false, resolution = null, noticeFailure = false } = {}) {
  const events = [],
    calls = [],
    filters = [];
  const order = {
    id: 'order',
    fulfillment_status: retry ? 'cancelled' : 'ready',
    courier_timeout_at: '2026-09-28T00:00:00Z',
    refund_request_id: 'original-key',
    delivery_resolution: resolution,
  };
  const db = {
    rpc: async (name) => {
      assert.equal(name, 'claim_order_waiting_notices');
      return { data: [{ order_id: 'order', order_number: 1, branch_id: 'branch', stage: 5 }] };
    },
    from: () => {
      const q = {};
      let updating = false;
      for (const m of ['select', 'eq', 'is', 'not', 'lt', 'or', 'order', 'limit'])
        q[m] = (...args) => {
          filters.push([m, ...args]);
          return q;
        };
      q.update = () => {
        updating = true;
        return q;
      };
      q.then = (resolve) =>
        Promise.resolve({ data: updating ? null : [order], error: null }).then(resolve);
      return q;
    },
  };
  return {
    events,
    calls,
    filters,
    run: () =>
      processOrderWaiting({
        db,
        now: Date.parse('2026-10-03T12:00:00Z'),
        publish: (...args) => events.push(args),
        resolveDelivery: async (options) => {
          assert.equal(options.db, db);
          assert.equal(options.now.toISOString(), '2026-10-03T12:00:00.000Z');
          calls.push('resolution');
          if (noticeFailure) throw new Error('push unavailable');
        },
        closeDelivery: async () => calls.push('delivery'),
        cancel: async (o, reason, options) => {
          assert.equal(reason, 'Нет курьера');
          assert.equal(options.reuseRefundRequestId, true);
          assert.equal(options.courierTimeout, true);
          assert.equal(o.refund_request_id, 'original-key');
          calls.push('refund');
        },
      }),
  };
}
test('ready courier timeout delegates durable customer decision and never auto-cancels payment', async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.calls, ['resolution']);
  assert.deepEqual(h.events[0][2].roles, ['owner', 'admin', 'branch_manager']);
  assert.equal(h.events[0][2].branchId, 'branch');
  assert.ok(
    h.filters.some(
      ([m, key, value]) => m === 'eq' && key === 'fulfillment_status' && value === 'cancelled',
    ),
  );
});
test('already cancelled historical refunds retain original request and do not cancel provider twice', async () => {
  const h = harness({ retry: true });
  await h.run();
  assert.deepEqual(h.calls, ['resolution', 'refund']);
});
test('new resolution cancellation is handled only by its own state machine', async () => {
  const h = harness({ retry: true, resolution: { status: 'cancel_refunding' } });
  await h.run();
  assert.deepEqual(h.calls, ['resolution']);
  assert.ok(
    h.filters.some(
      ([m, key, value]) => m === 'is' && key === 'delivery_resolution' && value === null,
    ),
  );
});

test('pending notice outage does not starve an already cancelled historical refund', async () => {
  const h = harness({ retry: true, noticeFailure: true });
  await assert.rejects(h.run(), AggregateError);
  assert.deepEqual(h.calls, ['resolution', 'refund']);
});

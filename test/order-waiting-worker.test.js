const test = require('node:test');
const assert = require('node:assert/strict');
const { processOrderWaiting } = require('../src/services/order-waiting-policy.service');
function harness({ assigned = false, closeError = null, retry = false } = {}) {
  const events = [],
    calls = [],
    updates = [];
  const order = {
    id: 'order',
    fulfillment_status: retry ? 'cancelled' : 'preparing',
    courier_timeout_at: '2026-09-28T00:00:00Z',
    refund_request_id: 'original-key',
  };
  const db = {
    rpc: async (name) =>
      name === 'claim_order_waiting_notices'
        ? { data: [{ order_id: 'order', order_number: 1, branch_id: 'branch', stage: 5 }] }
        : { data: assigned ? [] : [order] },
    from: () => {
      let update = false;
      const q = {};
      for (const m of ['select', 'eq', 'is', 'not', 'lt', 'or', 'order', 'limit']) q[m] = () => q;
      q.update = (value) => {
        update = true;
        updates.push(value);
        return q;
      };
      q.then = (resolve) =>
        Promise.resolve({ data: update ? null : [order], error: null }).then(resolve);
      return q;
    },
  };
  return {
    calls,
    updates,
    events,
    run: () =>
      processOrderWaiting({
        db,
        publish: (...args) => events.push(args),
        closeDelivery: async () => {
          calls.push('delivery');
          if (closeError) throw closeError;
        },
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
test('20 minute timeout closes courier before refund; manager notice is branch and role scoped', async () => {
  const h = harness();
  await h.run();
  assert.deepEqual(h.calls, ['delivery', 'refund']);
  assert.deepEqual(h.events[0][2].roles, ['owner', 'admin', 'branch_manager']);
  assert.equal(h.events[0][2].branchId, 'branch');
});
test('assignment winning DB claim never cancels delivery or payment', async () => {
  const h = harness({ assigned: true });
  await h.run();
  assert.deepEqual(h.calls, []);
});
test('uncertain provider cancellation does not start refund', async () => {
  const h = harness({ closeError: Error('provider offline') });
  await assert.rejects(h.run(), AggregateError);
  assert.deepEqual(h.calls, ['delivery']);
});
test('fresh provider assignment releases timeout intent without refund', async () => {
  const h = harness({
    closeError: Object.assign(Error('assigned'), { code: 'COURIER_TIMEOUT_NOT_UNASSIGNED' }),
  });
  await h.run();
  assert.deepEqual(h.calls, ['delivery']);
  assert.ok(h.updates.some((x) => x.courier_timeout_at === null));
});
test('retry of a claimed refund reuses original operation without cancelling delivery again', async () => {
  const h = harness({ retry: true });
  await h.run();
  assert.deepEqual(h.calls, ['refund']);
});

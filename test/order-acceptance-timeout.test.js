const test = require('node:test');
const assert = require('node:assert/strict');
const { cancelUnacceptedOrders } = require('../src/services/order-acceptance-timeout.service');
function database(orders) {
  const calls = [];
  const db = {
    from(table) {
      assert.equal(table, 'kaspi_orders');
      const query = {};
      for (const method of ['update', 'select', 'eq', 'or', 'not', 'lt', 'order', 'limit'])
        query[method] = (...args) => {
          calls.push([method, ...args]);
          return query;
        };
      query.then = (resolve) => Promise.resolve({ data: orders, error: null }).then(resolve);
      return query;
    },
  };
  return { db, calls };
}
test('15 minute cutoff excludes recently paid orders and retries claimed refunds with their original key', async () => {
  const { db, calls } = database([
    { id: 'first' },
    { id: 'retry', acceptance_timeout_at: '2026-09-10T10:00:00Z' },
  ]);
  const cancelled = [];
  const result = await cancelUnacceptedOrders({
    db,
    now: Date.parse('2026-09-10T10:15:00Z'),
    cancel: async (order, reason, options) => cancelled.push({ order, reason, options }),
  });
  assert.equal(result.cancelled, 2);
  assert.ok(
    calls.some(
      (c) =>
        c[0] === 'or' &&
        c[1].includes('staff_acceptance_requested_at.lte.2026-09-10T10:00:00.000Z'),
    ),
  );
  assert.deepEqual(
    cancelled.map((c) => c.options.allowedFulfillmentStatuses),
    [['new'], ['cancelled']],
  );
  assert.ok(
    cancelled.every(
      (c) =>
        c.options.reuseRefundRequestId &&
        c.options.cancelBeforeRefund &&
        !c.options.acceptPendingRefund,
    ),
  );
});
test('one failed refund does not interrupt other orders; a cashier winning acceptance is not cancelled', async () => {
  const { db } = database([{ id: 'bad' }, { id: 'accepted' }, { id: 'next' }]),
    seen = [];
  await assert.rejects(
    cancelUnacceptedOrders({
      db,
      cancel: async (order) => {
        seen.push(order.id);
        if (order.id === 'bad') throw Error('bank offline');
        if (order.id === 'accepted')
          throw Object.assign(Error('accepted'), { code: 'PAYMENT_REFUND_CONFLICT' });
      },
    }),
    (error) =>
      error instanceof AggregateError &&
      error.errors.length === 1 &&
      error.errors[0].message === 'bank offline',
  );
  assert.deepEqual(seen, ['bad', 'accepted', 'next']);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildBranch } = require('../src/services/bought-together-online.service');
test('branch fallback uses only paid branch receipts in the 30-day window and excludes refunds', async () => {
  const calls = [];
  const query = {};
  for (const method of ['select', 'eq', 'gte', 'lt', 'order'])
    query[method] = (...args) => {
      calls.push([method, ...args]);
      return query;
    };
  query.range = async () => ({
    data: [
      {
        id: 'a',
        cart_items: [
          { id: 'astana:bun', quantity: 1 },
          { id: 'astana:coffee', quantity: 1 },
        ],
      },
      {
        id: 'b',
        cart_items: [
          { id: 'astana:bun', quantity: 1 },
          { id: 'astana:coffee', quantity: 1 },
        ],
      },
      { id: 'c', refund_amount: 1, cart_items: [{ id: 'bad', quantity: 1 }] },
      { id: 'd', fulfillment_status: 'cancelled', cart_items: [{ id: 'cancelled', quantity: 1 }] },
    ],
    error: null,
  });
  const result = await buildBranch(
    'branch-a',
    { from: () => query },
    new Date('2026-09-13T22:00:00Z'),
  );
  assert(
    calls.some((call) => call[0] === 'eq' && call[1] === 'branch_id' && call[2] === 'branch-a'),
  );
  assert(calls.some((call) => call[0] === 'eq' && call[1] === 'status' && call[2] === 'paid'));
  assert(calls.some((call) => call[0] === 'gte' && call[2] === '2026-08-16T00:00:00+05:00'));
  assert(calls.some((call) => call[0] === 'lt' && call[2] === '2026-09-15T00:00:00+05:00'));
  assert.deepEqual(result.products['astana:bun'], ['astana:coffee']);
  assert(!result.popularProducts.includes('bad'));
  assert(!result.popularProducts.includes('cancelled'));
});

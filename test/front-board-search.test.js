const test = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const { frontBoardQuerySchema } = require('../src/contracts/front-order-board.contract');

test('cashier search validates exact order numbers and cannot override branch scope', async () => {
  for (const search of ['100042', '999999999999999', ''])
    assert.equal(frontBoardQuerySchema.safeParse({ search }).success, true);
  for (const search of ['0', '-1', '123x', '1,branch_id.eq.foreign', '1'.repeat(16)])
    assert.equal(frontBoardQuerySchema.safeParse({ search }).success, false);
  assert.equal(
    frontBoardQuerySchema.safeParse({ search: '100042', branchId: 'foreign' }).success,
    false,
  );
  const queries = [];
  const database = {
    from: () => {
      const calls = [];
      queries.push(calls);
      const q = {};
      for (const op of ['select', 'eq', 'neq', 'or', 'order'])
        q[op] = (...args) => {
          calls.push([op, ...args]);
          return q;
        };
      q.range = async () => ({ data: [], count: 0 });
      return q;
    },
  };
  const original = Module._load;
  let service;
  try {
    Module._load = function (id, parent, ...args) {
      if (parent?.filename.endsWith('front-order-board.service.js')) {
        if (id === '../config/supabase') return { supabase: database };
        if (id === './kitchen.service') return { updateKitchenStatus: () => {} };
        if (id === './front-order-inbox.service') return { decideFrontOrder: () => {} };
        if (id === './front-remaining-order.service')
          return { attachFrontRemainingOrders: async (rows) => rows };
      }
      return original.call(this, id, parent, ...args);
    };
    service = require('../src/services/front-order-board.service');
  } finally {
    Module._load = original;
  }
  const result = await service.listFrontBoard('own-branch', { search: '100042' });
  assert.equal(result.search, '100042');
  assert.equal(queries.length, 4);
  for (const query of queries) {
    assert.ok(query.some((c) => c[0] === 'eq' && c[1] === 'branch_id' && c[2] === 'own-branch'));
    assert.ok(query.some((c) => c[0] === 'eq' && c[1] === 'order_number' && c[2] === 100042));
  }
  assert.ok(
    queries[3].some((c) => c[0] === 'or' && c[1].includes('fulfillment_status.eq.completed')),
  );
  assert.ok(
    !JSON.stringify(queries[3]).includes('fulfilled_at.gte.'),
    'number search includes older completed orders',
  );
  queries.length = 0;
  const all = await service.listFrontBoard('own-branch');
  assert.equal(all.search, '');
  assert.ok(
    JSON.stringify(queries[3]).includes('fulfilled_at.gte.'),
    'normal board retains recent-history limit',
  );
});

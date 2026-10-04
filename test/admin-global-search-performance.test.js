const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { branchScopeForAdmin } = require('../src/utils/admin-scope.util');

const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
const tick = () => new Promise(setImmediate);

// All rows and reads are synthetic; this loader cannot contact Supabase.
function fixture(read) {
  const calls = [];
  const db = {
    from(table) {
      const query = { table, fields: '', filters: [] };
      const builder = {};
      for (const method of ['select', 'eq', 'is', 'in', 'ilike', 'limit', 'order']) {
        builder[method] = (...args) => {
          if (method === 'select') query.fields = args[0];
          query.filters.push([method, ...args]);
          return builder;
        };
      }
      builder.then = (resolve, reject) => {
        calls.push(query);
        return Promise.resolve()
          .then(() => read(query))
          .then(resolve, reject);
      };
      builder.maybeSingle = () => builder;
      return builder;
    },
  };
  const context = {
    module: { exports: {} },
    require: (name) => {
      if (name === '../config/supabase') return { supabase: db };
      if (name === '../utils/admin-scope.util') return { branchScopeForAdmin };
      if (name === './customer-order.service')
        return { normalizeOrder: (order) => ({ id: order.id }) };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  };
  vm.runInNewContext(
    fs.readFileSync(require.resolve('../src/services/admin-global-search.service'), 'utf8'),
    context,
  );
  return { ...context.module.exports, calls };
}
const customer = { id: 'customer', name: 'Гость', phone: '42', updated_at: '2026-10-03T12:00:00Z' };
const order = {
  id: 'order',
  order_number: '42',
  customer_id: 'customer',
  branch_id: 'branch',
  branch_name: 'Точка',
  updated_at: customer.updated_at,
};
const support = {
  id: 'support',
  customer_id: 'customer',
  message: '42',
  updated_at: customer.updated_at,
};
const has = (query, method, field) =>
  query.filters.find((filter) => filter[0] === method && filter[1] === field);

test('direct matches start before customer lookups finish, related matches keep filtered branch IDs', async () => {
  const gate = deferred();
  const service = fixture(async (query) => {
    if (query.table === 'customers') {
      await gate.promise;
      return { data: [customer, { ...customer, id: 'outside' }] };
    }
    if (query.fields === 'customer_id') return { data: [{ customer_id: customer.id }] };
    return { data: query.table === 'kaspi_orders' ? [order] : [support] };
  });
  const pending = service.globalSearch(
    { role: 'editor', branchIds: ['branch'] },
    { q: '42', limit: 20 },
  );
  await tick();
  assert.equal(service.calls.filter((query) => query.table === 'customers').length, 2);
  assert(service.calls.some((query) => has(query, 'eq', 'order_number')));
  assert(service.calls.some((query) => has(query, 'ilike', 'message')));
  gate.resolve();
  const result = await pending;
  assert.deepEqual(Array.from(result, (row) => `${row.type}:${row.id}`).sort(), [
    'customer:customer',
    'order:order',
    'support:support',
  ]);
  for (const query of service.calls.filter((query) => query.table !== 'customers')) {
    assert(
      has(query, 'in', query.table === 'kaspi_orders' ? 'branch_id' : 'kaspi_orders.branch_id'),
    );
    const relation = has(query, 'in', 'customer_id');
    if (relation && query.fields !== 'customer_id')
      assert.deepEqual(Array.from(relation[2]), ['customer']);
  }
});

test('marketer direct search never reads order results; unsupported roles perform no reads', async () => {
  const service = fixture(() => ({ data: [] }));
  await service.globalSearch({ role: 'marketer', branchIds: ['branch'] }, { q: '42', limit: 20 });
  assert(
    !service.calls.some(
      (query) => query.table === 'kaspi_orders' && query.fields !== 'customer_id',
    ),
  );
  const forbidden = fixture(() => {
    throw new Error('Must not read');
  });
  await assert.rejects(forbidden.globalSearch({ role: 'cashier' }, { q: '42' }), {
    statusCode: 403,
  });
  assert.equal(forbidden.calls.length, 0);
});

test('customer detail reads history in parallel but still requires a scoped purchase', async () => {
  const gate = deferred();
  const service = fixture(async (query) => {
    if (query.table === 'customers') return { data: customer };
    if (query.table === 'kaspi_orders') {
      await gate.promise;
      return { data: [] };
    }
    return { data: [] };
  });
  const pending = assert.rejects(
    service.globalSearchDetail({ role: 'editor', branchIds: ['branch'] }, 'customer', 'customer'),
    { statusCode: 404 },
  );
  await tick();
  assert.deepEqual(
    service.calls.map((query) => query.table).sort(),
    ['customers', 'kaspi_orders', 'customer_support_requests', 'admin_audit_logs'].sort(),
  );
  for (const query of service.calls.slice(1)) {
    assert(
      has(
        query,
        'in',
        query.table === 'customer_support_requests' ? 'kaspi_orders.branch_id' : 'branch_id',
      ),
    );
  }
  gate.resolve();
  await pending;
});

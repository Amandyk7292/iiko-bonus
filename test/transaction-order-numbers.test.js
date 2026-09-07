const assert = require('node:assert/strict');
const test = require('node:test');

test('transaction search and page enrichment use real order numbers within branch scope', async (t) => {
  const calls = [];
  const rows = [
    { order_id: 'kaspi:operation-1', type: 'deposit' },
    { order_id: 'kaspi:operation-1:refund', type: 'refund_reversal' },
    { order_id: 'MANUAL', type: 'manual_deposit' },
  ];
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/customer.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  const client = {
    from(table) {
      const result = {
        data:
          table === 'transactions'
            ? rows
            : table === 'customers'
              ? []
              : [{ operation_id: 'operation-1', order_number: 100039 }],
        error: null,
        count: rows.length,
      };
      const query = {
        then(resolve) {
          return Promise.resolve(result).then(resolve);
        },
      };
      for (const method of ['select', 'in', 'eq', 'or', 'order', 'range', 'limit']) {
        query[method] = (...args) => {
          calls.push([table, method, ...args]);
          return query;
        };
      }
      return query;
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: client },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });
  const { getTransactions } = require(servicePath);
  const result = await getTransactions({ search: '#100039', branchIds: ['branch-1'] });
  assert.deepEqual(
    result.transactions.map((row) => row.order_number),
    [100039, 100039, null],
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'kaspi_orders' &&
        call[1] === 'eq' &&
        call[2] === 'order_number' &&
        call[3] === 100039,
    ),
  );
  assert.equal(
    calls.filter(
      (call) => call[0] === 'kaspi_orders' && call[1] === 'in' && call[2] === 'branch_id',
    ).length,
    2,
  );
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'transactions' &&
        call[1] === 'or' &&
        call[2].includes('kaspi:operation-1:refund'),
    ),
  );
  assert.deepEqual(
    calls.find(
      (call) => call[0] === 'kaspi_orders' && call[1] === 'in' && call[2] === 'operation_id',
    )[3],
    ['operation-1'],
  );
});

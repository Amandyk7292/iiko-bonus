const assert = require('node:assert/strict');
const test = require('node:test');

test('admin payment issues include failed payments, refund failures, and recorded errors', async (t) => {
  const calls = [];
  const query = {
    select() {
      return this;
    },
    eq(column, value) {
      calls.push(['eq', column, value]);
      return this;
    },
    neq(column, value) {
      calls.push(['neq', column, value]);
      return this;
    },
    in(column, value) {
      calls.push(['in', column, value]);
      return this;
    },
    or(expression) {
      calls.push(['or', expression]);
      return this;
    },
    order() {
      return this;
    },
    range() {
      return Promise.resolve({ data: [], error: null, count: 0 });
    },
  };
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/customer-order.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: {
      supabase: {
        from(table) {
          assert.equal(table, 'kaspi_orders');
          return query;
        },
      },
    },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { listAdminOrders } = require(servicePath);
  await listAdminOrders({ paymentStatus: 'issues' });

  assert.deepEqual(calls, [
    ['neq', 'status', 'expired'],
    ['or', 'status.in.(failed,expired),refund_status.in.(failed,unknown),last_error.not.is.null'],
  ]);
  calls.length = 0;
  await listAdminOrders();
  assert.deepEqual(calls, [['neq', 'status', 'expired']]);
  calls.length = 0;
  await listAdminOrders({ paymentStatus: 'expired' });
  assert.deepEqual(calls, [['eq', 'status', 'expired']]);
});

const assert = require('node:assert/strict');
const test = require('node:test');

test('customer financial details combine scoped bonuses with the prepaid ledger', async (t) => {
  const calls = [];
  const fixtures = {
    customers: [
      { id: 'customer-1', name: 'Амандык', phone: '777', balance: 120, total_spent: 5000 },
    ],
    personal_accounts: [
      {
        customer_id: 'customer-1',
        balance_minor: 125050,
        blocked: false,
        updated_at: '2026-09-24T10:00:00Z',
      },
    ],
    transactions: [
      {
        id: 'bonus-1',
        customer_id: 'customer-1',
        type: 'deposit',
        amount: 50,
        description: 'За покупку',
        order_id: 'kaspi:operation-1',
        branch_id: 'branch-1',
        timestamp: '2026-09-24T09:00:00Z',
      },
    ],
    personal_account_entries: [
      {
        id: 'entry-1',
        customer_id: 'customer-1',
        amount_minor: -25000,
        kind: 'payment',
        source_key: 'order-payment:order-1',
        order_id: 'order-1',
        topup_id: null,
        created_at: '2026-09-24T09:30:00Z',
      },
    ],
    kaspi_orders: [
      {
        id: 'order-1',
        operation_id: 'operation-1',
        order_number: 101,
        branch_id: 'branch-1',
      },
    ],
    personal_account_topups: [],
    bulka_locations: [{ id: 'branch-1', name: '19А', city: 'Актау' }],
  };
  const db = {
    from(table) {
      let rows = fixtures[table] || [];
      let single = false;
      const query = {
        select() {
          return query;
        },
        eq(field, value) {
          calls.push([table, 'eq', field, value]);
          rows = rows.filter((row) => String(row[field]) === String(value));
          return query;
        },
        is(field, value) {
          rows = rows.filter((row) => (row[field] ?? null) === value);
          return query;
        },
        in(field, values) {
          calls.push([table, 'in', field, values]);
          rows = rows.filter((row) => values.map(String).includes(String(row[field])));
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle() {
          single = true;
          return Promise.resolve({ data: rows[0] || null, error: null });
        },
        then(resolve) {
          return Promise.resolve({ data: single ? rows[0] || null : rows, error: null }).then(
            resolve,
          );
        },
      };
      return query;
    },
  };
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/customer-financial-details.service');
  const previousConfig = require.cache[configPath];
  const previousService = require.cache[servicePath];
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: db },
  };
  delete require.cache[servicePath];
  t.after(() => {
    if (previousConfig) require.cache[configPath] = previousConfig;
    else delete require.cache[configPath];
    if (previousService) require.cache[servicePath] = previousService;
    else delete require.cache[servicePath];
  });

  const { getCustomerFinancialDetails } = require(servicePath);
  const result = await getCustomerFinancialDetails('customer-1', { branchIds: ['branch-1'] }, db);
  assert.equal(result.bonus.balance, 120);
  assert.equal(result.bonus.entries[0].description, 'За покупку');
  assert.equal(result.bonus.entries[0].orderNumber, 101);
  assert.equal(result.bonus.entries[0].branch.name, '19А');
  assert.equal(result.personalAccount.balance, 1250.5);
  assert.equal(result.personalAccount.entries[0].amount, -250);
  assert.equal(result.personalAccount.entries[0].orderNumber, 101);
  assert.ok(
    calls.some(
      (call) =>
        call[0] === 'transactions' &&
        call[1] === 'in' &&
        call[2] === 'branch_id' &&
        call[3][0] === 'branch-1',
    ),
  );
});

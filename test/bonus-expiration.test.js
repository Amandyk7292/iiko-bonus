const assert = require('node:assert/strict');
const test = require('node:test');
const {
  attachBonusExpiration,
  loadBonusActivity,
  listPositiveCustomers,
} = require('../src/services/bonus-expiration.service');

test('customer expiry advertises only the nearest remaining tranche, never the whole wallet', async () => {
  const client = {
    rpc: async (name, args) => {
      assert.equal(name, 'bonus_expiry_customer_forecasts');
      assert.deepEqual(args.p_customer_ids, ['active']);
      return {
        data: [
          { customer_id: 'active', next_expiry_at: '2027-02-01T12:00:00Z', expiring_amount: 40 },
        ],
      };
    },
  };
  const rows = await attachBonusExpiration(
    client,
    [
      { id: 'active', balance: 100 },
      { id: 'empty', balance: 0 },
    ],
    {
      bonus_expiration: { enabled: true, auto_write_off: true, expiration_days: 90 },
    },
  );
  assert.equal(rows[0].bonus_expires_at, '2027-02-01T12:00:00Z');
  assert.equal(rows[0].bonus_expiring_amount, 40);
  assert.equal(rows[0].bonus_expiration_months, 6);
  assert.equal(rows[1].bonus_expires_at, null);
});

test('disabled expiration makes no activity request and never advertises a burn date', async () => {
  const client = {
    rpc: () => {
      throw new Error('must not read activity');
    },
  };
  for (const policy of [{ enabled: false }, { enabled: true, auto_write_off: false }]) {
    const [row] = await attachBonusExpiration(client, [{ id: 'one', balance: 100 }], {
      bonus_expiration: policy,
    });
    assert.equal(row.bonus_expiration_enabled, false);
    assert.equal(row.bonus_expires_at, null);
  }
});

test('activity read errors stop expiration rather than treating clients as inactive', async () => {
  await assert.rejects(
    loadBonusActivity({ rpc: async () => ({ error: { message: 'offline' } }) }, [{ id: 'one' }]),
    /offline/,
  );
});

test('customer forecasts batch beyond API row limits', async () => {
  const rows = Array.from({ length: 1101 }, (_, id) => ({ id: String(id), balance: 1 }));
  const client = {
    from: () => {
      const query = {
        select: () => query,
        gt: () => query,
        order: () => query,
        range: async (from, to) => ({ data: rows.slice(from, to + 1) }),
      };
      return query;
    },
  };
  const customers = await listPositiveCustomers(client);
  assert.equal(customers.length, 1101);
  const batches = [];
  await attachBonusExpiration(
    {
      rpc: async (_name, args) => {
        batches.push(args.p_customer_ids.length);
        return { data: [] };
      },
    },
    customers,
    { bonus_expiration: { enabled: true } },
  );
  assert.deepEqual(batches, [500, 500, 101]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { getBonusExpirySummary } = require('../src/services/bonus-expiry.service');

function fixture({ enabled = true, auto_write_off = true, recent = true } = {}) {
  const customer = {
    id: 'active-customer',
    balance: 100,
    created_at: new Date(Date.now() - 100 * 86400000).toISOString(),
  };
  const lastActivity = new Date(Date.now() - (recent ? 1 : 81) * 86400000).toISOString();
  const rows = Array.from({ length: 5000 }, (_, index) => ({
    id: `${index}`,
    type: index % 2 ? 'withdrawal' : 'deposit',
    amount: 1,
    timestamp: new Date(Date.now() - (400 - index / 20) * 86400000).toISOString(),
  }));
  rows.push({ id: 'recent', type: 'deposit', amount: 100, timestamp: lastActivity });
  const pages = [];
  const db = {
    async rpc(name) {
      assert.equal(name, 'customer_bonus_activity');
      return { data: [{ customer_id: customer.id, last_activity_at: lastActivity }] };
    },
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        order() {
          return this;
        },
        async maybeSingle() {
          assert.equal(table, 'customers');
          return { data: customer };
        },
        async range(start, end) {
          pages.push(start);
          return { data: rows.slice(start, end + 1) };
        },
      };
    },
  };
  return {
    db,
    pages,
    settingsProvider: async () => ({
      bonus_expiration: { enabled, auto_write_off, expiration_days: 90 },
    }),
  };
}

test('expiry forecast honors disabled automatic write off and disabled policy', async () => {
  for (const policy of [{ auto_write_off: false }, { enabled: false }]) {
    const context = fixture({ recent: false, ...policy });
    const result = await getBonusExpirySummary('active-customer', context);
    assert.equal(result.currentBalance, 100);
    assert.equal(result.totalExpiring, 0);
    assert.equal(result.nextExpiryAt, null);
    assert.deepEqual(context.pages, []);
  }
});

test('more than5000transactions retain current activity and recent credited balance', async () => {
  const context = fixture();
  const result = await getBonusExpirySummary('active-customer', context);
  assert.equal(result.totalExpiring, 0);
  assert.equal(result.nextExpiryAt, null);
  assert.deepEqual(context.pages, [0, 1000, 2000, 3000, 4000, 5000]);
});

test('inactive customer forecast uses the same policy deadline as automatic expiry', async () => {
  const context = fixture({ recent: false });
  const result = await getBonusExpirySummary('active-customer', context);
  assert.equal(result.totalExpiring, 100);
  assert.equal(result.buckets[0].daysRemaining, 9);
});

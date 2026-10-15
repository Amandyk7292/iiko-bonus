const test = require('node:test');
const assert = require('node:assert/strict');
const { getBonusExpirySummary } = require('../src/services/bonus-expiry.service');

test('forecast returns the authoritative lot totals including nearest expiry amount', async () => {
  const summary = {
    currentBalance: 700,
    totalExpiring: 500,
    nextExpiryAmount: 500,
    nextExpiryAt: '2027-01-15T07:00:00Z',
    expirationMonths: 6,
    buckets: [{ expiresAt: '2027-01-15T07:00:00Z', amount: 500, daysRemaining: 7 }],
  };
  const db = {
    async rpc(name, args) {
      assert.equal(name, 'bonus_expiry_summary');
      assert.deepEqual(args, { p_customer_id: 'customer', p_days: 30 });
      return { data: summary };
    },
  };
  assert.deepEqual(await getBonusExpirySummary('customer', { db }), summary);
});

test('forecast never guesses a deadline on database failure or a missing customer', async () => {
  await assert.rejects(
    getBonusExpirySummary('customer', {
      db: { rpc: async () => ({ error: new Error('offline') }) },
    }),
    /offline/,
  );
  await assert.rejects(
    getBonusExpirySummary('missing', { db: { rpc: async () => ({ data: null }) } }),
    { statusCode: 404 },
  );
});

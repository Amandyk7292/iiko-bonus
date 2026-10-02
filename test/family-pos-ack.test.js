const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const customerId = crypto.randomUUID();
const branchId = crypto.randomUUID();
const orderId = crypto.randomUUID();
const reservationId = crypto.randomUUID();
const calls = [];
let notified = 0;
function stub(path, exports) {
  const id = require.resolve(path);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
const refunded = {
  status: 'family_refunded',
  balance: 321,
  duplicate: true,
  earned_bonus: 0,
  discount_applied: 0,
};
stub('../src/config/supabase', {
  supabase: {
    async rpc(name) {
      calls.push(name);
      return { data: refunded };
    },
    from(table) {
      const query = {
        select() {
          return query;
        },
        eq() {
          return query;
        },
        maybeSingle: async () => ({
          data:
            table === 'customers'
              ? { total_spent: 0 }
              : { order_total: 1000, discount_amount: 0, status: 'cancelled' },
        }),
      };
      return query;
    },
  },
});
stub('../src/services/settings.service', {
  getSettings: async () => ({
    max_discount_percent: 50,
    base_cashback_percent: 5,
    bonus_activation: { enabled: false },
  }),
});
stub('../src/services/tier.service', { getActiveLoyaltyTiers: async () => [] });
stub('../src/services/customer.service', { activatePendingBonusesSafe: async () => {} });
stub('../src/services/push.service', {
  notifyBonusChange: async () => {
    notified++;
  },
});
stub('../src/services/loyalty-sync.service', {
  queueCustomerLoyaltySync() {
    notified++;
  },
});
const { reserveLoyalty, commitLoyalty } = require('../src/services/loyalty-reservation.service');
const { applyBonus } = require('../src/controllers/loyalty.controller');
const payload = {
  customerId,
  orderId,
  orderTotal: 1000,
  discountAmount: 0,
  items: [
    { productId: crypto.randomUUID(), productName: 'Булочка', amount: 2, price: 500, total: 1000 },
  ],
};

test('refunded family receipt is safely acknowledged without reserving or committing new bonuses', async () => {
  calls.length = 0;
  const result = await reserveLoyalty(payload, { branchId });
  assert.equal(result.skipped, true);
  assert.equal(result.reason, 'FAMILY_PURCHASE_REFUNDED');
  assert.equal(result.earnedBonus, 0);
  assert.equal(result.discountApplied, 0);
  assert.equal(result.newBalance, 321);
  assert.equal(result.duplicate, true);
  assert.equal(result.reservationId, undefined);
  assert.deepEqual(calls, ['reserve_branch_loyalty_balance']);
});

test('late queued receipt receives a successful zero-earn acknowledgement without a notification', async () => {
  calls.length = 0;
  notified = 0;
  const res = {
    statusCode: 200,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };
  await applyBonus({ body: payload, posBranchId: branchId, posAuthMode: 'branch' }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.success, true);
  assert.equal(res.body.skipped, true);
  assert.equal(res.body.earnedBonus, 0);
  assert.equal(notified, 0);
  assert.deepEqual(calls, ['reserve_branch_loyalty_balance']);
});

test('refund racing an existing reservation is acknowledged at atomic commit with no new earn', async () => {
  calls.length = 0;
  const result = await commitLoyalty({ ...payload, reservationId }, { branchId });
  assert.equal(result.success, true);
  assert.equal(result.skipped, true);
  assert.equal(result.duplicate, true);
  assert.equal(result.earnedBonus, 0);
  assert.equal(result.newBalance, 321);
  assert.deepEqual(calls, ['commit_branch_loyalty_reservation']);
});

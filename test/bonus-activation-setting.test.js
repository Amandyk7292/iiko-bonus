// Load the real payment-state service with local doubles; no remote calls.
const assert = require('node:assert/strict');
const root = '../src/';
const stub = (path, exports) => {
  const resolved = require.resolve(root + path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
let captured;
let commitResult = { status: 'committed' };
const commitCalls = [];
const order = {
  id: 'audit-order',
  customer_id: 'audit-customer',
  subtotal: 1000,
  amount: 1000,
  operation_id: 'audit-op',
  cart_items: [],
};
stub('config/supabase', {
  supabase: {
    from() {
      return {
        update() {
          return this;
        },
        eq() {
          return this;
        },
        select() {
          return this;
        },
        single: async () => ({ data: order }),
      };
    },
  },
});
stub('services/inventory.service', {});
stub('services/realtime.service', {});
stub('services/analytics-event.service', {});
stub('services/loyalty-sync.service', { queueCustomerLoyaltySync() {} });
stub('services/eta.service', {});
stub('services/customer.service', {
  getCustomerById: async () => ({ total_spent: 0 }),
  applyLoyaltyTransaction: async () => assert.fail('Online cashback must hold the order lock'),
});
stub('services/settings.service', {
  getSettings: async () => ({ bonus_activation: { enabled: false, delay_days: 3 } }),
});
stub('services/tier.service', { getActiveLoyaltyTiers: async () => [] });
stub('utils/tier.util', { getTierInfo: () => ({ percent: 3 }) });
stub('services/checkout-bonus.service', {
  commitCheckoutBonus: async (_o, _earned, delay) => {
    captured = delay;
    commitCalls.push({ order: _o, earned: _earned, delay });
    return commitResult;
  },
});
require('node:test')(
  'online bonus awards disable the delay in both debit and credit paths',
  async () => {
    const service = require(root + 'services/order-payment-state.service');
    for (const bonusSpent of [0, 100]) {
      await service.awardOrderBonus({ ...order, bonus_spent: bonusSpent });
      assert.equal(captured, 0);
    }
    assert.deepEqual(
      commitCalls.map((call) => call.order.bonus_spent),
      [0, 100],
    );
  },
);
require('node:test')(
  'cashback returns the committed ledger result and respects a racing refund',
  async () => {
    const service = require(root + 'services/order-payment-state.service');
    const committedAt = '2026-10-18T10:00:00.000Z';
    commitResult = { status: 'committed', earnedBonus: 17, bonusAwardedAt: committedAt };
    const result = await service.awardOrderBonus({ ...order, bonus_spent: 0 });
    assert.equal(result.earned_bonus, 17);
    assert.equal(result.bonus_awarded_at, committedAt);
    commitResult = { status: 'unavailable' };
    assert.equal(await service.awardOrderBonus({ ...order, bonus_spent: 0 }), null);
  },
);

// Load the real payment-state service with local doubles; no remote calls.
const assert = require('node:assert/strict');
const root = '../src/';
const stub = (path, exports) => {
  const resolved = require.resolve(root + path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
};
let captured;
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
  applyLoyaltyTransaction: async (p) => {
    captured = p.activationDelayDays;
  },
});
stub('services/settings.service', {
  getSettings: async () => ({ bonus_activation: { enabled: false, delay_days: 3 } }),
});
stub('services/tier.service', { getActiveLoyaltyTiers: async () => [] });
stub('utils/tier.util', { getTierInfo: () => ({ percent: 3 }) });
stub('services/checkout-bonus.service', {
  commitCheckoutBonus: async (_o, _earned, delay) => {
    captured = delay;
    return { status: 'committed' };
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
  },
);

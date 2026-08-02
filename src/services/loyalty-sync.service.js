const { supabase } = require('../config/supabase');
const {
  resolveWalletTier,
  sendAppleWalletPush,
  updateGoogleWalletObject,
} = require('./wallet.service');
const realtime = require('./realtime.service');

const queued = new Map();

async function syncCustomerLoyalty(customerId) {
  if (typeof supabase?.from !== 'function') {
    return { customer: null, providers: [], skipped: 'database-unavailable' };
  }
  const { data: customer, error } = await supabase
    .from('customers')
    .select('id,phone,name,balance,total_spent,updated_at')
    .eq('id', customerId)
    .maybeSingle();
  if (error) throw error;
  if (!customer) return { customer: null, providers: [] };

  realtime.publish(
    'loyalty.balance.updated',
    {
      balance: Number(customer.balance || 0),
      totalSpent: Number(customer.total_spent || 0),
      updatedAt: customer.updated_at || new Date().toISOString(),
    },
    { customerId: customer.id },
  );

  const { tier } = await resolveWalletTier(customer);
  const providers = await Promise.allSettled([
    sendAppleWalletPush(customer.id),
    updateGoogleWalletObject(customer, tier),
  ]);
  for (const [index, result] of providers.entries()) {
    if (result.status !== 'rejected') continue;
    const provider = index === 0 ? 'Apple Wallet' : 'Google Wallet';
    console.error(`${provider} sync failed:`, result.reason?.message || String(result.reason));
  }
  return { customer, tier, providers };
}

function queueCustomerLoyaltySync(customerId) {
  const id = String(customerId || '').trim();
  if (!id) return;
  const existing = queued.get(id);
  if (existing) {
    existing.rerun = true;
    return;
  }

  const state = { rerun: true };
  queued.set(id, state);
  setImmediate(async () => {
    try {
      while (state.rerun) {
        state.rerun = false;
        await syncCustomerLoyalty(id);
      }
    } catch (error) {
      console.error('Loyalty realtime sync failed:', error.message);
    } finally {
      queued.delete(id);
    }
  });
}

module.exports = { queueCustomerLoyaltySync, syncCustomerLoyalty };

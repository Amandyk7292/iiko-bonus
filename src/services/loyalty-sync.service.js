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

  let tier;
  const providers = await Promise.allSettled([
    sendAppleWalletPush(customer.id),
    (async () => {
      ({ tier } = await resolveWalletTier(customer));
      return updateGoogleWalletObject(customer, tier);
    })(),
  ]);
  for (const [index, result] of providers.entries()) {
    if (result.status !== 'rejected') continue;
    const provider = index === 0 ? 'Apple Wallet' : 'Google Wallet';
    console.error(`${provider} sync failed:`, result.reason?.message || String(result.reason));
  }
  return {
    customer,
    tier,
    providers,
    retryable: providers.some(
      (result) => result.status === 'rejected' || result.value?.retryable === true,
    ),
  };
}

function queueCustomerLoyaltySync(customerId) {
  const id = String(customerId || '').trim();
  if (!id) return;
  const existing = queued.get(id);
  if (existing) {
    existing.rerun = true;
    return;
  }

  const state = { rerun: true, attempts: 0 };
  queued.set(id, state);
  const run = async () => {
    let retry = false;
    try {
      while (state.rerun) {
        state.rerun = false;
        const result = await syncCustomerLoyalty(id);
        retry = result.retryable;
      }
    } catch (error) {
      console.error('Loyalty realtime sync failed:', error.message);
      retry = true;
    } finally {
      const delays = [3000, 15000, 60000];
      if (retry && state.attempts < delays.length) {
        state.rerun = true;
        const timer = setTimeout(run, delays[state.attempts++]);
        timer.unref?.();
      } else queued.delete(id);
    }
  };
  setImmediate(run);
}

module.exports = { queueCustomerLoyaltySync, syncCustomerLoyalty };

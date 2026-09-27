const { supabase } = require('../config/supabase');
const { getSettings } = require('./settings.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');

async function referralTerms() {
  const settings = (await getSettings()).bonus_referral || {};
  return {
    enabled: settings.enabled === true,
    reward_referrer: Number(settings.inviter_bonus ?? 1000),
    reward_friend: Number(settings.friend_bonus ?? 500),
    min_first_order: Number(settings.min_first_order ?? 0),
  };
}

async function processReferralPurchases() {
  const { data, error } = await supabase
    .from('referral_first_purchases')
    .select('customer_id')
    .eq('state', 'pending')
    .order('purchased_at')
    .limit(100);
  if (error) throw error;
  let failure;
  for (const row of data || []) {
    try {
      const { data: reward, error: rewardError } = await supabase.rpc('process_referral_purchase', {
        p_customer_id: row.customer_id,
      });
      if (rewardError) throw rewardError;
      for (const id of [reward?.friendCustomerId, reward?.ownerCustomerId].filter(Boolean)) {
        queueCustomerLoyaltySync(id);
      }
    } catch (error) {
      failure = error;
    }
  }
  if (failure) throw failure;
}

module.exports = { referralTerms, processReferralPurchases };

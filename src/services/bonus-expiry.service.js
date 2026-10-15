const { supabase } = require('../config/supabase');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');

// The database owns lot balances, reservations and calendar expiry dates.
// Never infer expiry from the last purchase or a capped transaction history.
async function getBonusExpirySummary(customerId, { days = 30, db = supabase } = {}) {
  const { data, error } = await db.rpc('bonus_expiry_summary', {
    p_customer_id: customerId,
    p_days: Math.min(365, Math.max(1, Number(days) || 30)),
  });
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Клиент не найден'), { statusCode: 404 });
  if (Number(data.expiredAmount || 0) > 0 || Number(data.winbackAmount || 0) > 0)
    queueCustomerLoyaltySync(customerId);
  return data;
}

module.exports = { getBonusExpirySummary };

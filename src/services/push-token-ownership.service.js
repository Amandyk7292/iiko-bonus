const { supabase } = require('../config/supabase');

async function currentCustomerPushTokens(customerId, tokens, { db = supabase } = {}) {
  if (!tokens.length) return [];
  const [owners, customer] = await Promise.all([
    db.from('customer_push_tokens').select('token,customer_id').in('token', tokens),
    db.from('customers').select('id,deleted_at').eq('id', customerId).maybeSingle(),
  ]);
  if (owners.error) throw owners.error;
  if (customer.error) throw customer.error;
  if (!customer.data || customer.data.deleted_at) return [];
  const byToken = new Map((owners.data || []).map((row) => [row.token, String(row.customer_id)]));
  // The migration enrolls legitimate legacy tokens too. An unclaimed legacy
  // value can be left behind by a historical account transfer and logout;
  // only a current registration proves the recipient still owns this device.
  return tokens.filter((token) => byToken.get(token) === String(customerId));
}

module.exports = { currentCustomerPushTokens };

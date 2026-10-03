const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { getJwtSecret } = require('./auth.service');
const { normalizeCustomerPhone } = require('./customer-password-auth.service');

function phoneKey(phone) {
  const secret = getJwtSecret();
  if (secret.length < 32) throw new Error('Phone attribution is unavailable');
  return crypto
    .createHmac('sha256', secret)
    .update('branch-signup:v1:' + normalizeCustomerPhone(phone))
    .digest('hex');
}
async function claimBranch(phone, branch, { db = supabase } = {}) {
  const { data, error } = await db.rpc('claim_branch_signup', {
    p_phone: normalizeCustomerPhone(phone),
    p_phone_key: phoneKey(phone),
    p_branch: branch,
  });
  if (error) throw error;
  return data;
}
async function finishRegistration(
  customer,
  profile,
  { db = supabase, cashierInviteToken, cashierSnapshot } = {},
) {
  if (cashierInviteToken) {
    return require('./cashier-signup.service')
      .createCashierSignup({ db })
      .finish(customer, profile, cashierInviteToken, phoneKey(customer.phone), cashierSnapshot);
  }
  const { data, error } = await db.rpc('finish_customer_registration', {
    p_customer_id: customer.id,
    p_phone_key: phoneKey(customer.phone),
    p_profile: profile,
  });
  if (error) throw error;
  return data;
}
module.exports = { phoneKey, claimBranch, finishRegistration };

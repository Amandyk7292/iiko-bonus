const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { signCustomerToken } = require('./auth.service');
const { getCustomerById } = require('./customer.service');

const sessionError = (message, statusCode = 401) =>
  Object.assign(new Error(message), { statusCode });
const hash = (value) =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const refreshDays = () => {
  const configured = Number.parseInt(process.env.CUSTOMER_REFRESH_TOKEN_DAYS || '30', 10);
  return Number.isInteger(configured) && configured >= 1 && configured <= 365 ? configured : 30;
};

const userAgentHash = (req) => {
  const value = String(req?.headers?.['user-agent'] || '').slice(0, 500);
  return value ? hash(value) : null;
};

async function createRefreshToken(customerId, req) {
  const token = crypto.randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + refreshDays() * 86400000).toISOString();
  const { data, error } = await supabase
    .from('customer_refresh_tokens')
    .insert({
      customer_id: customerId,
      token_hash: hash(token),
      expires_at: expiresAt,
      user_agent_hash: userAgentHash(req),
    })
    .select('id')
    .single();
  if (error) throw error;
  return { id: data.id, token, expiresAt };
}

async function issueCustomerSession(customer, req) {
  const { data: credential, error: credentialError } = await supabase
    .from('customer_credentials')
    .select('auth_version')
    .eq('customer_id', customer.id)
    .maybeSingle();
  if (credentialError) throw credentialError;
  const refresh = await createRefreshToken(customer.id, req);
  return {
    accessToken: signCustomerToken(customer, {
      authVersion: credential ? Number(credential.auth_version) : undefined,
    }),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

async function rotateCustomerSession(rawToken, req) {
  const token = String(rawToken || '').trim();
  if (token.length < 40 || token.length > 256) throw sessionError('Refresh session is invalid');
  const { data: current, error: readError } = await supabase
    .from('customer_refresh_tokens')
    .select('*')
    .eq('token_hash', hash(token))
    .maybeSingle();
  if (readError) throw readError;
  if (!current || current.revoked_at || new Date(current.expires_at) <= new Date()) {
    throw sessionError('Refresh session is invalid or expired');
  }
  const now = new Date().toISOString();
  const { data: claimed, error: claimError } = await supabase
    .from('customer_refresh_tokens')
    .update({ revoked_at: now, last_used_at: now })
    .eq('id', current.id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) throw sessionError('Refresh session was already used');

  const customer = await getCustomerById(current.customer_id);
  if (!customer) throw sessionError('Customer no longer exists');
  const { data: credential, error: credentialError } = await supabase
    .from('customer_credentials')
    .select('auth_version')
    .eq('customer_id', customer.id)
    .maybeSingle();
  if (credentialError) throw credentialError;
  const refresh = await createRefreshToken(customer.id, req);
  const { error: replaceError } = await supabase
    .from('customer_refresh_tokens')
    .update({ replaced_by: refresh.id })
    .eq('id', current.id);
  if (replaceError) console.error('Не удалось связать refresh-токены:', replaceError.message);
  return {
    accessToken: signCustomerToken(customer, {
      authVersion: credential ? Number(credential.auth_version) : undefined,
    }),
    refreshToken: refresh.token,
    refreshExpiresAt: refresh.expiresAt,
  };
}

async function revokeCustomerSession(rawToken) {
  const token = String(rawToken || '').trim();
  if (!token) return;
  const { error } = await supabase
    .from('customer_refresh_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('token_hash', hash(token))
    .is('revoked_at', null);
  if (error) throw error;
}

module.exports = { issueCustomerSession, revokeCustomerSession, rotateCustomerSession };

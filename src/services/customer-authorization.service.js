const { supabase } = require('../config/supabase');
const { verifyToken } = require('./auth.service');

async function validateCustomerAuthorization(token, { db = supabase } = {}) {
  const payload = verifyToken(token, 'bulka-mobile');
  if (payload.role === 'family_child') {
    const error = new Error('Детскому аккаунту доступен только QR для кассы.');
    error.statusCode = 403;
    error.code = 'FAMILY_CHILD_RESTRICTED';
    throw error;
  }
  if (payload.role !== 'customer' || !payload.sub || !payload.phone) return null;
  try {
    const { data: customer, error } = await db
      .from('customers')
      .select('id,phone,deleted_at')
      .eq('id', String(payload.sub))
      .maybeSingle();
    if (error) throw error;
    if (!customer || customer.deleted_at) return null;
    const { data: credential, error: credentialError } = await db
      .from('customer_credentials')
      .select('auth_version')
      .eq('customer_id', String(payload.sub))
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (
      (credential && Number(credential.auth_version) !== Number(payload.av)) ||
      (!credential && payload.av !== undefined)
    )
      return null;
    return {
      id: String(customer.id),
      phone: String(customer.phone),
      expiresAt: payload.exp ? new Date(payload.exp * 1000).toISOString() : null,
    };
  } catch (cause) {
    const error = new Error('Customer authorization is temporarily unavailable', { cause });
    error.statusCode = 503;
    error.code = 'CUSTOMER_AUTH_UNAVAILABLE';
    throw error;
  }
}

module.exports = { validateCustomerAuthorization };

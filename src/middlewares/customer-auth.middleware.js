const { verifyToken, readBearerToken } = require('../services/auth.service');
const { supabase } = require('../config/supabase');

async function customerAuthMiddleware(req, res, next) {
  try {
    const payload = verifyToken(readBearerToken(req), 'bulka-mobile');
    if (payload.role !== 'customer' || !payload.sub || !payload.phone)
      throw new Error('Invalid customer token');
    const { data: customer, error } = await supabase
      .from('customers')
      .select('id,phone,deleted_at')
      .eq('id', String(payload.sub))
      .maybeSingle();
    if (error || !customer || customer.deleted_at) throw new Error('Customer is unavailable');
    const { data: credential, error: credentialError } = await supabase
      .from('customer_credentials')
      .select('auth_version')
      .eq('customer_id', String(payload.sub))
      .maybeSingle();
    if (
      credentialError ||
      (credential && Number(credential.auth_version) !== Number(payload.av)) ||
      (!credential && payload.av !== undefined)
    ) {
      throw new Error('Customer credential version is invalid');
    }
    req.customerAuth = { id: String(customer.id), phone: String(customer.phone) };
    next();
  } catch (_error) {
    res.status(401).json({ error: 'Customer session is invalid or expired' });
  }
}

function registrationAuthMiddleware(req, res, next) {
  try {
    const payload = verifyToken(readBearerToken(req), 'bulka-mobile');
    if (payload.role !== 'registration' || !payload.phone)
      throw new Error('Invalid registration token');
    req.registrationAuth = {
      phone: String(payload.phone),
      credentialGrantId: payload.credentialGrantId ? String(payload.credentialGrantId) : null,
    };
    next();
  } catch (_error) {
    res.status(401).json({ error: 'Registration session is invalid or expired' });
  }
}

module.exports = { customerAuthMiddleware, registrationAuthMiddleware };

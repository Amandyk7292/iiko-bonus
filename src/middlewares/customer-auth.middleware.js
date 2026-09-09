const { verifyToken, readBearerToken } = require('../services/auth.service');
const { supabase } = require('../config/supabase');

async function customerAuthMiddleware(req, res, next) {
  let payload;
  try {
    payload = verifyToken(readBearerToken(req), 'bulka-mobile');
    if (payload.role !== 'customer' || !payload.sub || !payload.phone)
      throw new Error('Invalid customer token');
  } catch (error) {
    if (error.statusCode === 503) {
      return res.status(503).json({
        error: 'Customer authorization is temporarily unavailable',
        code: 'CUSTOMER_AUTH_UNAVAILABLE',
      });
    }
    return res.status(401).json({
      error: 'Customer session is invalid or expired',
      code: 'CUSTOMER_SESSION_INVALID',
    });
  }
  try {
    const { data: customer, error } = await supabase
      .from('customers')
      .select('id,phone,deleted_at')
      .eq('id', String(payload.sub))
      .maybeSingle();
    if (error) throw error;
    if (!customer || customer.deleted_at) {
      return res.status(401).json({
        error: 'Customer session is invalid or expired',
        code: 'CUSTOMER_SESSION_INVALID',
      });
    }
    const { data: credential, error: credentialError } = await supabase
      .from('customer_credentials')
      .select('auth_version')
      .eq('customer_id', String(payload.sub))
      .maybeSingle();
    if (credentialError) throw credentialError;
    if (
      (credential && Number(credential.auth_version) !== Number(payload.av)) ||
      (!credential && payload.av !== undefined)
    ) {
      return res.status(401).json({
        error: 'Customer session is invalid or expired',
        code: 'CUSTOMER_SESSION_INVALID',
      });
    }
    req.customerAuth = { id: String(customer.id), phone: String(customer.phone) };
    next();
  } catch (_error) {
    // A database outage is not evidence that the customer's credentials were revoked.
    res.status(503).json({
      error: 'Customer authorization is temporarily unavailable',
      code: 'CUSTOMER_AUTH_UNAVAILABLE',
    });
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

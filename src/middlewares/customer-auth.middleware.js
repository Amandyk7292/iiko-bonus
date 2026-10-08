const { verifyToken, readBearerToken } = require('../services/auth.service');
const { validateCustomerAuthorization } = require('../services/customer-authorization.service');

async function customerAuthMiddleware(req, res, next) {
  try {
    const customer = await validateCustomerAuthorization(readBearerToken(req));
    if (!customer) {
      return res.status(401).json({
        error: 'Customer session is invalid or expired',
        code: 'CUSTOMER_SESSION_INVALID',
      });
    }
    req.customerAuth = { id: customer.id, phone: customer.phone };
    next();
  } catch (error) {
    if (error.statusCode === 403 || error.statusCode === 503) {
      return res
        .status(error.statusCode)
        .json({ error: error.message, code: error.code || 'CUSTOMER_AUTH_UNAVAILABLE' });
    }
    return res.status(401).json({
      error: 'Customer session is invalid or expired',
      code: 'CUSTOMER_SESSION_INVALID',
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

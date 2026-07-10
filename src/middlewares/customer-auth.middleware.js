const { verifyToken, readBearerToken } = require('../services/auth.service');

function customerAuthMiddleware(req, res, next) {
  try {
    const payload = verifyToken(readBearerToken(req), 'bulka-mobile');
    if (payload.role !== 'customer' || !payload.sub || !payload.phone)
      throw new Error('Invalid customer token');
    req.customerAuth = { id: String(payload.sub), phone: String(payload.phone) };
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
    req.registrationAuth = { phone: String(payload.phone) };
    next();
  } catch (_error) {
    res.status(401).json({ error: 'Registration session is invalid or expired' });
  }
}

module.exports = { customerAuthMiddleware, registrationAuthMiddleware };

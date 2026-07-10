const {
  signAdminToken,
  verifyToken,
  safeEqual,
  readBearerToken,
} = require('../services/auth.service');

const adminLoginHandler = (req, res) => {
  const configuredPassword = process.env.ADMIN_PASSWORD || '';
  if (configuredPassword.length < 12) {
    return res.status(503).json({ error: 'Admin authentication is not configured' });
  }
  if (!safeEqual(req.body?.password, configuredPassword)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  return res.json({ token: signAdminToken() });
};

const adminAuthMiddleware = (req, res, next) => {
  try {
    const payload = verifyToken(readBearerToken(req), 'bulka-admin');
    if (payload.role !== 'admin') throw new Error('Invalid role');
    req.admin = payload;
    next();
  } catch (_error) {
    return res.status(401).json({ error: 'Admin session is invalid or expired' });
  }
};

module.exports = { adminAuthMiddleware, adminLoginHandler };

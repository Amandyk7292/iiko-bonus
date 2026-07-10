const { safeEqual, readBearerToken } = require('../services/auth.service');

const webhookMiddleware = (req, res, next) => {
  const apiSecret = process.env.API_SECRET || process.env.API_TOKEN || '';
  if (apiSecret.length < 32) {
    return res.status(503).json({ error: 'Loyalty API authentication is not configured' });
  }
  if (!safeEqual(readBearerToken(req), apiSecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
};

module.exports = { webhookMiddleware };

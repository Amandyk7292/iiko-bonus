const rateLimit = require('express-rate-limit');

const adminRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const webhookRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 300,
  message: { error: 'Too many requests to webhook' },
  standardHeaders: true,
  legacyHeaders: false,
});

const walletRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Too many requests to wallet API' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { adminRateLimit, webhookRateLimit, walletRateLimit };

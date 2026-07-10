const rateLimit = require('express-rate-limit');

const adminRateLimit = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const adminLoginRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many login attempts' },
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

const authRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  message: { error: 'Too many authentication attempts' },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicApiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

const globalApiRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  message: { error: 'Too many API requests' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = {
  adminRateLimit,
  adminLoginRateLimit,
  webhookRateLimit,
  walletRateLimit,
  authRateLimit,
  publicApiRateLimit,
  globalApiRateLimit,
};

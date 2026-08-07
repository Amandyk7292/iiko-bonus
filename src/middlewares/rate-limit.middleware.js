const rateLimit = require('express-rate-limit');
const { readCustomerRefreshCookie } = require('../utils/customer-session-cookie.util');

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

const hasCustomerSessionCredential = (req) =>
  String(req?.body?.refreshToken || '').trim().length > 0 ||
  readCustomerRefreshCookie(req).length > 0;

const createCustomerSessionRateLimit = ({ windowMs = 10 * 60 * 1000, max = 120 } = {}) =>
  rateLimit({
    windowMs,
    max,
    message: {
      error: 'Too many customer session attempts',
      code: 'CUSTOMER_SESSION_RATE_LIMITED',
    },
    standardHeaders: true,
    legacyHeaders: false,
    // A web cold start legitimately probes for an HttpOnly refresh cookie.
    // Reject an absent credential in the route without spending this quota;
    // the global API limiter still bounds anonymous traffic before it arrives.
    skip: (req) => !hasCustomerSessionCredential(req),
  });

const customerSessionRateLimit = createCustomerSessionRateLimit();

const courierProofRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 6,
  message: { error: 'Слишком много попыток подтверждения. Повторите позже.' },
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

// Basic application-layer flood protection for pages and static assets. This
// complements, but does not replace, network-level DDoS protection.
const siteRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 900,
  message: { error: 'Too many requests' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['/healthz', '/livez', '/readyz'].includes(req.path),
});

module.exports = {
  adminRateLimit,
  adminLoginRateLimit,
  webhookRateLimit,
  walletRateLimit,
  authRateLimit,
  customerSessionRateLimit,
  createCustomerSessionRateLimit,
  hasCustomerSessionCredential,
  courierProofRateLimit,
  publicApiRateLimit,
  globalApiRateLimit,
  siteRateLimit,
};

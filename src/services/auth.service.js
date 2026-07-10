const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getJwtSecret() {
  return (
    process.env.CUSTOMER_JWT_SECRET || process.env.JWT_SECRET || process.env.BULKA_SECRET || ''
  );
}

function requireJwtSecret() {
  const secret = getJwtSecret();
  if (secret.length < 32) {
    const error = new Error('CUSTOMER_JWT_SECRET must contain at least 32 characters');
    error.statusCode = 503;
    throw error;
  }
  return secret;
}

function signCustomerToken(customer) {
  return jwt.sign(
    { sub: String(customer.id), phone: String(customer.phone), role: 'customer' },
    requireJwtSecret(),
    { algorithm: 'HS256', expiresIn: '30d', issuer: 'bulka-bonus', audience: 'bulka-mobile' },
  );
}

function signRegistrationToken(phone) {
  return jwt.sign({ phone: String(phone), role: 'registration' }, requireJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '10m',
    issuer: 'bulka-bonus',
    audience: 'bulka-mobile',
  });
}

function signAdminToken() {
  return jwt.sign({ role: 'admin' }, requireJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '8h',
    issuer: 'bulka-bonus',
    audience: 'bulka-admin',
  });
}

function signWalletToken(phone) {
  return jwt.sign({ phone: String(phone), role: 'wallet' }, requireJwtSecret(), {
    algorithm: 'HS256',
    expiresIn: '5m',
    issuer: 'bulka-bonus',
    audience: 'bulka-wallet',
  });
}

function verifyToken(token, audience) {
  return jwt.verify(token, requireJwtSecret(), {
    algorithms: ['HS256'],
    issuer: 'bulka-bonus',
    audience,
  });
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left || ''));
  const rightBuffer = Buffer.from(String(right || ''));
  return (
    leftBuffer.length === rightBuffer.length && crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function readBearerToken(req) {
  const header = String(req.headers.authorization || '');
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

module.exports = {
  getJwtSecret,
  signCustomerToken,
  signRegistrationToken,
  signAdminToken,
  signWalletToken,
  verifyToken,
  safeEqual,
  readBearerToken,
};

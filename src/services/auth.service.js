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

function requireAdminJwtSecret() {
  const configured = String(process.env.ADMIN_JWT_SECRET || '');
  if (configured) {
    if (configured.length < 32) {
      const error = new Error('ADMIN_JWT_SECRET must contain at least 32 characters');
      error.statusCode = 503;
      throw error;
    }
    return configured;
  }
  return crypto.createHmac('sha256', requireJwtSecret()).update('bulka-admin-jwt-v1').digest('hex');
}

function signCustomerToken(customer, { authVersion } = {}) {
  const expiresIn = String(process.env.CUSTOMER_ACCESS_TOKEN_TTL || '15m');
  return jwt.sign(
    {
      sub: String(customer.id),
      phone: String(customer.phone),
      role: 'customer',
      ...(Number.isInteger(authVersion) && authVersion > 0 ? { av: authVersion } : {}),
    },
    requireJwtSecret(),
    { algorithm: 'HS256', expiresIn, issuer: 'bulka-bonus', audience: 'bulka-mobile' },
  );
}

function signRegistrationToken(phone, { credentialGrantId } = {}) {
  return jwt.sign(
    {
      phone: String(phone),
      role: 'registration',
      ...(credentialGrantId ? { credentialGrantId: String(credentialGrantId) } : {}),
    },
    requireJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn: '10m',
      issuer: 'bulka-bonus',
      audience: 'bulka-mobile',
    },
  );
}

function signAdminToken(admin = {}, { expiresIn = '2h', jti = crypto.randomUUID() } = {}) {
  return jwt.sign(
    {
      sub: String(admin.username || admin.sub || 'admin'),
      role: String(admin.role || 'admin'),
      branchIds: Array.isArray(admin.branchIds) ? admin.branchIds.map(String).slice(0, 50) : [],
      jti,
    },
    requireAdminJwtSecret(),
    {
      algorithm: 'HS256',
      expiresIn,
      issuer: 'bulka-bonus',
      audience: 'bulka-admin',
    },
  );
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
  const secret = audience === 'bulka-admin' ? requireAdminJwtSecret() : requireJwtSecret();
  return jwt.verify(token, secret, {
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

function readCookieToken(req, cookieName = 'bulka_admin') {
  const cookie = String(req.headers.cookie || '');
  for (const part of cookie.split(';')) {
    const [name, ...value] = part.trim().split('=');
    if (name === cookieName) return decodeURIComponent(value.join('='));
  }
  return '';
}

module.exports = {
  getAdminJwtSecret: requireAdminJwtSecret,
  getJwtSecret,
  signCustomerToken,
  signRegistrationToken,
  signAdminToken,
  signWalletToken,
  verifyToken,
  safeEqual,
  readBearerToken,
  readCookieToken,
};

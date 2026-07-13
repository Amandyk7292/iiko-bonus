const {
  signAdminToken,
  verifyToken,
  safeEqual,
  readBearerToken,
  readCookieToken,
} = require('../services/auth.service');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { writeAdminAudit } = require('../services/admin-audit.service');

const parseAdminUsers = () => {
  if (process.env.ADMIN_USERS_JSON) {
    try {
      const users = JSON.parse(process.env.ADMIN_USERS_JSON);
      if (!Array.isArray(users)) throw new Error('must be an array');
      return users;
    } catch (error) {
      console.error('ADMIN_USERS_JSON is invalid:', error.message);
      return [];
    }
  }
  return [
    {
      username: 'admin',
      role: 'admin',
      passwordHash: process.env.ADMIN_PASSWORD_HASH || '',
      password: process.env.ADMIN_PASSWORD || '',
      totpSecret: process.env.ADMIN_TOTP_SECRET || '',
    },
  ];
};

const decodeBase32 = (value) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  for (const char of String(value).replace(/=+$/g, '').replace(/\s/g, '').toUpperCase()) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid base32');
    bits += index.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(Number.parseInt(bits.slice(index, index + 8), 2));
  }
  return Buffer.from(bytes);
};

const totpAt = (secret, counter) => {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value =
    (((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff)) %
    1000000;
  return String(value).padStart(6, '0');
};

const verifyTotp = (code, secret) => {
  const counter = Math.floor(Date.now() / 30000);
  return [-1, 0, 1].some((offset) => safeEqual(code, totpAt(secret, counter + offset)));
};

const adminLoginHandler = async (req, res) => {
  const username = String(req.body?.username || 'admin')
    .trim()
    .toLowerCase();
  const user = parseAdminUsers().find(
    (candidate) =>
      String(candidate?.username || '')
        .trim()
        .toLowerCase() === username,
  );
  if (!user) return res.status(401).json({ error: 'Invalid credentials' });

  const password = String(req.body?.password || '');
  let passwordValid;
  try {
    passwordValid = user.passwordHash
      ? await bcrypt.compare(password, String(user.passwordHash))
      : safeEqual(password, user.password);
  } catch {
    return res.status(503).json({ error: 'Admin password hash is invalid' });
  }
  if (!passwordValid) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const totpSecret = String(user.totpSecret || process.env.ADMIN_TOTP_SECRET || '');
  const mfaRequired = Boolean(totpSecret) || process.env.ADMIN_REQUIRE_MFA === 'true';
  if (mfaRequired && !totpSecret) {
    return res.status(503).json({ error: 'Admin MFA is required but not configured' });
  }
  if (mfaRequired) {
    try {
      if (!verifyTotp(req.body?.code, totpSecret)) {
        return res.status(401).json({ error: 'Invalid credentials or verification code' });
      }
    } catch {
      return res.status(503).json({ error: 'Admin TOTP secret is invalid' });
    }
  }

  const role = String(user.role || 'viewer');
  if (!['admin', 'editor', 'viewer'].includes(role)) {
    return res.status(503).json({ error: 'Admin role is invalid' });
  }
  const admin = { username: String(user.username), role };
  const token = signAdminToken(admin);
  const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
  res.cookie('bulka_admin', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    path: '/admin',
    maxAge: 2 * 60 * 60 * 1000,
  });
  return res.json({ user: admin });
};

const adminAuthMiddleware = (req, res, next) => {
  try {
    const payload = verifyToken(readCookieToken(req) || readBearerToken(req), 'bulka-admin');
    if (!['admin', 'editor', 'viewer'].includes(payload.role)) throw new Error('Invalid role');
    req.admin = payload;
    next();
  } catch (_error) {
    return res.status(401).json({ error: 'Admin session is invalid or expired' });
  }
};

const adminCsrfMiddleware = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || readBearerToken(req)) return next();
  const origin = String(req.headers.origin || '');
  if (!origin) return res.status(403).json({ error: 'Origin header is required' });
  try {
    if (new URL(origin).host !== req.get('host')) throw new Error('Origin mismatch');
  } catch {
    return res.status(403).json({ error: 'Invalid request origin' });
  }
  return next();
};

const adminMutationRoleMiddleware = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.admin.role !== 'viewer') return next();
  return res.status(403).json({ error: 'Viewer role is read-only' });
};

const adminAuditMiddleware = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => void writeAdminAudit(req, res.statusCode));
  }
  next();
};

const adminLogoutHandler = (_req, res) => {
  res.clearCookie('bulka_admin', { httpOnly: true, sameSite: 'strict', path: '/admin' });
  res.json({ success: true });
};

const adminSessionHandler = (req, res) =>
  res.json({ user: { username: req.admin.sub, role: req.admin.role } });

module.exports = {
  adminAuditMiddleware,
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminLoginHandler,
  adminLogoutHandler,
  adminMutationRoleMiddleware,
  adminSessionHandler,
};

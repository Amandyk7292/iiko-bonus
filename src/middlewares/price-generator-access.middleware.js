const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const { getAdminJwtSecret, readCookieToken, readBearerToken } = require('../services/auth.service');
const { adminAuthMiddleware } = require('./auth.middleware');

const COOKIE = 'bulka_price_editor';
const cookieOptions = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER),
  sameSite: 'strict',
  path: '/admin/api/pricegenerator',
});
const codeHash = () => String(process.env.PRICE_GENERATOR_EDIT_CODE_HASH || '');
const signingKey = () =>
  crypto
    .createHmac('sha256', getAdminJwtSecret())
    .update(`price-generator-editor-v1:${codeHash()}`)
    .digest('hex');
const hasCodeSession = (req) => {
  try {
    if (!codeHash()) return false;
    const token = readCookieToken(req, COOKIE);
    const payload = jwt.verify(token, signingKey(), {
      algorithms: ['HS256'],
      issuer: 'bulka-bonus',
      audience: 'bulka-pricegenerator-edit',
    });
    return payload.scope === 'pricegenerator:edit';
  } catch {
    return false;
  }
};

function ownerOrAdminOnly(req, res, next) {
  if (!['owner', 'admin'].includes(String(req.admin?.role || ''))) {
    return res
      .status(403)
      .json({ error: 'Для редактирования войдите по коду или как администратор.' });
  }
  req.priceGeneratorAccess = 'admin';
  return next();
}
function priceGeneratorEditor(req, res, next) {
  if (hasCodeSession(req)) {
    req.priceGeneratorAccess = 'code';
    return next();
  }
  return adminAuthMiddleware(req, res, () => ownerOrAdminOnly(req, res, next)).catch(next);
}
function accessStatus(req, res, next) {
  res.set('Cache-Control', 'no-store');
  if (hasCodeSession(req)) return res.json({ canEdit: true, via: 'code' });
  try {
    if (!readCookieToken(req) && !readBearerToken(req))
      return res.json({ canEdit: false, via: null });
  } catch {
    return res.json({ canEdit: false, via: null });
  }
  return adminAuthMiddleware(req, res, () => {
    const allowed = ['owner', 'admin'].includes(req.admin?.role);
    return res.json({ canEdit: allowed, via: allowed ? 'admin' : null });
  }).catch(next);
}
function sameOrigin(req, res, next) {
  try {
    if (new URL(String(req.headers.origin || '')).host !== req.get('host')) throw new Error();
  } catch {
    return res.status(403).json({ error: 'Недопустимый источник запроса.' });
  }
  return next();
}
const codeLoginLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Повторите через 15 минут.' },
});
async function unlockEditor(req, res, next) {
  res.set('Cache-Control', 'no-store');
  try {
    if (!codeHash()) return res.status(503).json({ error: 'Вход по коду пока не настроен.' });
    if (!(await bcrypt.compare(req.body.code, codeHash())))
      return res.status(401).json({ error: 'Неверный код.' });
    const token = jwt.sign(
      { scope: 'pricegenerator:edit', jti: crypto.randomUUID() },
      signingKey(),
      {
        algorithm: 'HS256',
        issuer: 'bulka-bonus',
        audience: 'bulka-pricegenerator-edit',
        expiresIn: '12h',
      },
    );
    res.cookie(COOKIE, token, { ...cookieOptions(), maxAge: 12 * 60 * 60 * 1000 });
    return res.json({ canEdit: true, via: 'code' });
  } catch (error) {
    return next(error);
  }
}
function lockEditor(_req, res) {
  res.set('Cache-Control', 'no-store');
  res.clearCookie(COOKIE, cookieOptions());
  return res.json({ success: true });
}
module.exports = {
  priceGeneratorEditor,
  accessStatus,
  sameOrigin,
  codeLoginLimit,
  unlockEditor,
  lockEditor,
};

const crypto = require('node:crypto');
const { getJwtSecret, safeEqual } = require('../services/auth.service');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () =>
  Object.assign(new Error('Обновите семейный QR в приложении.'), {
    statusCode: 401,
    code: 'FAMILY_QR_INVALID',
  });
function mac(value, secret) {
  if (!secret || secret.length < 32)
    throw Object.assign(new Error('Семейный QR временно недоступен.'), {
      statusCode: 503,
      code: 'FAMILY_UNAVAILABLE',
    });
  return crypto
    .createHmac('sha256', secret)
    .update(`bulka-family-qr-v1:${value}`)
    .digest('hex')
    .slice(0, 32);
}
function buildFamilyQr(
  member,
  purpose = 'loyalty',
  { now = Date.now(), secret = getJwtSecret() } = {},
) {
  if (
    !UUID.test(member.id) ||
    !Number.isSafeInteger(Number(member.auth_version)) ||
    !['loyalty', 'payment'].includes(purpose)
  )
    throw fail();
  const expiry = (Math.floor(now / 300000) + 1) * 300;
  const value = `${member.id.toLowerCase()}:${member.auth_version}:${purpose === 'payment' ? 'p' : 'l'}:${expiry}`;
  return {
    token: `BULKA-FAMILY:${value}:${mac(value, secret)}`,
    expiresAt: expiry * 1000,
    ttlSeconds: Math.max(1, Math.ceil((expiry * 1000 - now) / 1000)),
  };
}
function readFamilyQr(token, { now = Date.now(), secret = getJwtSecret() } = {}) {
  const parts = String(token || '').split(':');
  const [prefix, memberId, version, purpose, expiry, signature] = parts;
  if (
    parts.length !== 6 ||
    prefix !== 'BULKA-FAMILY' ||
    !UUID.test(memberId) ||
    !/^[1-9]\d{0,8}$/.test(version) ||
    !['l', 'p'].includes(purpose) ||
    !/^\d{10}$/.test(expiry) ||
    !/^[a-f0-9]{32}$/.test(signature)
  )
    throw fail();
  const expiresAt = Number(expiry) * 1000;
  if (
    expiresAt <= now ||
    expiresAt - now > 300000 ||
    !safeEqual(signature, mac(parts.slice(1, 5).join(':'), secret))
  )
    throw fail();
  return {
    memberId,
    authVersion: Number(version),
    purpose: purpose === 'p' ? 'payment' : 'loyalty',
    expiresAt,
  };
}
module.exports = { buildFamilyQr, readFamilyQr };

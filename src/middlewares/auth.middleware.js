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
const {
  createAdminSession,
  revokeAdminSession,
  validateAdminSession,
} = require('../services/admin-session.service');
const { supabase } = require('../config/supabase');
const {
  requestAdminPhoneLogin,
  verifyAdminPhoneLogin,
} = require('../services/admin-phone-auth.service');
const { applyAdminBranchSelection } = require('../utils/admin-scope.util');
const { authenticateCashier } = require('../services/admin-credential-auth.service');

const ADMIN_ROLES = new Set([
  'admin',
  'owner',
  'branch_manager',
  'operator',
  'marketer',
  'courier',
  'editor',
  'viewer',
  'cashier',
  'whatsapp_operator',
]);

const DEFAULT_ADMIN_SESSION_OPTIONS = Object.freeze({
  expiresIn: '2h',
  maxAgeMs: 2 * 60 * 60 * 1000,
});
const CASHIER_SESSION_OPTIONS = Object.freeze({
  expiresIn: '12h',
  maxAgeMs: 12 * 60 * 60 * 1000,
});
const sessionOptionsForAdmin = (admin) =>
  admin?.role === 'cashier' ? CASHIER_SESSION_OPTIONS : DEFAULT_ADMIN_SESSION_OPTIONS;

const ROLE_AREAS = {
  owner: new Set(['*']),
  admin: new Set(['*']),
  branch_manager: new Set([
    'session',
    'scope',
    'events',
    'operations',
    'global-search',
    'integrations',
    'analytics',
    'customers',
    'orders',
    'menu',
    'inventory',
    'couriers',
    'dispatch',
    'kitchen',
    'locations',
    'reviews',
    'support',
    'transactions',
    'whatsapp',
  ]),
  operator: new Set([
    'session',
    'scope',
    'events',
    'operations',
    'global-search',
    'customers',
    'orders',
    'dispatch',
    'kitchen',
    'reviews',
    'support',
    'whatsapp',
  ]),
  marketer: new Set([
    'session',
    'scope',
    'events',
    'operations',
    'global-search',
    'analytics',
    'customers',
    'broadcast',
    'stories',
    'news',
    'bonus',
    'loyalty-tiers',
    'promotions',
    'gift-cards',
    'reviews',
    'support',
    'automations',
    'contact-cards',
    'contact-actions',
    'taplink',
  ]),
  courier: new Set(['session', 'scope', 'events', 'couriers', 'dispatch']),
  editor: new Set([
    'session',
    'scope',
    'events',
    'operations',
    'global-search',
    'integrations',
    'analytics',
    'customers',
    'orders',
    'menu',
    'inventory',
    'couriers',
    'dispatch',
    'kitchen',
    'locations',
    'reviews',
    'support',
    'transactions',
    'broadcast',
    'stories',
    'news',
    'bonus',
    'loyalty-tiers',
    'promotions',
    'gift-cards',
    'automations',
    'contact-cards',
    'contact-actions',
    'whatsapp',
    'taplink',
  ]),
  viewer: new Set([
    'session',
    'scope',
    'events',
    'operations',
    'global-search',
    'integrations',
    'analytics',
    'customers',
    'orders',
    'menu',
    'inventory',
    'couriers',
    'dispatch',
    'kitchen',
    'locations',
    'reviews',
    'support',
    'transactions',
    'whatsapp',
  ]),
  cashier: new Set(['session', 'scope', 'events', 'orders', 'kitchen']),
  whatsapp_operator: new Set(['session', 'events', 'whatsapp']),
};

const CUSTOMER_ACTIONS = Object.freeze({
  READ: 'customers:read',
  UPDATE: 'customers:update',
  ADJUST_BONUS: 'customers:adjust-bonus',
  DELETE: 'customers:delete',
  BULK_NOTIFY: 'customers:bulk-notify',
  BULK_EXPIRE: 'customers:bulk-expire',
});

const PAYMENT_ACTIONS = Object.freeze({
  MANAGE: 'payments:manage',
});

const TAPLINK_ACTIONS = Object.freeze({
  PUBLISH: 'taplink:publish',
});

const GIFT_CARD_ACTIONS = Object.freeze({
  ISSUE: 'gift-cards:issue',
});

/**
 * Area access controls navigation. Action access controls the sensitive
 * operation itself, so adding a role to the customers area never grants
 * customer mutations implicitly.
 */
const ROLE_ACTIONS = Object.freeze({
  owner: new Set(['*']),
  admin: new Set(['*']),
  branch_manager: new Set([CUSTOMER_ACTIONS.READ, CUSTOMER_ACTIONS.ADJUST_BONUS]),
  operator: new Set([CUSTOMER_ACTIONS.READ]),
  marketer: new Set([CUSTOMER_ACTIONS.READ]),
  editor: new Set([CUSTOMER_ACTIONS.READ]),
  viewer: new Set([CUSTOMER_ACTIONS.READ]),
});

const actionsForRole = (role) => ROLE_ACTIONS[String(role || '')] || new Set();

const hasAdminAction = (admin, action) => {
  const actions = actionsForRole(admin?.role || admin);
  return actions.has('*') || actions.has(action);
};

const requireAdminAction = (action) => (req, res, next) => {
  if (!hasAdminAction(req.admin, action)) {
    return res.status(403).json({
      error: 'Недостаточно прав для этого действия',
      code: 'ADMIN_ACTION_FORBIDDEN',
    });
  }
  return next();
};

const requireAdminMfa = (req, res, next) => {
  if (req.admin?.mfa !== true) {
    return res.status(403).json({
      error: 'Для выпуска денежного сертификата войдите с двухфакторной защитой',
      code: 'ADMIN_MFA_REQUIRED',
    });
  }
  return next();
};

const adminUserResponse = (admin) => ({
  username: String(admin?.username || admin?.sub || ''),
  role: String(admin?.role || 'viewer'),
  branchIds: Array.isArray(admin?.branchIds) ? admin.branchIds.map(String) : [],
  actions: [...actionsForRole(admin?.role)],
  mfaVerified: admin?.mfa === true || admin?.mfaVerified === true,
});

const adminArea = (req) => {
  const value = String(req.path || req.originalUrl || '').replace(/^\/+/, '');
  return value.split('/')[0] || 'session';
};

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

const issueAdminSession = async (
  req,
  res,
  admin,
  sessionOptions = sessionOptionsForAdmin(admin),
) => {
  try {
    const { expiresIn, maxAgeMs } = sessionOptions;
    const jti = crypto.randomUUID();
    const token = signAdminToken(admin, { expiresIn, jti });
    const payload = verifyToken(token, 'bulka-admin');
    const isProduction = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
    await createAdminSession({
      jti,
      subject: payload.sub,
      role: payload.role,
      branchIds: payload.branchIds,
      authVersion: Number(admin?.authVersion) || 0,
      expiresAt: payload.exp * 1000,
      ip: req?.ip,
      userAgent: req?.headers?.['user-agent'],
    });
    res.cookie('bulka_admin', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: 'strict',
      path: '/admin',
      maxAge: maxAgeMs,
    });
    return res.json({ user: adminUserResponse(admin) });
  } catch (error) {
    req?.log?.error({ err: error, event: 'admin_session_issue_failed' }, 'Session issue failed');
    return res.status(503).json({
      error: 'Не удалось создать защищённую сессию',
      code: 'ADMIN_SESSION_UNAVAILABLE',
    });
  }
};

const whatsappOperatorAccessHandler = async (req, res) => {
  const configuredHash = String(process.env.WHATSAPP_OPERATOR_ACCESS_TOKEN_HASH || '')
    .trim()
    .toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(configuredHash)) {
    return res.status(503).json({
      error: 'Ссылка оператора WhatsApp ещё не настроена',
      code: 'WHATSAPP_OPERATOR_ACCESS_UNAVAILABLE',
    });
  }

  const accessToken = String(req.body?.token || '').trim();
  if (!/^[a-zA-Z0-9_-]{43,128}$/.test(accessToken)) {
    return res.status(401).json({
      error: 'Ссылка недействительна или была заменена',
      code: 'WHATSAPP_OPERATOR_ACCESS_INVALID',
    });
  }
  const accessTokenHash = crypto.createHash('sha256').update(accessToken, 'utf8').digest('hex');
  if (!safeEqual(accessTokenHash, configuredHash)) {
    return res.status(401).json({
      error: 'Ссылка недействительна или была заменена',
      code: 'WHATSAPP_OPERATOR_ACCESS_INVALID',
    });
  }

  return issueAdminSession(
    req,
    res,
    { username: 'whatsapp-operator', role: 'whatsapp_operator', branchIds: [] },
    { expiresIn: '12h', maxAgeMs: 12 * 60 * 60 * 1000 },
  );
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

  const password = String(req.body?.password || '');
  if (!user) {
    try {
      const cashier = await authenticateCashier(username, password);
      if (!cashier) return res.status(401).json({ error: 'Invalid credentials' });
      return issueAdminSession(req, res, cashier);
    } catch (error) {
      req?.log?.error(
        { err: error, event: 'cashier_password_login_failed' },
        'Cashier login failed',
      );
      return res.status(503).json({
        error: 'Сервис входа сотрудников временно недоступен',
        code: 'ADMIN_STAFF_AUTH_UNAVAILABLE',
      });
    }
  }

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

  let role = String(user.role || 'viewer');
  let branchIds = Array.isArray(user.branchIds) ? user.branchIds.map(String) : [];
  try {
    const { data: profile, error: profileError } = await supabase
      .from('admin_user_profiles')
      .select('role,branch_ids,active')
      .eq('username', String(user.username))
      .maybeSingle();
    if (!profileError && profile) {
      if (profile.active === false)
        return res.status(403).json({ error: 'Admin account is disabled' });
      role = String(profile.role || role);
      branchIds = Array.isArray(profile.branch_ids) ? profile.branch_ids.map(String) : branchIds;
    }
  } catch (_error) {
    // The environment configuration remains the bootstrap source before the
    // role migration is applied.
  }
  if (!ADMIN_ROLES.has(role)) {
    return res.status(503).json({ error: 'Admin role is invalid' });
  }
  const admin = {
    username: String(user.username),
    role,
    branchIds,
    mfaVerified: mfaRequired,
  };
  return issueAdminSession(req, res, admin);
};

const adminPhoneLoginRequestHandler = async (req, res) => {
  try {
    const challenge = await requestAdminPhoneLogin(req.body?.phone);
    return res.json({ success: true, ...challenge });
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Не удалось запросить код',
      code: error.code,
    });
  }
};

const adminPhoneLoginVerifyHandler = async (req, res) => {
  try {
    const admin = await verifyAdminPhoneLogin(req.body?.phone, req.body?.code);
    return issueAdminSession(req, res, admin);
  } catch (error) {
    return res.status(error.statusCode || 500).json({
      success: false,
      error: error.message || 'Не удалось выполнить вход',
      code: error.code,
    });
  }
};

const adminAuthMiddleware = async (req, res, next) => {
  try {
    const payload = verifyToken(readCookieToken(req) || readBearerToken(req), 'bulka-admin');
    if (!ADMIN_ROLES.has(payload.role)) throw new Error('Invalid role');
    const activeSession = await validateAdminSession(payload);
    if (!activeSession || !ADMIN_ROLES.has(activeSession.role)) {
      throw new Error('Session is revoked');
    }
    const requestedBranch = req.headers['x-bulka-branch-id'] || req.query?.scopeBranchId || '';
    const requestedBranches = req.headers['x-bulka-branch-ids'] || req.query?.scopeBranchIds || '';
    req.admin = applyAdminBranchSelection(activeSession, requestedBranch, requestedBranches);
    return next();
  } catch (error) {
    if (error?.statusCode) return res.status(error.statusCode).json({ error: error.message });
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

const cashierMutationAllowed = (req, area) => {
  const path = String(req.path || '').replace(/^\/+/, '');
  if (area === 'kitchen' && req.method === 'PATCH' && /^kitchen\/[0-9a-f-]+\/status$/i.test(path)) {
    return new Set(['preparing', 'ready', 'handed_over']).has(String(req.body?.status || ''));
  }
  return false;
};

const adminMutationRoleMiddleware = (req, res, next) => {
  const readOnly = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
  if (req.admin.role === 'viewer' && !readOnly) {
    return res.status(403).json({ error: 'Viewer role is read-only' });
  }
  if (req.admin.role === 'courier' && !readOnly) {
    return res.status(403).json({
      error: 'Курьер изменяет только собственный статус через кабинет курьера',
      code: 'COURIER_SELF_SERVICE_REQUIRED',
    });
  }
  const areas = ROLE_AREAS[req.admin.role] || new Set();
  const area = adminArea(req);
  if (!areas.has('*') && !areas.has(area)) {
    return res.status(403).json({ error: 'Недостаточно прав для этого раздела' });
  }
  if (req.admin.role === 'cashier' && !readOnly && !cashierMutationAllowed(req, area)) {
    return res.status(403).json({
      error: 'Кассир может продвигать заказ только через экран кухни',
      code: 'CASHIER_ACTION_FORBIDDEN',
    });
  }
  if (!readOnly && !['admin', 'owner'].includes(req.admin.role) && req.admin.branchIds?.length) {
    const requestedBranch = String(
      req.body?.branchId || req.params?.branchId || req.query?.branchId || '',
    );
    if (requestedBranch && !req.admin.branchIds.map(String).includes(requestedBranch)) {
      return res.status(403).json({ error: 'Филиал не входит в область доступа' });
    }
  }
  return next();
};

const adminAuditMiddleware = (req, res, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    res.on('finish', () => void writeAdminAudit(req, res.statusCode));
  }
  next();
};

const adminLogoutHandler = async (req, res) => {
  try {
    await revokeAdminSession(req.admin?.jti);
    res.clearCookie('bulka_admin', { httpOnly: true, sameSite: 'strict', path: '/admin' });
    return res.json({ success: true });
  } catch {
    return res.status(503).json({
      error: 'Не удалось завершить сессию',
      code: 'ADMIN_SESSION_REVOKE_FAILED',
    });
  }
};

const adminSessionHandler = (req, res) =>
  res.json({
    user: adminUserResponse(req.admin),
  });

module.exports = {
  adminAuditMiddleware,
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminLoginHandler,
  adminLogoutHandler,
  adminMutationRoleMiddleware,
  adminPhoneLoginRequestHandler,
  adminPhoneLoginVerifyHandler,
  adminSessionHandler,
  whatsappOperatorAccessHandler,
  ADMIN_ROLES,
  CUSTOMER_ACTIONS,
  GIFT_CARD_ACTIONS,
  PAYMENT_ACTIONS,
  TAPLINK_ACTIONS,
  ROLE_ACTIONS,
  ROLE_AREAS,
  CASHIER_SESSION_OPTIONS,
  actionsForRole,
  hasAdminAction,
  requireAdminAction,
  requireAdminMfa,
  sessionOptionsForAdmin,
};

const assert = require('node:assert/strict');
const test = require('node:test');

const COOKIE_LIFETIME_MS = 400 * 24 * 60 * 60 * 1000;

test('admin and cashier sessions keep a durable cookie and server revocation', () => {
  const { sessionOptionsForAdmin } = require('../src/middlewares/auth.middleware');

  assert.deepEqual(sessionOptionsForAdmin({ role: 'cashier' }), {
    expiresIn: '12h',
    maxAgeMs: COOKIE_LIFETIME_MS,
    persistent: true,
  });
  assert.deepEqual(sessionOptionsForAdmin({ role: 'admin' }), {
    expiresIn: '2h',
    maxAgeMs: COOKIE_LIFETIME_MS,
    persistent: true,
  });
});

const installModule = (t, modulePath, exports) => {
  const previous = require.cache[modulePath];
  require.cache[modulePath] = {
    id: modulePath,
    filename: modulePath,
    loaded: true,
    exports,
  };
  t.after(() => {
    if (previous) require.cache[modulePath] = previous;
    else delete require.cache[modulePath];
  });
};

test('cashier password login issues a persistent database session', async (t) => {
  const credentialPath = require.resolve('../src/services/admin-credential-auth.service');
  const sessionPath = require.resolve('../src/services/admin-session.service');
  const middlewarePath = require.resolve('../src/middlewares/auth.middleware');
  const previousMiddleware = require.cache[middlewarePath];
  let savedSession = null;

  installModule(t, credentialPath, {
    authenticateCashier: async () => ({
      username: 'cashier.aktau',
      role: 'cashier',
      branchIds: ['11111111-1111-4111-8111-111111111111'],
      authVersion: 7,
    }),
  });
  installModule(t, sessionPath, {
    createAdminSession: async (session) => {
      savedSession = session;
    },
    revokeAdminSession: async () => {},
    validateAdminSession: async () => null,
  });
  delete require.cache[middlewarePath];
  t.after(() => {
    if (previousMiddleware) require.cache[middlewarePath] = previousMiddleware;
    else delete require.cache[middlewarePath];
  });

  const { adminLoginHandler } = require(middlewarePath);
  const { verifyToken } = require('../src/services/auth.service');
  const cookies = [];
  let responseStatus = 200;
  let responseBody = null;
  const response = {
    status(value) {
      responseStatus = value;
      return this;
    },
    cookie(name, value, options) {
      cookies.push({ name, value, options });
      return this;
    },
    json(value) {
      responseBody = value;
      return this;
    },
  };

  await adminLoginHandler(
    {
      body: { username: 'cashier.aktau', password: 'Bulka2026Secure' },
      headers: { 'user-agent': 'cashier-ipad-test' },
      ip: '127.0.0.1',
      log: { error: () => {} },
    },
    response,
  );

  assert.equal(responseStatus, 200);
  assert.equal(responseBody.user.role, 'cashier');
  assert.equal(cookies.length, 1);
  assert.equal(cookies[0].name, 'bulka_admin');
  assert.equal(cookies[0].options.maxAge, COOKIE_LIFETIME_MS);
  const token = verifyToken(cookies[0].value, 'bulka-admin');
  assert.equal(token.exp - token.iat, 12 * 60 * 60);
  assert.equal(savedSession.role, 'cashier');
  assert.equal(savedSession.authVersion, 7);
  assert.equal(savedSession.expiresAt, null);
});

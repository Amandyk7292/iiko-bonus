const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const sessions = require('../src/services/admin-session.service');
const { signAdminToken, verifyToken } = require('../src/services/auth.service');
const sessionPath = require.resolve('../src/services/admin-session.service');
let unavailable = false;
require.cache[sessionPath].exports = {
  ...sessions,
  validateAdminSession: async (...args) => {
    if (unavailable) throw new Error('database temporarily unavailable');
    return sessions.validateAdminSession(...args);
  },
};
const { adminAuthMiddleware } = require('../src/middlewares/auth.middleware');
test.after(() => {
  require.cache[sessionPath].exports = sessions;
});

async function request(token) {
  const result = { statusCode: 200, next: false, cookies: [] };
  const response = {
    status(code) {
      result.statusCode = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
    cookie(name, value, options) {
      result.cookies.push({ name, value, options });
    },
  };
  await adminAuthMiddleware(
    { headers: { cookie: `bulka_admin=${token}` }, query: {}, path: '/session' },
    response,
    () => {
      result.next = true;
    },
  );
  return result;
}

test('database-backed admin login survives the old JWT deadline and still supports logout', async () => {
  const jti = randomUUID();
  const token = signAdminToken(
    { username: 'persistent-admin', role: 'admin' },
    { jti, expiresIn: -1 },
  );
  await sessions.createAdminSession({
    jti,
    subject: 'persistent-admin',
    role: 'admin',
    expiresAt: null,
  });
  assert.throws(() => verifyToken(token, 'bulka-admin'), /expired/);
  const result = await request(token);
  assert.equal(result.next, true);
  assert.equal(result.cookies[0].options.maxAge, 400 * 86400000);
  assert.equal(result.cookies[0].options.httpOnly, true);
  await sessions.revokeAdminSession(jti);
  assert.equal((await request(token)).statusCode, 401);
});

test('an expired or absent database session never gains access from a signed token', async () => {
  const jti = randomUUID();
  const token = signAdminToken({ username: 'finite-admin', role: 'admin' }, { jti });
  assert.equal((await request(token)).statusCode, 401);
  await sessions.createAdminSession({
    jti,
    subject: 'finite-admin',
    role: 'admin',
    expiresAt: new Date(Date.now() - 1000),
  });
  assert.equal((await request(token)).statusCode, 401);
});

test('temporary admin session database failure is retryable and never reports logout', async () => {
  const jti = randomUUID();
  const token = signAdminToken({ username: 'recovering-admin', role: 'admin' }, { jti });
  await sessions.createAdminSession({
    jti,
    subject: 'recovering-admin',
    role: 'admin',
    expiresAt: null,
  });
  unavailable = true;
  try {
    const failed = await request(token);
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.body.code, 'ADMIN_SESSION_UNAVAILABLE');
    assert.equal(failed.next, false);
    assert.deepEqual(failed.cookies, []);
  } finally {
    unavailable = false;
  }
  assert.equal((await request(token)).next, true);
  assert.equal((await request(`${token}corrupt`)).statusCode, 401);
});

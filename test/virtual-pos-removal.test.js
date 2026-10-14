const assert = require('node:assert/strict');
const test = require('node:test');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { createAdminSession } = require('../src/services/admin-session.service');
const { signAdminToken } = require('../src/services/auth.service');
const virtualPos = require('../src/services/virtual-pos.service');
const { requestBodySafetyMiddleware } = require('../src/middlewares/validation.middleware');
const app = require('../src/app');

test('production app rejects every retired web POS endpoint without calling financial services', async (t) => {
  const previousApiSecret = process.env.API_SECRET;
  process.env.API_SECRET = 'virtual-pos-removal-test-only-api-secret';
  t.after(() => {
    if (previousApiSecret === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = previousApiSecret;
  });
  const calls = [];
  for (const name of [
    'catalog',
    'configureTerminal',
    'createSale',
    'getSale',
    'snapshot',
    'poll',
    'action',
  ]) {
    t.mock.method(virtualPos, name, async () => {
      calls.push(name);
      throw new Error('Removed web POS handler must not execute');
    });
  }
  const jti = randomUUID();
  await createAdminSession({
    jti,
    subject: 'web-pos-removal-owner',
    role: 'owner',
    expiresAt: new Date(Date.now() + 60_000),
  });
  const token = signAdminToken({ username: 'web-pos-removal-owner', role: 'owner' }, { jti });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const request = (method, path, authorization) =>
    fetch(base + path, {
      method,
      headers: {
        ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}),
        ...(['GET', 'HEAD'].includes(method) ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(['GET', 'HEAD'].includes(method) ? {} : { body: '{}' }),
    });

  assert.equal((await request('GET', '/admin/api/session', token)).status, 200);
  const saleId = randomUUID();
  const removed = [
    ['GET', '/admin/api/staff/virtual-pos/catalog'],
    ['POST', '/admin/api/staff/virtual-pos/sales'],
    ['GET', `/admin/api/staff/virtual-pos/sales/${saleId}`],
    ['PUT', '/admin/api/staff/virtual-pos/terminal'],
    ['GET', '/api/loyalty/virtual-pos/poll'],
    ['POST', '/api/loyalty/virtual-pos/snapshot'],
    ['POST', '/api/loyalty/virtual-pos/action'],
  ];
  for (const authorization of [undefined, token]) {
    for (const [method, path] of removed) {
      const response = await request(method, path, authorization);
      assert.equal(response.status, 404, `${method} ${path}`);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.match(response.headers.get('content-type'), /application\/json/);
      const { requestId, ...body } = await response.json();
      assert.equal(typeof requestId, 'string');
      assert.deepEqual(body, {
        success: false,
        code: 'VIRTUAL_POS_REMOVED',
        error: 'Раздел удалён',
      });
    }
  }
  assert.deepEqual(calls, []);
  // Ordinary Front activation, heartbeat and staff device management still reach
  // their own validation/authentication, rather than the retired-prefix handler.
  assert.equal((await request('POST', '/api/pos/activate')).status, 400);
  assert.equal((await request('POST', '/api/loyalty/pos/health/heartbeat')).status, 401);
  assert.equal((await request('GET', '/api/loyalty/pos/updates/latest')).status, 401);
  assert.equal((await request('GET', '/admin/api/staff/pos/devices')).status, 401);
});

test('retired snapshot URLs cannot bypass the shared 2,000-field request body limit', () => {
  for (const originalUrl of [
    '/api/loyalty/virtual-pos/snapshot',
    '/api/loyalty/virtual-pos/snapshot?cached=1',
    '/admin/api/staff/reports/production',
  ]) {
    for (const count of [2_000, 2_001]) {
      let result;
      requestBodySafetyMiddleware(
        {
          originalUrl,
          body: Object.fromEntries(
            Array.from({ length: count }, (_, index) => [`field${index}`, index]),
          ),
        },
        {},
        (error) => {
          result = error;
        },
      );
      assert.equal(result?.code, count > 2_000 ? 'REQUEST_BODY_TOO_COMPLEX' : undefined);
    }
  }
});

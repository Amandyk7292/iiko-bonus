const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  createCustomerSessionRateLimit,
  hasCustomerSessionCredential,
} = require('../src/middlewares/rate-limit.middleware');

async function withServer(app, run) {
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

test('customer session credential detection ignores an empty browser cookie probe', () => {
  assert.equal(
    hasCustomerSessionCredential({
      body: {},
      headers: { 'x-bulka-session-transport': 'cookie' },
    }),
    false,
  );
  assert.equal(
    hasCustomerSessionCredential({
      body: { refreshToken: 'native-refresh-token' },
      headers: {},
    }),
    true,
  );
  assert.equal(
    hasCustomerSessionCredential({
      body: {},
      headers: { cookie: 'other=value; bulka_customer_refresh=browser-refresh-token' },
    }),
    true,
  );
});

test('anonymous cold-start probes do not spend the protected session quota', async () => {
  const app = express();
  app.use(express.json());
  app.post('/refresh', createCustomerSessionRateLimit({ windowMs: 60_000, max: 2 }), (req, res) => {
    if (!hasCustomerSessionCredential(req)) {
      return res.status(401).json({ code: 'CUSTOMER_SESSION_REQUIRED' });
    }
    return res.status(204).end();
  });

  await withServer(app, async (origin) => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`${origin}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(response.status, 401);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(`${origin}/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: `valid-shape-token-${attempt}` }),
      });
      assert.equal(response.status, 204);
    }

    const limited = await fetch(`${origin}/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: 'another-valid-shape-token' }),
    });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'CUSTOMER_SESSION_RATE_LIMITED');
  });
});

test('refresh and logout use the session limiter instead of the login and OTP limiter', () => {
  const source = require('node:fs').readFileSync(
    require('node:path').join(__dirname, '..', 'src', 'routes', 'legacy.routes.js'),
    'utf8',
  );
  const refreshRoute = source.slice(
    source.indexOf("'/api/auth/refresh',"),
    source.indexOf("'/api/auth/logout',"),
  );
  const logoutRoute = source.slice(
    source.indexOf("'/api/auth/logout',"),
    source.indexOf("'/api/customer/fcm-token',"),
  );

  for (const route of [refreshRoute, logoutRoute]) {
    assert.match(route, /customerSessionRateLimit/);
    assert.doesNotMatch(route, /authRateLimit/);
  }
  assert.match(refreshRoute, /code:\s*'CUSTOMER_SESSION_REQUIRED'/);
  assert.ok(
    refreshRoute.indexOf('CUSTOMER_SESSION_REQUIRED') <
      refreshRoute.indexOf('rotateCustomerSession'),
  );
});

test('the production refresh route rejects an empty cookie probe before session rotation', async () => {
  const app = require('../src/app');

  await withServer(app, async (origin) => {
    const response = await fetch(`${origin}/api/auth/refresh`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bulka-Session-Transport': 'cookie',
      },
      body: '{}',
    });

    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.success, false);
    assert.equal(payload.error, 'Refresh session is required');
    assert.equal(payload.code, 'CUSTOMER_SESSION_REQUIRED');
    assert.match(payload.requestId, /^[0-9a-f-]{36}$/);
  });
});

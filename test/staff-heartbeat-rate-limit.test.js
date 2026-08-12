const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  createStaffPushHeartbeatPreAuthRateLimit,
  createStaffPushHeartbeatRateLimit,
  isStaffPushHeartbeatRequest,
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

test('only the exact staff heartbeat mutation bypasses the shared admin quota', () => {
  assert.equal(
    isStaffPushHeartbeatRequest({ method: 'POST', path: '/staff/push-heartbeat' }),
    true,
  );
  assert.equal(
    isStaffPushHeartbeatRequest({ method: 'GET', path: '/staff/push-heartbeat' }),
    false,
  );
  assert.equal(isStaffPushHeartbeatRequest({ method: 'POST', path: '/staff/push-token' }), false);
  assert.equal(isStaffPushHeartbeatRequest({ method: 'POST', path: '/kitchen/1/status' }), false);
});

test('heartbeat has a separate authenticated session quota that body values cannot bypass', async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { jti: 'cashier-session-1' };
    next();
  });
  app.post(
    '/heartbeat',
    createStaffPushHeartbeatRateLimit({ windowMs: 60_000, max: 2 }),
    (_req, res) => res.status(204).end(),
  );

  await withServer(app, async (origin) => {
    let requestNumber = 0;
    const request = () =>
      fetch(`${origin}/heartbeat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: requestNumber++ % 2 === 0 ? 'ios' : 'android',
          installationId: `ipad.branch.${requestNumber}`,
        }),
      });
    assert.equal((await request()).status, 204);
    assert.equal((await request()).status, 204);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'STAFF_HEARTBEAT_RATE_LIMITED');
  });
});

test('anonymous heartbeat attempts are bounded before authentication', async () => {
  const app = express();
  let authenticationAttempts = 0;
  app.post(
    '/heartbeat',
    createStaffPushHeartbeatPreAuthRateLimit({ windowMs: 60_000, max: 2 }),
    (_req, res) => {
      authenticationAttempts += 1;
      res.status(401).json({ error: 'Unauthorized' });
    },
  );

  await withServer(app, async (origin) => {
    const request = () => fetch(`${origin}/heartbeat`, { method: 'POST' });
    assert.equal((await request()).status, 401);
    assert.equal((await request()).status, 401);
    const limited = await request();
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).code, 'STAFF_HEARTBEAT_PREAUTH_RATE_LIMITED');
    assert.equal(authenticationAttempts, 2);
  });
});

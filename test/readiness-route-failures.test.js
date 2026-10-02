const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const health = require('../src/services/operational-health.service');
const originalSnapshot = health.readinessSnapshot;
let check = originalSnapshot;
health.readinessSnapshot = (...args) => check(...args);
process.env.BULKA_PUBLIC_APP_DIR = path.join(__dirname, 'fixtures', 'flutter-app');
process.env.BULKA_ADMIN_UI_DIR = path.join(__dirname, 'fixtures', 'admin-ui');
const app = require('../src/app');
const TOKEN = 'synthetic-readiness-metrics-token-32bytes';
let server;
let origin;

test.before(async () => {
  process.env.METRICS_BEARER_TOKEN = TOKEN;
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(async () => {
  await new Promise((resolve) => server.close(resolve));
});

test('public dependency failure is a minimal non-cacheable 503 and internal details require a bearer', async () => {
  check = () =>
    originalSnapshot({
      databaseCheck: async () => ({ ok: true }),
      branchPosCheck: async () => {
        throw new Error('sensitive diagnostic detail');
      },
      staffOrderAlertCheck: async () => ({ queueAvailable: true }),
      pushStatusCheck: () => ({ configured: false, initialized: false }),
    });
  const publicResponse = await fetch(`${origin}/readyz`);
  assert.equal(publicResponse.status, 503);
  assert.equal(publicResponse.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await publicResponse.json(), { status: 'not_ready' });
  assert.equal((await fetch(`${origin}/internal/readiness`)).status, 401);
  const privateResponse = await fetch(`${origin}/internal/readiness`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(privateResponse.status, 503);
  assert.equal(privateResponse.headers.get('cache-control'), 'no-store');
  const body = await privateResponse.json();
  assert.equal(body.status, 'not_ready');
  assert.equal(body.dependencies.branchPosCredentials.ok, false);
  assert.equal(body.dependencies.branchPosCredentials.errorCode, 'DEPENDENCY_UNAVAILABLE');
  assert.equal(body.dependencies.database.ok, true);
  assert.doesNotMatch(JSON.stringify(body), /sensitive diagnostic detail/);
});

test('a hung dependency finishes HTTP readiness as 503 rather than leaving the request open', async () => {
  check = () =>
    originalSnapshot({
      timeoutMs: 25,
      databaseCheck: () => new Promise(() => {}),
      branchPosCheck: async () => ({ readyForEnforcement: true }),
      staffOrderAlertCheck: async () => ({ queueAvailable: true }),
      pushStatusCheck: () => ({ configured: false, initialized: false }),
    });
  const response = await fetch(`${origin}/readyz`, { signal: AbortSignal.timeout(2000) });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { status: 'not_ready' });
});

test('unexpected application errors remain redacted and cannot cache a failed readiness response', async () => {
  check = async () => {
    throw new Error('sensitive application stack detail');
  };
  const response = await fetch(`${origin}/readyz`);
  assert.equal(response.status, 500);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.success, false);
  assert.equal(body.code, 'INTERNAL_ERROR');
  assert.ok(body.requestId);
  assert.doesNotMatch(JSON.stringify(body), /sensitive|stack/);
});

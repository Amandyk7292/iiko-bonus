const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');
const express = require('express');

const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const { normalizeOnlineOrderingConfig } = require('../src/services/online-ordering.service');
const { createOnlineOrderingMiddleware } = require('../src/middlewares/online-ordering.middleware');

async function startTestServer(middleware) {
  const app = express();
  app.use(middleware);
  app.use((_req, res) => res.json({ success: true }));

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

test('online ordering configuration accepts only an explicit boolean in strict mode', () => {
  assert.deepEqual(normalizeOnlineOrderingConfig({ disabled: true }, { strict: true }), {
    disabled: true,
  });
  assert.deepEqual(normalizeOnlineOrderingConfig('{"disabled":false}'), {
    disabled: false,
  });
  assert.throws(
    () => normalizeOnlineOrderingConfig({ disabled: 'yes' }, { strict: true }),
    /disabled/,
  );

  assert.equal(
    adminMutationSchemas.onlineOrdering.body.safeParse({ disabled: true }).success,
    true,
  );
  assert.equal(
    adminMutationSchemas.onlineOrdering.body.safeParse({
      disabled: true,
      unexpected: true,
    }).success,
    false,
  );
});

test('online ordering middleware allows checkout when enabled and blocks it when disabled', async (t) => {
  const enabledServer = await startTestServer(
    createOnlineOrderingMiddleware({
      loadConfig: async () => ({ disabled: false }),
    }),
  );
  t.after(enabledServer.close);
  assert.equal((await fetch(`${enabledServer.origin}/checkout`)).status, 200);

  const disabledServer = await startTestServer(
    createOnlineOrderingMiddleware({
      loadConfig: async () => ({ disabled: true }),
    }),
  );
  t.after(disabledServer.close);
  const blocked = await fetch(`${disabledServer.origin}/checkout`);
  assert.equal(blocked.status, 503);
  assert.deepEqual(await blocked.json(), {
    success: false,
    available: false,
    error: 'Онлайн-заказы и оплата временно отключены.',
    code: 'ONLINE_ORDERING_DISABLED',
    retryable: false,
  });
});

test('online ordering middleware fails closed when the setting cannot be checked', async (t) => {
  const server = await startTestServer(
    createOnlineOrderingMiddleware({
      loadConfig: async () => {
        throw Object.assign(new Error('database unavailable'), {
          code: 'ONLINE_ORDERING_CONFIG_UNAVAILABLE',
        });
      },
      log: { error() {} },
    }),
  );
  t.after(server.close);

  const response = await fetch(`${server.origin}/checkout`);
  assert.equal(response.status, 503);
  const payload = await response.json();
  assert.equal(payload.success, false);
  assert.equal(payload.code, 'ONLINE_ORDERING_CONFIG_UNAVAILABLE');
  assert.equal(payload.retryable, true);
});

test('every checkout quote and create route has the global ordering guard', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'public.routes.js'),
    'utf8',
  );
  const guardedRoutes = [
    '/api/customer/kaspi-pay/create',
    '/api/customer/kaspi-pay/quote',
    '/api/customer/forte-pay/create',
    '/api/customer/forte-pay/quote',
  ];

  for (const route of guardedRoutes) {
    const routeStart = source.indexOf(`'${route}'`);
    assert.notEqual(routeStart, -1, `${route} must exist`);
    const routeDefinition = source.slice(routeStart, routeStart + 260);
    assert.match(
      routeDefinition,
      /onlineOrderingMiddleware[\s\S]+validateRequest/,
      `${route} must run the ordering guard before request processing`,
    );
  }
});

test('gift certificate purchases use the same global ordering guard', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'customer', 'business-foundation.routes.js'),
    'utf8',
  );
  const routeStart = source.indexOf("'/api/customer/gift-certificate-purchases'");
  assert.notEqual(routeStart, -1);
  assert.match(
    source.slice(routeStart, routeStart + 300),
    /onlineOrderingMiddleware[\s\S]+validateRequest/,
  );
});

test('public browsing is never wired through the legacy IP allowlist middleware', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'app.js'), 'utf8');
  assert.doesNotMatch(source, /siteAccessMiddleware/);
  assert.doesNotMatch(source, /app\.use\(\s*siteAccessMiddleware\s*\)/);
});

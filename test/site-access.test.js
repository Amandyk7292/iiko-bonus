const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');
const express = require('express');

const {
  normalizeIpAddress,
  normalizeSiteAccessConfig,
} = require('../src/services/site-access.service');
const {
  createSiteAccessMiddleware,
  isProtectedSitePath,
} = require('../src/middlewares/site-access.middleware');

async function startTestServer(middleware) {
  const app = express();
  app.set('trust proxy', 1);
  app.use(middleware);
  app.use((req, res) => res.json({ ok: true, ip: req.ip }));

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

test('IP normalization handles IPv4, IPv4-mapped IPv6 and canonical IPv6', () => {
  assert.equal(normalizeIpAddress('185.22.64.10'), '185.22.64.10');
  assert.equal(normalizeIpAddress('::ffff:185.22.64.10'), '185.22.64.10');
  assert.equal(normalizeIpAddress('::ffff:c000:0201'), '192.0.2.1');
  assert.equal(normalizeIpAddress('[2001:0db8:0:0:0:0:0:1]'), '2001:db8::1');
  assert.equal(normalizeIpAddress('not-an-ip'), null);
});

test('site access configuration validates, canonicalizes and de-duplicates addresses', () => {
  assert.deepEqual(
    normalizeSiteAccessConfig(
      {
        enabled: true,
        allowedIps: ['::ffff:192.0.2.1', '192.0.2.1', '2001:0db8::1'],
      },
      { strict: true },
    ),
    { enabled: true, allowedIps: ['192.0.2.1', '2001:db8::1'] },
  );
  assert.throws(
    () => normalizeSiteAccessConfig({ enabled: true, allowedIps: [] }, { strict: true }),
    /Добавьте хотя бы один IP-адрес/,
  );
  assert.throws(
    () =>
      normalizeSiteAccessConfig({ enabled: false, allowedIps: ['300.1.1.1'] }, { strict: true }),
    /Некорректный IP-адрес/,
  );
});

test('only public website routes are protected', () => {
  assert.equal(isProtectedSitePath('/'), true);
  assert.equal(isProtectedSitePath('/app/'), true);
  assert.equal(isProtectedSitePath('/wallet/token'), true);
  assert.equal(isProtectedSitePath('/admin'), false);
  assert.equal(isProtectedSitePath('/admin/api/session'), false);
  assert.equal(isProtectedSitePath('/api/customer/profile'), false);
  assert.equal(isProtectedSitePath('/webhooks/kaspi'), false);
  assert.equal(isProtectedSitePath('/healthz'), false);
  assert.equal(isProtectedSitePath('/payment-and-refund'), false);
  assert.equal(isProtectedSitePath('/payment-and-refund/'), false);
  assert.equal(isProtectedSitePath('/delivery-terms'), false);
  assert.equal(isProtectedSitePath('/delivery-terms/'), false);
  assert.equal(isProtectedSitePath('/company-details'), false);
  assert.equal(isProtectedSitePath('/company-details/'), false);
  assert.equal(isProtectedSitePath('/kk/payment-and-refund'), false);
  assert.equal(isProtectedSitePath('/kk/privacy/'), false);
  assert.equal(isProtectedSitePath('/en/delivery-terms'), false);
  assert.equal(isProtectedSitePath('/en/company-details/'), false);
  assert.equal(isProtectedSitePath('/kk'), true);
  assert.equal(isProtectedSitePath('/en/not-a-legal-page'), true);
  assert.equal(isProtectedSitePath('/robots.txt'), false);
  assert.equal(isProtectedSitePath('/sitemap.xml'), false);
  assert.equal(isProtectedSitePath('/payment-receipts/receipt-id'), false);
  assert.equal(isProtectedSitePath('/assets/legal/payment-receipt.css'), false);
  assert.equal(isProtectedSitePath('/privacy'), false);
  assert.equal(isProtectedSitePath('/courier'), false);
  assert.equal(isProtectedSitePath('/taplink'), false);
  assert.equal(isProtectedSitePath('/taplink/styles.css'), false);
  assert.equal(isProtectedSitePath('/apiary'), true);
});

test('site access middleware admits allowlisted IPs and blocks other visitors', async (t) => {
  const middleware = createSiteAccessMiddleware({
    loadConfig: async () => ({ enabled: true, allowedIps: ['203.0.113.7'] }),
  });
  const server = await startTestServer(middleware);
  t.after(server.close);

  const allowed = await fetch(`${server.origin}/app/`, {
    headers: { 'X-Forwarded-For': '203.0.113.7', Accept: 'text/html' },
  });
  assert.equal(allowed.status, 200);
  assert.equal((await allowed.json()).ok, true);

  const denied = await fetch(`${server.origin}/app/`, {
    headers: { 'X-Forwarded-For': '198.51.100.9', Accept: 'text/html' },
  });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get('content-type') || '', /text\/html/);
  assert.match(await denied.text(), /198\.51\.100\.9/);

  const deniedAsset = await fetch(`${server.origin}/app/main.dart.js`, {
    headers: { 'X-Forwarded-For': '198.51.100.9', Accept: '*/*' },
  });
  assert.equal(deniedAsset.status, 403);
  assert.match(deniedAsset.headers.get('content-type') || '', /application\/json/);
  assert.equal((await deniedAsset.json()).code, 'SITE_IP_NOT_ALLOWED');

  const admin = await fetch(`${server.origin}/admin`, {
    headers: { 'X-Forwarded-For': '198.51.100.9' },
  });
  assert.equal(admin.status, 200);

  const taplink = await fetch(`${server.origin}/taplink`, {
    headers: { 'X-Forwarded-For': '198.51.100.9', Accept: 'text/html' },
  });
  assert.equal(taplink.status, 200);
});

test('site access middleware is open when disabled and fails closed on config errors', async (t) => {
  const disabledServer = await startTestServer(
    createSiteAccessMiddleware({
      loadConfig: async () => ({ enabled: false, allowedIps: [] }),
    }),
  );
  t.after(disabledServer.close);
  assert.equal((await fetch(`${disabledServer.origin}/`)).status, 200);

  const unavailableServer = await startTestServer(
    createSiteAccessMiddleware({
      loadConfig: async () => {
        throw new Error('database unavailable');
      },
      logger: { error() {} },
    }),
  );
  t.after(unavailableServer.close);
  const unavailable = await fetch(`${unavailableServer.origin}/`, {
    headers: { Accept: 'text/html' },
  });
  assert.equal(unavailable.status, 503);
  assert.match(await unavailable.text(), /временно недоступен/);
});

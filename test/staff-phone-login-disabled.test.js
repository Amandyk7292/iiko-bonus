const test = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { registerAdminAuthRoutes } = require('../src/routes/admin/auth.routes');

test('staff WhatsApp request and verify URLs no longer register handlers', () => {
  const registered = [];
  const router = {
    post(path) { registered.push(`POST ${path}`); },
    get(path) { registered.push(`GET ${path}`); },
  };
  const next = (_req, _res, proceed) => proceed();
  registerAdminAuthRoutes(router, { auth: next, audit: next });
  assert.deepEqual(registered, [
    'POST /admin/api/login',
    'POST /admin/api/whatsapp/operator-access',
    'POST /admin/api/logout',
    'GET /admin/api/session',
  ]);
});

test('cached staff login clients cannot request or verify a WhatsApp code', async (t) => {
  const app = express();
  app.use(express.json());
  const next = (_req, _res, proceed) => proceed();
  registerAdminAuthRoutes(app, { auth: next, audit: next });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  for (const suffix of ['request', 'verify']) {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/login/phone/${suffix}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: '+77001234567', code: '123456' }),
      },
    );
    assert.equal(response.status, 404, suffix);
    assert.equal(response.headers.get('set-cookie'), null, 'obsolete login must not issue a session');
  }
});

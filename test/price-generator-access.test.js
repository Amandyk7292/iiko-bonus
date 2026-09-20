const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const bcrypt = require('bcryptjs');
const { verifyAdminSessionToken } = require('../src/services/auth.service');
require.cache[require.resolve('../src/middlewares/auth.middleware')] = {
  exports: {
    async adminAuthMiddleware(req, res, next) {
      if (req.headers.cookie === 'bulka_admin=admin-test') {
        req.admin = { role: 'admin', username: 'admin-test' };
        return next();
      }
      if (req.headers.cookie === 'bulka_admin=viewer-test') {
        req.admin = { role: 'viewer' };
        return next();
      }
      return res.status(401).json({ error: 'Unauthorized' });
    },
  },
};
require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      from() {
        return {
          select() {
            return {
              eq() {
                return {
                  async maybeSingle() {
                    return { data: null };
                  },
                };
              },
            };
          },
        };
      },
    },
  },
};
const router = require('../src/routes/price-generator.routes');
let server, origin;
const endpoint = '/admin/api/pricegenerator';
test.before(async () => {
  process.env.PRICE_GENERATOR_EDIT_CODE_HASH = await bcrypt.hash('0123', 4);
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ code: err.code }));
  server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => {
  server.close();
  delete process.env.PRICE_GENERATOR_EDIT_CODE_HASH;
});
const request = (path, { method = 'GET', cookie, body, source = origin } = {}) =>
  fetch(origin + path, {
    method,
    headers: {
      Origin: source,
      ...(cookie ? { Cookie: cookie } : {}),
      'Content-Type': 'application/json',
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

test('printing is public while guest writes/history are blocked', async () => {
  assert.equal((await request('/pricegenerator')).status, 200);
  assert.equal((await request('/api/pricegenerator/products')).status, 200);
  assert.deepEqual(await (await request(endpoint + '/access')).json(), {
    canEdit: false,
    via: null,
  });
  for (const path of ['template', 'products', 'import'])
    assert.equal((await request(endpoint + '/' + path, { method: 'POST', body: {} })).status, 401);
  assert.equal((await request(endpoint + '/history')).status, 401);
});
test('admin edits without a code; non-admin needs one', async () => {
  const admin = { cookie: 'bulka_admin=admin-test' };
  assert.deepEqual(await (await request(endpoint + '/access', admin)).json(), {
    canEdit: true,
    via: 'admin',
  });
  assert.equal((await request(endpoint + '/history', admin)).status, 200);
  assert.equal(
    (await request(endpoint + '/history', { cookie: 'bulka_admin=viewer-test' })).status,
    403,
  );
});
test('code grants only label editing, uses a protected expiring cookie, and rejects forgery', async () => {
  assert.equal(
    (await request(endpoint + '/access', { method: 'POST', body: { code: '9999' } })).status,
    401,
  );
  const login = await request(endpoint + '/access', { method: 'POST', body: { code: '0123' } });
  assert.equal(login.status, 200);
  const header = login.headers.get('set-cookie');
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  assert.match(header, /Path=\/admin\/api\/pricegenerator/);
  assert.match(header, /Max-Age=43200/);
  const cookie = header.split(';')[0];
  assert.equal((await request(endpoint + '/history', { cookie })).status, 200);
  assert.equal(
    (await request(endpoint + '/import', { method: 'POST', cookie, body: {} })).status,
    400,
  );
  assert.throws(() => verifyAdminSessionToken(cookie.split('=')[1]));
  assert.equal((await request(endpoint + '/history', { cookie: cookie + 'forged' })).status, 401);
  assert.equal(
    (
      await request(endpoint + '/products', {
        method: 'POST',
        cookie,
        source: 'https://evil.example',
        body: {},
      })
    ).status,
    403,
  );
  const locked = await request(endpoint + '/access', { method: 'DELETE', cookie });
  assert.match(locked.headers.get('set-cookie'), /Expires=Thu, 01 Jan 1970/);
  const oldHash = process.env.PRICE_GENERATOR_EDIT_CODE_HASH;
  process.env.PRICE_GENERATOR_EDIT_CODE_HASH = '';
  assert.equal((await request(endpoint + '/history', { cookie })).status, 401);
  process.env.PRICE_GENERATOR_EDIT_CODE_HASH = oldHash;
});
test('cross-origin unlock and malformed codes are rejected and attempts are limited', async () => {
  assert.equal(
    (
      await request(endpoint + '/access', {
        method: 'POST',
        source: 'https://evil.example',
        body: { code: '0123' },
      })
    ).status,
    403,
  );
  assert.equal(
    (await request(endpoint + '/access', { method: 'POST', body: { code: 'short' } })).status,
    400,
  );
  let response;
  for (let i = 0; i < 11; i++)
    response = await request(endpoint + '/access', { method: 'POST', body: { code: '9999' } });
  assert.equal(response.status, 429);
});

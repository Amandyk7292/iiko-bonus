const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');
const { registerCustomerAvatarRoutes } = require('../src/routes/public/customer-avatar.routes');

test('avatar upload validates images, binds owner, and rolls back failed profile saves', async (t) => {
  let failSave = false;
  const writes = [],
    removed = [];
  const bucket = {
    upload: async (path, bytes) => {
      writes.push({ path, bytes });
      return {};
    },
    getPublicUrl: (path) => ({ data: { publicUrl: 'https://images.test/' + path } }),
    remove: async (paths) => {
      removed.push(...paths);
      return {};
    },
  };
  const db = {
    storage: {
      from: (name) => {
        assert.equal(name, 'customer_avatars');
        return bucket;
      },
    },
    from: () => ({
      update: (values) => {
        assert.equal(values.avatar_key, 'custom');
        return {
          eq: (key, id) => {
            assert.equal(key, 'id');
            assert.equal(id, 'authenticated-customer');
            return {
              is: () => ({
                select: () => ({
                  maybeSingle: async () =>
                    failSave ? { error: new Error('db') } : { data: { id } },
                }),
              }),
            };
          },
        };
      },
    }),
  };
  const app = express();
  app.use((req, _, next) => {
    if (req.headers.authorization) req.customerAuth = { id: 'authenticated-customer' };
    next();
  });
  registerCustomerAvatarRoutes(app, db);
  const server = app.listen(0);
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/customer/profile/avatar`;
  const send = (bytes, authorized = true) => {
    const body = new FormData();
    body.append('image', new Blob([bytes], { type: 'image/png' }), 'avatar.png');
    return fetch(url, {
      method: 'POST',
      body,
      headers: authorized ? { authorization: 'test' } : {},
    });
  };
  const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#ffb300' } })
    .png()
    .toBuffer();
  assert.equal((await send(png, false)).status, 401);
  assert.equal((await send(Buffer.from('not an image'))).status, 400);
  const large = await send(Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.equal(large.status, 413);
  assert.equal((await large.json()).code, 'CUSTOMER_AVATAR_TOO_LARGE');
  assert.equal(writes.length, 0);
  const response = await send(png);
  assert.equal(response.status, 200);
  assert.equal((await response.json()).avatar.avatarKey, 'custom');
  assert.match(writes[0].path, /^authenticated-customer\//);
  failSave = true;
  assert.equal((await send(png)).status, 503);
  assert.deepEqual(removed, [writes[1].path]);
});

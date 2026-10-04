const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const sharp = require('sharp');

const writes = [];
let failStorage = false;
const bucket = {
  async upload(name, buffer, options) {
    writes.push({ name, buffer, options });
    return { error: failStorage ? { message: 'unavailable' } : null };
  },
  getPublicUrl(name) {
    return {
      data: {
        publicUrl: `https://project.supabase.co/storage/v1/object/public/menu_images/${name}`,
      },
    };
  },
};
require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      storage: {
        from: (name) => {
          assert.equal(name, 'menu_images');
          return bucket;
        },
      },
      from: () => assert.fail('Unexpected database request'),
    },
  },
};
require.cache[require.resolve('../src/services/iiko-city-profile.service')] = {
  exports: {
    getIikoClientForBranch: async () => ({ profileKey: 'default' }),
    invalidateAllIikoCaches: () => assert.fail('Photo must not invalidate raw iiko'),
  },
};
const realAuth = require('../src/middlewares/auth.middleware');
const testAdminAuth = (req, res, next) => {
  if (req.headers.authorization !== 'Bearer test') return res.status(401).end();
  req.admin = {
    role: req.headers['x-test-role'] || 'owner',
    selectedBranchId: 'branch',
    selectedBranchIds: ['branch'],
  };
  next();
};
require.cache[require.resolve('../src/middlewares/auth.middleware')] = {
  exports: {
    ...realAuth,
    adminAuthMiddleware: testAdminAuth,
  },
};

test('real admin multipart uploads optimize product/category/legacy photos automatically and preserve other image purposes', async (t) => {
  const menu = require('../src/services/menu.service');
  const realtime = require('../src/services/realtime.service');
  const bindings = [],
    events = [];
  t.mock.method(menu, 'setProductOverride', async (...args) =>
    bindings.push({ type: 'product', args }),
  );
  t.mock.method(menu, 'setCategoryOverride', async (...args) =>
    bindings.push({ type: 'category', args }),
  );
  t.mock.method(realtime, 'publish', (...args) => events.push(args));
  t.mock.method(console, 'error', () => {});
  const app = express();
  app.use('/admin/api', testAdminAuth, realAuth.adminMutationRoleMiddleware);
  require('../src/routes/admin/menu.routes').registerMenuAdminRoutes(app);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ success: false, code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const input = await sharp({
    create: {
      width: 140,
      height: 70,
      channels: 4,
      background: { r: 200, g: 120, b: 60, alpha: 0.5 },
    },
  })
    .png()
    .toBuffer();
  const send = async (
    endpoint,
    fields = {},
    bytes = input,
    mime = 'image/png',
    authorized = true,
    role = 'owner',
  ) => {
    const body = new FormData();
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    body.append('image', new Blob([bytes], { type: mime }), 'camera-upload.png');
    const response = await fetch(origin + endpoint, {
      method: 'POST',
      body,
      headers: authorized ? { authorization: 'Bearer test', 'x-test-role': role } : {},
    });
    return { status: response.status, text: await response.text() };
  };
  const photoPath = '/admin/api/menu/upload-photo';
  const legacyPath = '/admin/api/menu/upload-image';
  assert.equal((await send(legacyPath, {}, input, 'image/png', false)).status, 401);
  assert.equal(writes.length, 0);
  for (const targetType of ['product', 'category']) {
    const response = await send(photoPath, { targetType, targetId: 'cake', profileKey: 'default' });
    assert.equal(response.status, 200);
    const result = JSON.parse(response.text);
    assert.equal(result.success, true);
    assert.equal(result.optimized, true);
    const stored = writes.at(-1);
    assert.match(stored.name, /^menu_.*\.webp$/);
    assert.equal(stored.options.contentType, 'image/webp');
    assert.equal(stored.options.cacheControl, '31536000');
    assert.equal(stored.options.upsert, false);
    assert.deepEqual(stored.options.metadata, {
      purpose: 'menu-photo',
      encoding: 'webp-photo-v1',
      width: 140,
      height: 70,
      sourceBytes: input.length,
      optimizedBytes: stored.buffer.length,
    });
    const metadata = await sharp(stored.buffer).metadata();
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 140, 'small photos are never upscaled');
    assert.equal(metadata.height, 70);
    const alpha = await sharp(stored.buffer).extractChannel('alpha').raw().toBuffer();
    assert.ok(alpha.every((value) => value === 128));
    assert.equal(bindings.at(-1).type, targetType);
    assert.deepEqual(bindings.at(-1).args, [
      'cake',
      { custom_image_url: result.imageUrl },
      { profileKey: 'default' },
    ]);
  }
  assert.equal(events.length, 2);
  assert.equal(
    (await send(legacyPath)).status,
    200,
    'native and old admin callers opt in automatically',
  );
  assert.equal(writes.at(-1).options.contentType, 'image/webp');
  for (const [endpoint, fields] of [
    [legacyPath, { purpose: 'sticker' }],
    ['/admin/api/loyalty-tiers/upload-image', {}],
  ]) {
    assert.equal((await send(endpoint, fields)).status, 200);
    const stored = writes.at(-1);
    assert.match(stored.name, /\.png$/);
    assert.equal(stored.options.contentType, 'image/png');
    assert.equal(stored.options.metadata, undefined);
    assert.deepEqual(
      await sharp(stored.buffer).raw().toBuffer(),
      await sharp(input).raw().toBuffer(),
    );
  }
  for (const endpoint of [
    legacyPath + '/',
    legacyPath.toUpperCase(),
    legacyPath.toUpperCase() + '/',
  ]) {
    assert.equal((await send(endpoint)).status, 200, endpoint);
    assert.equal(writes.at(-1).options.contentType, 'image/webp');
    assert.equal((await send(endpoint, { purpose: 'sticker' })).status, 200, endpoint);
    assert.equal(writes.at(-1).options.contentType, 'image/png');
    assert.deepEqual(
      await sharp(writes.at(-1).buffer).raw().toBuffer(),
      await sharp(input).raw().toBuffer(),
    );
    assert.equal((await send(endpoint, { purpose: 'invalid' })).status, 400);
  }
  for (const endpoint of [photoPath + '/', photoPath.toUpperCase() + '/']) {
    assert.equal(
      (await send(endpoint)).status,
      400,
      'a photo alias still requires target and profile',
    );
    const response = await send(endpoint, {
      targetType: 'category',
      targetId: 'alias-cake',
      profileKey: 'default',
    });
    assert.equal(response.status, 200, endpoint);
    assert.equal(writes.at(-1).options.contentType, 'image/webp');
    assert.equal(bindings.at(-1).type, 'category');
    assert.equal(bindings.at(-1).args[0], 'alias-cake');
    assert.equal(bindings.at(-1).args[1].custom_image_url, JSON.parse(response.text).imageUrl);
    assert.equal(
      (
        await send(endpoint, {
          targetType: 'category',
          targetId: 'alias-cake',
          profileKey: 'astana',
        })
      ).status,
      409,
    );
  }
  const count = writes.length;
  const successfulBindings = bindings.length;
  const successfulEvents = events.length;
  for (const endpoint of [
    legacyPath + '/',
    legacyPath.toUpperCase(),
    photoPath + '/',
    photoPath.toUpperCase() + '/',
  ]) {
    assert.equal((await send(endpoint, {}, input, 'image/png', false)).status, 401);
    for (const role of ['viewer', 'cashier', 'courier']) {
      assert.equal(
        (await send(endpoint, {}, input, 'image/png', true, role)).status,
        403,
        `${role}: ${endpoint}`,
      );
    }
  }
  assert.equal(
    (await send(photoPath, { targetType: 'product', targetId: 'cake', profileKey: 'astana' }))
      .status,
    409,
  );
  assert.equal((await send(legacyPath, { purpose: 'document' })).status, 400);
  assert.equal((await send(legacyPath, {}, Buffer.from('not an image'))).status, 400);
  assert.equal((await send(legacyPath, {}, input, 'image/jpeg')).status, 400);
  assert.equal(
    (await send(legacyPath, {}, Buffer.from('%PDF-test'), 'application/pdf')).status,
    400,
  );
  const tooLarge = await send(legacyPath, {}, Buffer.alloc(5 * 1024 * 1024 + 1));
  assert.equal(tooLarge.status, 413);
  assert.equal(JSON.parse(tooLarge.text).code, 'MENU_IMAGE_TOO_LARGE');
  assert.equal(writes.length, count, 'invalid or unauthorized files never reach storage');
  failStorage = true;
  assert.equal(
    (await send(photoPath, { targetType: 'product', targetId: 'cake', profileKey: 'default' }))
      .status,
    500,
  );
  assert.equal(bindings.length, successfulBindings, 'failed storage cannot update a product');
  assert.equal(events.length, successfulEvents, 'failed storage cannot publish a photo');
});

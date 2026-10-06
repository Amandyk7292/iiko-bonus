const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const { registerCheckoutPhotoRoutes } = require('../src/routes/public/checkout-photo.routes');
const photos = require('../src/services/pickup-photo-gift.service');

test('customer photo HTTP upload and restoration stay authenticated, private and bounded', async (t) => {
  const owner = crypto.randomUUID(),
    id = crypto.randomUUID(),
    branch = crypto.randomUUID();
  const image = await sharp({ create: { width: 10, height: 10, channels: 3, background: 'white' } })
    .jpeg()
    .toBuffer();
  let uploads = 0;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    if (req.headers['x-test-customer']) req.customerAuth = { id: req.headers['x-test-customer'] };
    next();
  });
  registerCheckoutPhotoRoutes(app, {
    uploadPhoto: async (customer, file) => {
      assert.equal(customer, owner);
      uploads++;
      await photos.normalizePhoto(file?.buffer, file?.mimetype);
      return { photoId: id, expiresAt: '2026-10-07T00:00:00.000Z' };
    },
    customerPhoto: async (customer, photo) => {
      if (customer !== owner || photo !== id)
        throw Object.assign(new Error('Фото не найдено.'), {
          statusCode: 404,
          code: 'PICKUP_PHOTO_NOT_FOUND',
        });
      return image;
    },
    photoCapability: async (branchId) => {
      assert.equal(branchId, branch);
      return { available: true };
    },
    deleteCustomerPhoto: async () => ({ deleted: true }),
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}/api/customer/checkout-photo`;
  const form = () => {
    const body = new FormData();
    body.append('photo', new Blob([image], { type: 'image/jpeg' }), 'photo.jpg');
    return body;
  };
  const anonymous = await fetch(base, { method: 'POST', body: form() });
  assert.equal(anonymous.status, 401);
  assert.equal(uploads, 0);
  const result = await fetch(base, {
    method: 'POST',
    headers: { 'x-test-customer': owner },
    body: form(),
  });
  assert.equal(result.status, 201);
  assert.match(result.headers.get('cache-control'), /private.*no-store/);
  assert.deepEqual(await result.json(), {
    success: true,
    photoId: id,
    expiresAt: '2026-10-07T00:00:00.000Z',
  });
  const extra = form();
  extra.append('photoUrl', 'https://foreign.example/photo.jpg');
  const invalid = await fetch(base, {
    method: 'POST',
    headers: { 'x-test-customer': owner },
    body: extra,
  });
  assert.equal(invalid.status, 400);
  assert.equal(uploads, 1);
  const restored = await fetch(`${base}/${id}/image`, { headers: { 'x-test-customer': owner } });
  assert.equal(restored.status, 200);
  assert.match(restored.headers.get('content-type'), /^image\/jpeg/);
  assert.match(restored.headers.get('cache-control'), /no-store/);
  assert.deepEqual(Buffer.from(await restored.arrayBuffer()), image);
  const foreign = await fetch(`${base}/${id}/image`, {
    headers: { 'x-test-customer': crypto.randomUUID() },
  });
  assert.equal(foreign.status, 404);
  assert.equal((await fetch(`${base}/${id}/image`)).status, 401);
  const capability = await fetch(`${base}/capability?branchId=${branch}`, {
    headers: { 'x-test-customer': owner },
  });
  assert.deepEqual(await capability.json(), { success: true, available: true });
});

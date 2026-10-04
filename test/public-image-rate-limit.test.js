const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

test('only GET/HEAD for the exact image route use the image quota', () => {
  const { isPublicImageRequest } = require('../src/middlewares/rate-limit.middleware');
  for (const method of ['GET', 'HEAD'])
    for (const originalUrl of ['/api/public/image?path=a&edge=256', '/API/PUBLIC/IMAGE/'])
      assert.equal(isPublicImageRequest({ method, originalUrl, path: '/image' }), true);
  for (const method of ['POST', 'PUT', 'DELETE', 'OPTIONS'])
    assert.equal(isPublicImageRequest({ method, originalUrl: '/api/public/image' }), false);
  for (const originalUrl of [
    '/api/public/images',
    '/api/public/image/extra',
    '/api/customer/image',
    '/api/public/product-options?path=/api/public/image',
  ])
    assert.equal(isPublicImageRequest({ method: 'GET', originalUrl }), false);
});

test('a catalog can load two variants without consuming public/customer or global API quotas; all quotas remain enforced', async (t) => {
  const service = require('../src/services/public-image.service');
  let images = 0;
  t.mock.method(service, 'publicImage', async () => {
    images++;
    return { key: 'fixture', buffer: Buffer.from('image') };
  });
  const {
    globalApiRateLimit,
    publicApiRateLimit,
    authRateLimit,
  } = require('../src/middlewares/rate-limit.middleware');
  const app = express();
  app.use('/api', globalApiRateLimit);
  app.use('/api/public', publicApiRateLimit);
  app.use('/api/customer', publicApiRateLimit);
  require('../src/routes/public/image.routes').registerPublicImageRoutes(app);
  app.get(['/api/public/check', '/api/customer/check', '/api/other/check'], (_req, res) =>
    res.status(204).end(),
  );
  app.post('/api/auth/check', authRateLimit, (_req, res) => res.status(204).end());
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  const request = async (path, init) => {
    const response = await fetch(origin + path, init);
    const body = await response.text();
    return { status: response.status, headers: response.headers, body };
  };
  for (let i = 0; i < 300; i++) {
    const response = await request(
      `/api/public/image?path=menu_images/${i % 125}.png&edge=${i < 125 ? 384 : 512}&mode=photo`,
    );
    assert.equal(response.status, 200, `image ${i + 1}`);
    assert.equal(response.headers.get('ratelimit-limit'), '300');
  }
  const exhausted = await request('/API/PUBLIC/IMAGE/?path=menu_images/a.png&edge=384', {
    method: 'HEAD',
  });
  assert.equal(exhausted.status, 429, 'HEAD and case aliases cannot bypass the image limiter');
  assert.equal(images, 300, 'blocked requests never reach conversion');
  const blockedImage = await request('/api/public/image?path=menu_images/a.png&edge=384');
  assert.equal(JSON.parse(blockedImage.body).code, 'PUBLIC_IMAGE_RATE_LIMITED');
  // Authentication retains its smaller limit after the image burst.
  for (let i = 0; i < 20; i++)
    assert.equal((await request('/api/auth/check', { method: 'POST' })).status, 204);
  assert.equal((await request('/api/auth/check', { method: 'POST' })).status, 429);
  for (let i = 0; i < 120; i++)
    assert.equal((await request(i % 2 ? '/api/customer/check' : '/api/public/check')).status, 204);
  const blockedBusiness = await request('/api/customer/check');
  assert.equal(blockedBusiness.status, 429);
  assert.equal(JSON.parse(blockedBusiness.body).error, 'Too many requests');
  // 21 auth + 121 public/customer attempts have spent exactly 142 global slots.
  for (let i = 0; i < 158; i++) assert.equal((await request('/api/other/check')).status, 204);
  const blockedGlobal = await request('/api/other/check');
  assert.equal(blockedGlobal.status, 429);
  assert.equal(JSON.parse(blockedGlobal.body).error, 'Too many API requests');
});

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');

async function imageService(t, original, beforeFetch = async () => {}) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-photo-test-'));
  const previousDir = process.env.PUBLIC_IMAGE_CACHE_DIR;
  const previousUrl = process.env.SUPABASE_URL;
  process.env.PUBLIC_IMAGE_CACHE_DIR = directory;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const fetchPath = require.resolve('node-fetch');
  const servicePath = require.resolve('../src/services/public-image.service');
  const oldFetch = require.cache[fetchPath];
  const oldService = require.cache[servicePath];
  let requests = 0;
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: async () => {
      requests++;
      await beforeFetch();
      return { ok: true, buffer: async () => original };
    },
  };
  delete require.cache[servicePath];
  t.after(async () => {
    if (oldFetch) require.cache[fetchPath] = oldFetch;
    else delete require.cache[fetchPath];
    if (oldService) require.cache[servicePath] = oldService;
    else delete require.cache[servicePath];
    if (previousDir === undefined) delete process.env.PUBLIC_IMAGE_CACHE_DIR;
    else process.env.PUBLIC_IMAGE_CACHE_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    await fs.rm(directory, { recursive: true, force: true });
  });
  return { ...require(servicePath), requests: () => requests, directory };
}

async function photoFixture() {
  const width = 512;
  const height = 384;
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 128 + 120 * Math.sin(x / 9 + y / 21);
      raw[i + 1] = 128 + 120 * Math.cos(x / 31 - y / 13);
      raw[i + 2] = 128 + 120 * Math.sin(x / 43 + y / 19);
      raw[i + 3] = 30 + ((x + y) % 220);
    }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

test('photo mode reduces a photographic fixture while preserving dimensions, alpha and the lossless cache', async (t) => {
  const original = await photoFixture();
  const service = await imageService(t, original);
  const [lossless, photo, samePhoto] = await Promise.all([
    service.publicImage('menu_images/photo.png', 256),
    service.publicImage('menu_images/photo.png', 256, 'photo'),
    service.publicImage('menu_images/photo.png', 256, 'photo'),
  ]);
  assert.equal(service.requests(), 2, 'two modes are distinct jobs; identical photos coalesce');
  assert.ok(photo.buffer.length < lossless.buffer.length * 0.7);
  assert.deepEqual(photo, samePhoto);
  assert.notEqual(photo.key, lossless.key);
  const metadata = await sharp(photo.buffer).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 192);
  assert.equal(metadata.hasAlpha, true);
  const expected = await sharp(original)
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer();
  assert.deepEqual(await sharp(lossless.buffer).raw().toBuffer(), expected);
  const losslessAlpha = await sharp(lossless.buffer).extractChannel('alpha').raw().toBuffer();
  assert.deepEqual(
    await sharp(photo.buffer).extractChannel('alpha').raw().toBuffer(),
    losslessAlpha,
  );
  assert.deepEqual(await service.publicImage('menu_images/photo.png', 256, 'lossless'), lossless);
  assert.deepEqual(await service.publicImage('menu_images/photo.png', 256, 'photo'), photo);
  assert.equal(service.requests(), 2, 'both modes are independently cached');
  assert.equal((await fs.readdir(path.join(service.directory, 'bulka-images-v2'))).length, 2);
  for (const mode of ['', 'PHOTO', 'lossy', null, ['photo']]) {
    await assert.rejects(service.publicImage('menu_images/photo.png', 256, mode), {
      statusCode: 400,
    });
  }
  await assert.rejects(service.publicImage('menu_images/../private.png', 256, 'photo'), {
    statusCode: 400,
  });
  assert.equal(service.requests(), 2, 'invalid modes and paths never fetch upstream');
});

test('photo and lossless ETags remain distinct even when both retain the same smaller original WebP', async (t) => {
  const original = await sharp(await photoFixture())
    .resize(192, 144)
    .webp({ quality: 10 })
    .toBuffer();
  const service = await imageService(t, original);
  const photo = await service.publicImage('stories/small.webp', 256, 'photo');
  const lossless = await service.publicImage('stories/small.webp', 256);
  assert.deepEqual(photo.buffer, original);
  assert.deepEqual(lossless.buffer, original);
  assert.notEqual(photo.key, lossless.key);
  assert.equal((await sharp(photo.buffer).metadata()).width, 192, 'never enlarge a photo');
});

test('a generated menu master that already fits is served byte-for-byte without another photo encode', async (t) => {
  const { optimizeMenuPhoto } = require('../src/utils/image.util');
  const master = await optimizeMenuPhoto(await photoFixture(), 'image/png');
  const service = await imageService(t, master.buffer);
  const full = await service.publicImage('menu_images/master.webp', 768, 'photo');
  assert.deepEqual(full.buffer, master.buffer);
  assert.equal((await sharp(full.buffer).metadata()).width, 512, 'do not upscale the master');
  const thumbnail = await service.publicImage('menu_images/master.webp', 256, 'photo');
  assert.equal((await sharp(thumbnail.buffer).metadata()).width, 256);
  assert.ok(thumbnail.buffer.length < full.buffer.length);
});

test('photo and lossless share the existing three-worker, 32-pending cold conversion limit', async (t) => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const original = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#dea244' },
  })
    .png()
    .toBuffer();
  const service = await imageService(t, original, () => gate);
  let blocked;
  const firstBlocked = new Promise((resolve) => {
    blocked = resolve;
  });
  const jobs = Array.from({ length: 33 }, (_, index) =>
    service
      .publicImage(`menu_images/cold${index}.png`, 256, index % 2 ? 'photo' : 'lossless')
      .catch((error) => {
        blocked(error);
        throw error;
      }),
  );
  const completed = Promise.allSettled(jobs);
  const timeout = setTimeout(
    () => blocked(new Error('Cold image queue did not reach its bound')),
    3000,
  );
  try {
    assert.equal((await firstBlocked).statusCode, 503);
    assert.equal(service.requests(), 3, 'only three upstream downloads can run');
  } finally {
    clearTimeout(timeout);
    release();
    await completed;
  }
  const results = await completed;
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 32);
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1);
  assert.equal(service.requests(), 32);
});

const get = (url, headers = {}) =>
  new Promise((resolve, reject) => {
    http
      .get(url, { headers }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () =>
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }),
        );
        res.on('error', reject);
      })
      .on('error', reject);
  });

test('public image HTTP mode is validated and conditional requests cannot reuse another mode', async (t) => {
  const service = await imageService(t, await photoFixture());
  const routePath = require.resolve('../src/routes/public/image.routes');
  const oldRoute = require.cache[routePath];
  delete require.cache[routePath];
  t.after(() => {
    if (oldRoute) require.cache[routePath] = oldRoute;
    else delete require.cache[routePath];
  });
  const app = express();
  require(routePath).registerPublicImageRoutes(app);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/api/public/image?path=menu_images/photo.png&edge=256`;
  for (const query of [
    '&mode=',
    '&mode=invalid',
    '&mode=PHOTO',
    '&mode=photo&mode=lossless',
    '&mode[x]=photo',
  ]) {
    const invalid = await get(url + query);
    assert.equal(invalid.status, 400, query);
    assert.equal(JSON.parse(invalid.body).code, 'VALIDATION_ERROR');
  }
  assert.equal(service.requests(), 0);
  const lossless = await get(url);
  const photo = await get(url + '&mode=photo', { 'If-None-Match': lossless.headers.etag });
  assert.equal(lossless.status, 200);
  assert.equal(photo.status, 200, 'a lossless ETag cannot suppress the photo response');
  assert.notEqual(lossless.headers.etag, photo.headers.etag);
  assert.match(photo.headers['content-type'], /^image\/webp/);
  assert.equal(
    photo.headers['cache-control'],
    'public, max-age=86400, stale-while-revalidate=604800',
  );
  const cached = await get(url + '&mode=photo', { 'If-None-Match': photo.headers.etag });
  assert.equal(cached.status, 304);
  assert.equal(cached.body.length, 0);
  assert.equal(service.requests(), 2);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test('image variants are lossless, bounded, coalesced and cached; paths cannot escape public bucket', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-image-test-'));
  const previousDir = process.env.PUBLIC_IMAGE_CACHE_DIR;
  const previousUrl = process.env.SUPABASE_URL;
  process.env.PUBLIC_IMAGE_CACHE_DIR = directory;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const fetchPath = require.resolve('node-fetch');
  const oldFetch = require.cache[fetchPath];
  const original = await sharp({
    create: { width: 900, height: 600, channels: 3, background: '#df9832' },
  })
    .png()
    .toBuffer();
  let requests = 0;
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: async () => {
      requests++;
      return { ok: true, buffer: async () => original };
    },
  };
  const servicePath = require.resolve('../src/services/public-image.service');
  delete require.cache[servicePath];
  const { publicImage, sourceUrl } = require(servicePath);
  t.after(async () => {
    if (oldFetch) require.cache[fetchPath] = oldFetch;
    else delete require.cache[fetchPath];
    delete require.cache[servicePath];
    if (previousDir === undefined) delete process.env.PUBLIC_IMAGE_CACHE_DIR;
    else process.env.PUBLIC_IMAGE_CACHE_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    await fs.rm(directory, { recursive: true, force: true });
  });
  for (const bad of [
    '../private/file',
    'menu_images/../secret',
    'menu_images/%2e%2e/file',
    'https://evil.test/image',
    'private/file',
  ]) {
    assert.throws(() => sourceUrl(bad));
  }
  await assert.rejects(publicImage('menu_images/a.png', 999));
  const variants = await Promise.all([
    publicImage('menu_images/a.png', 512),
    publicImage('menu_images/a.png', 512),
  ]);
  assert.equal(requests, 1);
  const cached = await publicImage('menu_images/a.png', 512);
  assert.equal(requests, 1);
  assert.deepEqual(cached.buffer, variants[0].buffer);
  const expected = await sharp(original)
    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer();
  assert.deepEqual(await sharp(cached.buffer).removeAlpha().raw().toBuffer(), expected);
  const metadata = await sharp(cached.buffer).metadata();
  assert.equal(metadata.width, 512);
  assert.equal(metadata.height, 341);
  const banner = await publicImage('stories/admin/banner.png', 768);
  assert.equal((await sharp(banner.buffer).metadata()).width, 768);
  assert.throws(() => sourceUrl('stories/../../private/file'));
});

test('a smaller original WebP never bypasses the requested image dimensions or reuses old unbounded cache', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-webp-test-'));
  const previousDir = process.env.PUBLIC_IMAGE_CACHE_DIR;
  const previousUrl = process.env.SUPABASE_URL;
  process.env.PUBLIC_IMAGE_CACHE_DIR = directory;
  process.env.SUPABASE_URL = 'https://project.supabase.co';
  const width = 1024;
  const height = 768;
  const raw = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      raw[i] = 128 + 120 * Math.sin(x / 27 + y / 51);
      raw[i + 1] = 128 + 120 * Math.cos(x / 61 - y / 39);
      raw[i + 2] = 128 + 120 * Math.sin(x / 93 + y / 29);
    }
  const original = await sharp(raw, { raw: { width, height, channels: 3 } })
    .webp({ quality: 30 })
    .toBuffer();
  const expected = await sharp(original)
    .resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true })
    .webp({ lossless: true, effort: 4 })
    .toBuffer();
  assert.ok(
    original.length < expected.length,
    'fixture must exercise the smaller-original fallback',
  );
  const fetchPath = require.resolve('node-fetch');
  const oldFetch = require.cache[fetchPath];
  let requests = 0;
  require.cache[fetchPath] = {
    id: fetchPath,
    filename: fetchPath,
    loaded: true,
    exports: async () => {
      requests++;
      return { ok: true, buffer: async () => original };
    },
  };
  const servicePath = require.resolve('../src/services/public-image.service');
  delete require.cache[servicePath];
  t.after(async () => {
    if (oldFetch) require.cache[fetchPath] = oldFetch;
    else delete require.cache[fetchPath];
    delete require.cache[servicePath];
    if (previousDir === undefined) delete process.env.PUBLIC_IMAGE_CACHE_DIR;
    else process.env.PUBLIC_IMAGE_CACHE_DIR = previousDir;
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    await fs.rm(directory, { recursive: true, force: true });
  });
  const oldCache = path.join(directory, 'bulka-images-v1');
  await fs.mkdir(oldCache);
  const url = 'https://project.supabase.co/storage/v1/object/public/menu_images/test.webp';
  const key = require('node:crypto')
    .createHash('sha256')
    .update(url + ':256')
    .digest('hex');
  await fs.writeFile(path.join(oldCache, key + '.webp'), original);
  const { publicImage } = require(servicePath);
  const result = await publicImage('menu_images/test.webp', 256);
  assert.equal(requests, 1);
  assert.deepEqual(result.buffer, expected);
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 256);
  assert.equal(metadata.height, 192);
  const cached = await publicImage('menu_images/test.webp', 256);
  assert.deepEqual(cached.buffer, result.buffer);
  assert.equal(requests, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const {
  optimizeMenuPhoto,
  optimizeUploadedImage,
  MAX_IMAGE_EDGE,
} = require('../src/utils/image.util');

async function sourcePhoto(width = 1800, height = 900) {
  const raw = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const offset = (y * width + x) * 4;
      raw[offset] = 128 + 120 * Math.sin(x / 27 + y / 51);
      raw[offset + 1] = 128 + 120 * Math.cos(x / 61 - y / 39);
      raw[offset + 2] = 128 + 120 * Math.sin(x / 93 + y / 29);
      raw[offset + 3] = x < width / 4 ? 0 : x < width / 2 ? 128 : 255;
    }
  return sharp(raw, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
}

test('catalog master is a small bounded WebP with unchanged aspect ratio and resized alpha', async () => {
  const input = await sourcePhoto();
  const result = await optimizeMenuPhoto(input, 'image/png');
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(result.mime, 'image/webp');
  assert.equal(result.extension, 'webp');
  assert.equal(result.encoding, 'webp-photo-v1');
  assert.equal(result.optimized, true);
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, MAX_IMAGE_EDGE);
  assert.equal(metadata.height, 800);
  assert.equal(result.width, metadata.width);
  assert.equal(result.height, metadata.height);
  assert.ok(result.buffer.length < input.length * 0.5);
  const alpha = await sharp(input)
    .resize({ width: 1600, height: 1600, fit: 'inside' })
    .extractChannel('alpha')
    .raw()
    .toBuffer();
  assert.deepEqual(await sharp(result.buffer).extractChannel('alpha').raw().toBuffer(), alpha);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
});

test('menu JPEG is oriented and encoded once at high quality; a clean master is not recompressed on repeat', async () => {
  const input = await sharp(await sourcePhoto(120, 60))
    .jpeg({ quality: 100 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await optimizeMenuPhoto(input, 'image/jpeg');
  const metadata = await sharp(result.buffer).metadata();
  assert.equal(metadata.width, 60);
  assert.equal(metadata.height, 120);
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
  assert.equal(metadata.icc, undefined);
  const direct = await sharp(input)
    .rotate()
    .webp({ quality: 95, alphaQuality: 100, effort: 4 })
    .toBuffer();
  assert.deepEqual(result.buffer, direct, 'no intermediate quality-82 encoding');
  const repeated = await optimizeMenuPhoto(result.buffer, 'image/webp');
  assert.deepEqual(repeated.buffer, result.buffer, 'no additional lossy generation');
  assert.equal(repeated.encoding, 'webp-source');
});

test('lossless WebP photos are compressed, but metadata and trailing data never enter the retain path', async () => {
  const input = await sharp(await sourcePhoto(512, 256))
    .webp({ lossless: true })
    .toBuffer();
  const photo = await optimizeMenuPhoto(input, 'image/webp');
  assert.equal(photo.encoding, 'webp-photo-v1');
  assert.ok(photo.buffer.length < input.length * 0.5);
  const tagged = await sharp(photo.buffer).withMetadata().webp({ quality: 95 }).toBuffer();
  const safe = await optimizeMenuPhoto(tagged, 'image/webp');
  assert.equal(safe.encoding, 'webp-photo-v1');
  assert.equal((await sharp(safe.buffer).metadata()).exif, undefined);
  const appended = await optimizeMenuPhoto(
    Buffer.concat([photo.buffer, Buffer.from('hidden trailing metadata')]),
    'image/webp',
  );
  assert.equal(appended.encoding, 'webp-photo-v1');
  assert.equal(appended.buffer.includes(Buffer.from('hidden trailing metadata')), false);
});

test('invalid MIME, corrupt pixels, animation and excessive dimensions reject before storage', async () => {
  const png = await sourcePhoto(32, 32);
  await assert.rejects(optimizeMenuPhoto(png, 'application/pdf'), { statusCode: 400 });
  await assert.rejects(optimizeMenuPhoto(png, 'image/jpeg'), { statusCode: 413 });
  const huge = Buffer.from(png);
  huge.writeUInt32BE(9000, 16);
  huge.writeUInt32BE(9000, 20);
  let crc = 0xffffffff;
  for (const byte of huge.subarray(12, 29)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  huge.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 29);
  assert.equal((await sharp(huge, { limitInputPixels: false }).metadata()).width, 9000);
  await assert.rejects(optimizeMenuPhoto(huge, 'image/png'), (error) =>
    [400, 413].includes(error.statusCode),
  );
  const frames = Buffer.alloc(64 * 128 * 3, 20);
  frames.fill(240, 64 * 64 * 3);
  const animated = await sharp(frames, {
    raw: { width: 64, height: 128, channels: 3, pageHeight: 64 },
  })
    .webp({ loop: 0 })
    .toBuffer();
  assert.equal((await sharp(animated).metadata()).pages, 2);
  await assert.rejects(optimizeMenuPhoto(animated, 'image/webp'), /Анимированные/);
  const clean = (await optimizeMenuPhoto(png, 'image/png')).buffer;
  const broken = Buffer.from(clean.subarray(0, 24));
  broken.writeUInt32LE(broken.length - 8, 4);
  await assert.rejects(optimizeMenuPhoto(broken, 'image/webp'), { statusCode: 400 });
});

test('non-catalog PNG optimization retains its existing lossless format', async () => {
  const input = await sourcePhoto(128, 64);
  const result = await optimizeUploadedImage(input, 'image/png');
  assert.equal(result.mime, 'image/png');
  assert.equal(result.extension, 'png');
  assert.deepEqual(
    await sharp(result.buffer).raw().toBuffer(),
    await sharp(input).raw().toBuffer(),
  );
});

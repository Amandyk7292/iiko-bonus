const test = require('node:test');
const assert = require('node:assert/strict');
const { Jimp, JimpMime } = require('jimp');
const sharp = require('sharp');
const { MAX_IMAGE_EDGE, optimizeUploadedImage } = require('../src/utils/image.util');

test('large opaque uploads are resized and encoded efficiently', async () => {
  const source = new Jimp({ width: 1800, height: 900, color: 0xd28a45ff });
  source.scan((x, y, index) => {
    source.bitmap.data[index] = (x * 13 + y * 7) % 256;
    source.bitmap.data[index + 1] = (x * 3 + y * 17) % 256;
    source.bitmap.data[index + 2] = (x * 11 + y * 5) % 256;
  });
  const input = await source.getBuffer(JimpMime.png);
  const result = await optimizeUploadedImage(input, JimpMime.png);
  const decoded = await Jimp.read(result.buffer);

  assert.equal(result.optimized, true);
  assert.equal(result.mime, JimpMime.png);
  assert.equal(decoded.bitmap.width, MAX_IMAGE_EDGE);
  assert.equal(decoded.bitmap.height, 800);
  assert.ok(result.buffer.length < input.length);
});

test('transparent uploads retain PNG transparency', async () => {
  const source = new Jimp({ width: 1800, height: 900, color: 0x00000000 });
  source.scan((x, y, index) => {
    if (x < 900) source.bitmap.data.writeUInt32BE(0x532814ff, index);
  });
  const input = await source.getBuffer(JimpMime.png);
  const result = await optimizeUploadedImage(input, JimpMime.png);
  const decoded = await Jimp.read(result.buffer);

  assert.equal(result.mime, JimpMime.png);
  assert.equal(decoded.bitmap.width, MAX_IMAGE_EDGE);
  assert.equal(decoded.hasAlpha(), true);
});

test('WebP uploads are decoded and re-encoded without metadata', async () => {
  const input = await sharp({
    create: { width: 640, height: 320, channels: 4, background: '#532814' },
  })
    .webp({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const result = await optimizeUploadedImage(input, 'image/webp');
  const metadata = await sharp(result.buffer).metadata();

  assert.equal(result.optimized, true);
  assert.equal(result.mime, 'image/webp');
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.orientation, undefined);
  assert.equal(metadata.exif, undefined);
});

test('malformed WebP and MIME confusion are rejected', async () => {
  await assert.rejects(
    () => optimizeUploadedImage(Buffer.from('RIFF0000WEBP', 'ascii'), 'image/webp'),
    /Не удалось прочитать изображение/,
  );
  const jpeg = await sharp({
    create: { width: 32, height: 32, channels: 3, background: '#ffffff' },
  })
    .jpeg()
    .toBuffer();
  await assert.rejects(
    () => optimizeUploadedImage(jpeg, 'image/png'),
    /Некорректный формат/,
  );
});

test('JPEG orientation and embedded metadata are removed', async () => {
  const input = await sharp({
    create: { width: 120, height: 60, channels: 3, background: '#d28a45' },
  })
    .jpeg()
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const sourceMetadata = await sharp(input).metadata();
  assert.equal(sourceMetadata.orientation, 6);

  const result = await optimizeUploadedImage(input, 'image/jpeg');
  const outputMetadata = await sharp(result.buffer).metadata();
  assert.equal(outputMetadata.orientation, undefined);
  assert.equal(outputMetadata.exif, undefined);
  assert.equal(outputMetadata.width, 60);
  assert.equal(outputMetadata.height, 120);
});

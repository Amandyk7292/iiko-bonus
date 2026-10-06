const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const sharp = require('sharp');
const photos = require('../src/services/pickup-photo-gift.service');

const photoHeight = 256;

async function imageOf(pixels, width, height = photoHeight) {
  return sharp(pixels, { raw: { width, height, channels: 1 } })
    .png()
    .toBuffer();
}

async function stripOf(pixels, width, height = photoHeight) {
  const image = await imageOf(pixels, width, height);
  const buffer = await photos.renderStrip(image, 123456, width);
  const { data, info } = await sharp(buffer)
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const headerHeight = info.height - height - 16;
  assert.ok(headerHeight > 0);
  return {
    buffer,
    data,
    info,
    header: data.subarray(0, width * headerHeight),
    photo: data.subarray(width * headerHeight, width * (headerHeight + height)),
  };
}

function ink(
  pixels,
  width,
  { left = 0, top = 0, right = width, bottom = pixels.length / width } = {},
) {
  let black = 0;
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) if (pixels[y * width + x] === 0) black++;
  }
  return black / ((right - left) * (bottom - top));
}

function assertRaster(strip, width) {
  assert.equal(strip.info.width, width);
  assert.equal(strip.info.channels, 1);
  assert.ok(strip.info.height <= 1200);
  assert.ok(strip.buffer.length <= 500 * 1024);
  assert.ok(strip.data.every((pixel) => pixel === 0 || pixel === 255));
}

test('photo tone lift preserves white and luminance ordering without darkening any gray', () => {
  const ramp = Buffer.from(Array.from({ length: 4096 }, (_, index) => index % 256));
  const original = Buffer.from(ramp);
  const lifted = photos.liftPhotoGrey(ramp);
  assert.deepEqual(ramp, original, 'photo source remains unchanged');
  assert.equal(lifted.length, ramp.length);
  for (let gray = 0; gray < 256; gray++) {
    assert.ok(lifted[gray] >= gray, `gray ${gray} does not get darker`);
    if (gray) assert.ok(lifted[gray] >= lifted[gray - 1], 'tone order remains monotonic');
  }
  assert.equal(lifted[255], 255, 'pure white stays exactly white');
  assert.ok(lifted[48] < lifted[96] && lifted[96] < lifted[160], 'shadow details stay distinct');
});

test('photo tone adapts to dark exposure while keeping a bounded correction for bright photos', () => {
  const dark = Buffer.alloc(4096, 24),
    bright = Buffer.alloc(4096, 224);
  dark[0] = bright[0] = 96;
  const darkLift = photos.liftPhotoGrey(dark),
    brightLift = photos.liftPhotoGrey(bright);
  assert.ok(darkLift[0] > brightLift[0] + 5, 'the same shadow gets more lift in a dark photo');
  assert.ok(brightLift[0] > 96, 'backlit shadows still receive a correction');
  assert.ok(brightLift[1] > 224 && brightLift[1] < 255, 'bright tones retain highlight detail');
});

test('photo black intentionally becomes bounded ink and pure white prints with no ink', () => {
  const width = 384,
    height = 256;
  const black = photos.ditherGrey(
    photos.liftPhotoGrey(Buffer.alloc(width * height)),
    width,
    height,
  );
  const white = photos.ditherGrey(
    photos.liftPhotoGrey(Buffer.alloc(width * height, 255)),
    width,
    height,
  );
  assert.ok(ink(black, width) > 0.7, 'black remains recognizable as a dark tone');
  assert.ok(ink(black, width) < 0.84, 'the photo cannot turn into a solid black block');
  assert.equal(ink(white, width), 0);
});

for (const width of [384, 576]) {
  test(`dark photo regions use substantially less ink and retain their ordering at ${width} dots`, async () => {
    const pixels = Buffer.alloc(width * photoHeight);
    for (const [index, gray] of [24, 72, 128, 196].entries()) {
      pixels.fill(gray, width * index * 64, width * (index + 1) * 64);
    }
    const baseline = photos.ditherGrey(pixels, width, photoHeight);
    const strip = await stripOf(pixels, width);
    assertRaster(strip, width);
    const densities = [];
    for (let index = 0; index < 4; index++) {
      const region = {
        top: index * 64 + 8,
        bottom: (index + 1) * 64 - 8,
        left: 8,
        right: width - 8,
      };
      const before = ink(baseline, width, region),
        after = ink(strip.photo, width, region);
      densities.push(after);
      assert.ok(
        before - after > (index < 2 ? 0.2 : 0.08),
        `region ${index} uses substantially less ink`,
      );
    }
    for (let index = 1; index < densities.length; index++) {
      assert.ok(
        densities[index - 1] > densities[index] + 0.05,
        'dark and midtone regions remain distinguishable',
      );
    }
  });

  test(`backlit photo shadows receive lift while the white background stays white at ${width} dots`, async () => {
    const pixels = Buffer.alloc(width * photoHeight, 255),
      regionWidth = Math.floor(width / 5);
    for (let y = 0; y < photoHeight; y++) {
      pixels.fill(48, y * width, y * width + regionWidth);
      pixels.fill(104, y * width + regionWidth, y * width + 2 * regionWidth);
    }
    const baseline = photos.ditherGrey(pixels, width, photoHeight);
    const strip = await stripOf(pixels, width);
    assertRaster(strip, width);
    const densities = [];
    for (let index = 0; index < 2; index++) {
      const region = {
        left: index * regionWidth + 8,
        right: (index + 1) * regionWidth - 8,
        top: 8,
        bottom: photoHeight - 8,
      };
      densities.push(ink(strip.photo, width, region));
      assert.ok(
        ink(baseline, width, region) - densities[index] > 0.15,
        'backlit shadow is visibly lighter',
      );
    }
    assert.ok(densities[0] > densities[1] + 0.1, 'shadow details retain their relative darkness');
    assert.equal(ink(strip.photo, width, { left: 2 * regionWidth + 8, right: width - 8 }), 0);
  });

  test(`photo exposure leaves logo and order header bytes unchanged at ${width} dots`, async () => {
    let header;
    for (const gray of [0, 96, 192, 255]) {
      const strip = await stripOf(Buffer.alloc(width * photoHeight, gray), width);
      assertRaster(strip, width);
      if (header)
        assert.deepEqual(
          strip.header,
          header,
          'photo correction never touches branding or order text',
        );
      else header = Buffer.from(strip.header);
      assert.ok(strip.header.includes(0), 'logo and order header retain black ink');
      if (gray === 255) assert.equal(ink(strip.photo, width), 0);
    }
  });

  test(`maximum normalized photo remains a binary bounded strip at ${width} dots`, async () => {
    const sourceWidth = 576,
      sourceHeight = 1000,
      pixels = Buffer.alloc(sourceWidth * sourceHeight);
    for (let y = 0; y < sourceHeight; y++)
      pixels.fill(y % 256, y * sourceWidth, (y + 1) * sourceWidth);
    const buffer = await photos.renderStrip(
      await imageOf(pixels, sourceWidth, sourceHeight),
      123456,
      width,
    );
    const { data, info } = await sharp(buffer)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assertRaster({ buffer, data, info }, width);
    assert.equal((await sharp(buffer).metadata()).hasAlpha, false, 'native raster stays opaque');
  });
}

function stub(t, path, exports) {
  const id = require.resolve(path),
    previous = require.cache[id];
  require.cache[id] = { id, filename: id, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[id] = previous;
    else delete require.cache[id];
  });
}

test('photo endpoint renders current source on demand and hashes the exact binary response', async (t) => {
  const branchId = crypto.randomUUID(),
    terminalId = crypto.randomUUID(),
    orderId = crypto.randomUUID();
  let image = await imageOf(Buffer.alloc(384 * photoHeight, 72), 384),
    calls = 0;
  const db = {
    rpc: async (name, payload) => {
      assert.equal(name, 'pickup_photo_print_image');
      assert.deepEqual(payload, { p_branch: branchId, p_terminal: terminalId, p_order: orderId });
      calls++;
      return { data: { image: image.toString('base64'), number: 123456 } };
    },
  };
  stub(t, '../src/middlewares/rate-limit.middleware', {
    webhookRateLimit: (_req, _res, next) => next(),
  });
  stub(t, '../src/middlewares/pos-transport.middleware', {
    posTransportMiddleware: (req, _res, next) => {
      req.pairedPos = { terminal_id: terminalId, branch_id: branchId };
      next();
    },
  });
  stub(t, '../src/middlewares/branch-pos-auth.middleware', {
    branchPosAuthMiddleware: (req, _res, next) => {
      req.posBranchId = branchId;
      next();
    },
  });
  stub(t, '../src/services/pickup-photo-gift.service', {
    ...photos,
    printImage: (...args) => photos.printImage(...args, db),
  });
  const routeId = require.resolve('../src/routes/pickup-photo-gift.routes'),
    previousRoute = require.cache[routeId];
  delete require.cache[routeId];
  t.after(() => {
    if (previousRoute) require.cache[routeId] = previousRoute;
    else delete require.cache[routeId];
  });
  const app = express();
  app.use(require('../src/routes/pickup-photo-gift.routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/api/loyalty/orders/photo-gifts/${orderId}/image?terminalId=${terminalId}&widthDots=384`;
  const hashes = [];
  for (let request = 0; request < 3; request++) {
    if (request === 2) image = await imageOf(Buffer.alloc(384 * photoHeight, 192), 384);
    const response = await fetch(url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('cache-control'), /private.*no-store/);
    assert.match(response.headers.get('content-type'), /^image\/png/);
    const body = Buffer.from(await response.arrayBuffer()),
      hash = crypto.createHash('sha256').update(body).digest('hex');
    assert.equal(response.headers.get('x-content-sha256'), hash);
    assert.equal(response.headers.get('etag'), `"${hash}"`);
    assert.deepEqual(body, await photos.renderStrip(image, 123456, 384));
    hashes.push(hash);
  }
  assert.equal(calls, 3, 'every request renders from the current source instead of a raster cache');
  assert.equal(hashes[0], hashes[1], 'the same source produces deterministic output');
  assert.notEqual(hashes[1], hashes[2], 'a changed source receives a new response hash');
});

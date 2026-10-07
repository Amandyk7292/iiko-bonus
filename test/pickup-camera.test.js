const assert = require('node:assert/strict');
const http = require('node:http');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const test = require('node:test');
const { JSDOM } = createRequire(path.resolve('admin-ui/package.json'))('jsdom');
const script = readFileSync('public/pickup-camera-v1.js', 'utf8');
const nonce = '0123456789abcdef0123456789abcdef';
const flush = async () => {
  for (let i = 0; i < 50; i++) await Promise.resolve();
};

function camera(t, { hash = `#nonce=${nonce}`, acquire } = {}) {
  const dom = new JSDOM(readFileSync('public/pickup-camera-v1.html', 'utf8'), {
    url: `https://bulka.com.kz/pickup/camera-v1${hash}`,
    pretendToBeVisual: true,
    runScripts: 'outside-only',
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const messages = [],
    streams = [],
    requests = [],
    transforms = [];
  w.BulkaPickupCamera = { postMessage: (value) => messages.push(JSON.parse(value)) };
  Object.defineProperty(w, 'isSecureContext', { value: true });
  Object.defineProperty(w.navigator, 'mediaDevices', {
    value: {
      getSupportedConstraints: () => ({ facingMode: true }),
      getUserMedia: async (constraints) => {
        requests.push(constraints);
        if (acquire) return acquire(constraints);
        const track = new w.EventTarget();
        track.readyState = 'live';
        track.getSettings = () => ({ facingMode: constraints.video.facingMode.exact });
        track.stops = 0;
        track.stop = () => {
          track.stops++;
          track.readyState = 'ended';
        };
        const stream = { getTracks: () => [track], getVideoTracks: () => [track], track };
        streams.push(stream);
        return stream;
      },
    },
  });
  w.HTMLMediaElement.prototype.play = async () => {};
  const video = w.document.getElementById('camera');
  Object.defineProperties(video, {
    videoWidth: { value: 1920, configurable: true },
    videoHeight: { value: 1080, configurable: true },
    readyState: { value: 3 },
  });
  w.HTMLCanvasElement.prototype.getContext = () => ({
    translate: (...args) => transforms.push(['translate', ...args]),
    scale: (...args) => transforms.push(['scale', ...args]),
    drawImage: (_video, ...args) => transforms.push(['draw', ...args]),
  });
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,/9j/2Q==';
  w.eval(script);
  return { w, video, messages, streams, requests, transforms, api: w.BulkaPickupCameraControls };
}

test('camera routes have isolated permissions, no cache and no networking policy', async (t) => {
  const app = require('../src/app');
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [url, file, type] of [
    ['/pickup/camera-v1', 'pickup-camera-v1.html', /text\/html/],
    ['/assets/pickup-camera-v1.js', 'pickup-camera-v1.js', /javascript/],
    ['/assets/pickup-camera-v1.css', 'pickup-camera-v1.css', /text\/css/],
  ]) {
    const response = await fetch(origin + url);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), type);
    assert.equal(response.headers.get('cache-control'), 'private, no-store');
    assert.equal(
      response.headers.get('permissions-policy'),
      'camera=(self), microphone=(), geolocation=()',
    );
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(response.headers.get('cross-origin-embedder-policy'), null);
    assert.match(response.headers.get('content-security-policy'), /connect-src 'none'/);
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.doesNotMatch(response.headers.get('content-security-policy'), /unsafe-/);
    assert.equal(await response.text(), readFileSync(path.join('public', file), 'utf8'));
  }
});

test('front and rear stay tied to verified actual lens, stop on switch and return only one bounded JPEG', async (t) => {
  const c = camera(t);
  await flush();
  assert.equal(c.video.classList.contains('front'), true);
  assert.equal(c.messages.at(-1).type, 'ready');
  assert.equal(c.requests[0].audio, false);
  await c.api.switchCamera();
  await flush();
  assert.equal(c.streams[0].track.stops, 1);
  assert.equal(c.video.classList.contains('front'), false);
  assert.equal(c.messages.at(-1).facingMode, 'environment');
  await c.api.switchCamera();
  await flush();
  c.api.capture();
  c.api.capture();
  const photos = c.messages.filter((m) => m.type === 'photo');
  assert.equal(photos.length, 1);
  assert.deepEqual(photos[0], {
    v: 1,
    nonce,
    type: 'photo',
    facingMode: 'user',
    width: 810,
    height: 1080,
    mimeType: 'image/jpeg',
    base64: '/9j/2Q==',
  });
  assert.deepEqual(c.transforms, [
    ['translate', 810, 0],
    ['scale', -1, 1],
    ['draw', 555, 0, 810, 1080, 0, 0, 810, 1080],
  ]);
  assert.equal(
    c.streams.every((s) => s.track.stops === 1),
    true,
  );
  assert.equal(c.video.srcObject, null);
});

test('rear capture leaves its pixels plain', async (t) => {
  const c = camera(t);
  await flush();
  await c.api.switchCamera();
  c.api.capture();
  assert.deepEqual(c.transforms, [['draw', 555, 0, 810, 1080, 0, 0, 810, 1080]]);
  assert.equal(c.messages.at(-1).facingMode, 'environment');
});

test('close while permission is pending stops the late stream and never emits a photo', async (t) => {
  let resolve;
  let stops = 0;
  const c = camera(t, {
    acquire: () =>
      new Promise((done) => {
        resolve = done;
      }),
  });
  c.api.stop();
  resolve({ getTracks: () => [{ stop: () => stops++ }] });
  await flush();
  assert.equal(stops, 1);
  assert.deepEqual(
    c.messages.map((m) => m.type),
    ['busy', 'cancel'],
  );
  c.api.capture();
  assert.equal(c.messages.length, 2);
});

for (const facingMode of [undefined, 'environment']) {
  test(`unknown or wrong actual lens fails closed (${facingMode})`, async (t) => {
    let stops = 0;
    const track = { readyState: 'live', getSettings: () => ({ facingMode }), stop: () => stops++ };
    const c = camera(t, {
      acquire: async () => ({ getTracks: () => [track], getVideoTracks: () => [track] }),
    });
    await flush();
    assert.equal(c.messages.at(-1).type, 'error');
    assert.equal(c.messages.at(-1).code, 'lens');
    assert.equal(stops, 1);
    c.api.capture();
    assert.equal(
      c.messages.some((m) => m.type === 'photo'),
      false,
    );
  });
}

test('track failure before shutter cannot create a stale capture', async (t) => {
  const c = camera(t);
  await flush();
  c.streams[0].track.dispatchEvent(new c.w.Event('ended'));
  c.api.capture();
  assert.equal(c.messages.at(-1).code, 'unavailable');
  assert.equal(c.transforms.length, 0);
});

test('a source frame above the shared 16 megapixel limit is rejected before allocation', async (t) => {
  const c = camera(t);
  await flush();
  Object.defineProperties(c.video, {
    videoWidth: { value: 4001 },
    videoHeight: { value: 4000 },
  });
  c.api.capture();
  assert.equal(c.messages.at(-1).code, 'capture');
  assert.equal(
    c.messages.some((m) => m.type === 'photo'),
    false,
  );
  assert.equal(c.transforms.length, 0);
  assert.equal(c.streams[0].track.stops, 1);
});

test('the shared 16 megapixel boundary can still be downsampled and captured', async (t) => {
  const c = camera(t);
  await flush();
  Object.defineProperties(c.video, {
    videoWidth: { value: 4000 },
    videoHeight: { value: 4000 },
  });
  c.api.capture();
  assert.equal(c.messages.at(-1).type, 'photo');
  assert.equal(c.messages.at(-1).width, 1200);
  assert.equal(c.messages.at(-1).height, 1600);
});

for (const [width, height, outputWidth, outputHeight, cropTop] of [
  [1200, 1600, 1200, 1600, 0],
  [1600, 2400, 1200, 1600, (2400 - (1600 * 4) / 3) / 2],
]) {
  test(`portrait ${width}x${height} source keeps an upright bounded 3:4 frame`, async (t) => {
    const c = camera(t);
    await flush();
    Object.defineProperties(c.video, {
      videoWidth: { value: width },
      videoHeight: { value: height },
    });
    c.api.capture();
    const photo = c.messages.at(-1);
    assert.equal(photo.type, 'photo');
    assert.equal(photo.width, outputWidth);
    assert.equal(photo.height, outputHeight);
    assert.deepEqual(c.transforms, [
      ['translate', outputWidth, 0],
      ['scale', -1, 1],
      ['draw', 0, cropTop, width, (width * 4) / 3, 0, 0, outputWidth, outputHeight],
    ]);
    assert.equal(c.requests[0].video.aspectRatio.ideal, 3 / 4);
  });
}

test('background and pagehide cancel once and release the camera', async (t) => {
  const c = camera(t);
  await flush();
  Object.defineProperty(c.w.document, 'hidden', { value: true });
  c.w.document.dispatchEvent(new c.w.Event('visibilitychange'));
  c.w.dispatchEvent(new c.w.Event('pagehide'));
  c.api.capture();
  assert.equal(c.messages.filter((m) => m.type === 'cancel').length, 1);
  assert.equal(c.streams[0].track.stops, 1);
  assert.equal(
    c.messages.some((m) => m.type === 'photo'),
    false,
  );
});

test('no app session nonce means no camera request or bridge controls', async (t) => {
  const c = camera(t, { hash: '' });
  await flush();
  assert.equal(c.api, undefined);
  assert.equal(c.requests.length, 0);
});

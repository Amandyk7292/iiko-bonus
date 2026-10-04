const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = createRequire(path.resolve('admin-ui/package.json'))('jsdom');
const flush = async () => {
  for (let i = 0; i < 32; i++) await Promise.resolve();
};

test('tablet captures only live camera frames, caps at ten and retains the batch for safe retries', async (t) => {
  const dom = new JSDOM(readFileSync('public/branch-reports/index.html', 'utf8'), {
    url: 'https://bulka.com.kz/branch-reports#t=fixture',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window,
    document = w.document;
  let stops = 0,
    failed = false;
  const uploads = [];
  Object.defineProperty(w.navigator, 'mediaDevices', {
    value: {
      getUserMedia: async (options) => {
        assert.equal(options.audio, false);
        assert.equal(options.video.facingMode.ideal, 'environment');
        return { getTracks: () => [{ stop: () => stops++ }] };
      },
    },
  });
  w.HTMLMediaElement.prototype.play = async () => {};
  Object.defineProperties(document.getElementById('camera'), {
    videoWidth: { value: 1600 },
    videoHeight: { value: 1200 },
    readyState: { value: 3 },
  });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage: () => {} });
  w.HTMLCanvasElement.prototype.toBlob = function (callback, type) {
    assert.equal(type, 'image/jpeg');
    callback(new w.Blob(['camera-frame'], { type }));
  };
  w.URL.createObjectURL = () => 'blob:fixture';
  w.URL.revokeObjectURL = () => {};
  w.fetch = async (url, options) => {
    assert.equal(options.credentials, 'same-origin', 'device cookies accompany every request');
    if (url.endsWith('/device'))
      return {
        ok: true,
        json: async () => ({
          success: true,
          branch: { name: '19А', city: 'Актау' },
          device: { status: 'active' },
        }),
      };
    if (url.endsWith('/session'))
      return {
        ok: true,
        json: async () => ({
          branch: { name: '19А', city: 'Актау' },
          date: '2026-10-01',
          sessionToken: 'fixture-session',
          reports: [],
        }),
      };
    uploads.push(options.body);
    if (!failed) {
      failed = true;
      return { ok: false, status: 500, json: async () => ({ error: 'Связь прервалась' }) };
    }
    return { ok: true, json: async () => ({ submitted: true }) };
  };
  w.eval(readFileSync('public/branch-reports/report.js', 'utf8'));
  await flush();
  assert.equal(w.location.hash, '', 'the QR capability must leave the address bar');
  assert.equal(document.querySelector('input[type=file]'), null, 'no gallery picker exists');
  document.querySelector('[data-kind=hall]').click();
  await flush();
  assert.equal(document.getElementById('take-photo').hidden, false);
  for (let i = 0; i < 11; i++) {
    document.getElementById('take-photo').click();
    await flush();
  }
  assert.equal(document.querySelectorAll('.preview').length, 10);
  assert.equal(document.getElementById('take-photo').disabled, true);
  document.getElementById('send').click();
  await flush();
  assert.equal(document.querySelectorAll('.preview').length, 10, 'failure retains camera frames');
  assert.equal(document.getElementById('error').textContent, 'Связь прервалась');
  document.getElementById('send').click();
  await flush();
  assert.equal(uploads.length, 2);
  assert.equal(uploads[0].get('uploadId'), uploads[1].get('uploadId'), 'same upload ID on retry');
  assert.equal(uploads[1].getAll('photos').length, 10);
  assert.equal(uploads[1].get('kind'), 'hall');
  assert.equal(document.getElementById('success').hidden, false);
  assert.equal(document.querySelectorAll('.preview').length, 0);
  assert.ok(stops >= 1, 'camera is stopped when sending');
});

test('camera permission failure provides recovery without exposing a gallery fallback', async (t) => {
  const dom = new JSDOM(readFileSync('public/branch-reports/index.html', 'utf8'), {
    url: 'https://bulka.com.kz/branch-reports#t=fixture',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  Object.defineProperty(w.navigator, 'mediaDevices', {
    value: {
      getUserMedia: async () => {
        throw Object.assign(new Error('Denied'), { name: 'NotAllowedError' });
      },
    },
  });
  w.fetch = async (url) =>
    url.endsWith('/device')
      ? {
          ok: true,
          json: async () => ({
            success: true,
            branch: { name: 'Точка', city: 'Актау' },
            device: { status: 'active' },
          }),
        }
      : {
          ok: true,
          json: async () => ({
            branch: { name: 'Точка', city: 'Актау' },
            date: '2026-10-01',
            reports: [],
          }),
        };
  w.eval(readFileSync('public/branch-reports/report.js', 'utf8'));
  await flush();
  w.document.querySelector('[data-kind=baker]').click();
  await flush();
  assert.match(w.document.getElementById('error').textContent, /Разрешите камеру/);
  assert.equal(w.document.getElementById('enable-camera').disabled, false);
  assert.equal(w.document.querySelector('input[type=file]'), null);
});

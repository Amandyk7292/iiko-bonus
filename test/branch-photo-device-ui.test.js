const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { JSDOM } = createRequire(path.resolve('admin-ui/package.json'))('jsdom');
const html = readFileSync('public/branch-reports/index.html', 'utf8');
const script = readFileSync('public/branch-reports/report.js', 'utf8');
const branch = { id: 'branch-a', name: '19А', city: 'Актау' };
const flush = async () => {
  for (let index = 0; index < 40; index++) await Promise.resolve();
};
const response = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const status = (state, extra = {}) => ({
  success: true,
  branch,
  device: { status: state },
  ...extra,
});
const session = (number = 1) => ({
  branch,
  date: '2026-10-04',
  shift: 'daily',
  reports: [],
  sessionToken: 'session-' + number,
});

function page(t, reply) {
  const dom = new JSDOM(html, {
    url: 'https://bulka.com.kz/branch-reports#t=branch-qr',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  const calls = [];
  const timers = new Map();
  let nextTimer = 1;
  let hidden = false;
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => hidden });
  w.setTimeout = (callback, delay) => {
    const id = nextTimer++;
    timers.set(id, { callback, delay });
    return id;
  };
  w.clearTimeout = (id) => timers.delete(id);
  w.fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.credentials, 'same-origin');
    return reply(url, options, calls);
  };
  const ui = {
    w,
    calls,
    get: (id) => w.document.getElementById(id),
    polls: () => [...timers.values()].filter((timer) => timer.delay === 5000).length,
    async poll() {
      const found = [...timers].find(([, timer]) => timer.delay === 5000);
      assert.ok(found, 'a pending poll is scheduled');
      timers.delete(found[0]);
      found[1].callback();
      await flush();
    },
    visibility(value) {
      hidden = value;
      w.document.dispatchEvent(new w.Event('visibilitychange'));
    },
    start() {
      w.eval(script);
    },
  };
  return ui;
}

function camera(ui, deferredBlob) {
  let stops = 0;
  let revoked = 0;
  let created = 0;
  const w = ui.w;
  Object.defineProperty(w.navigator, 'mediaDevices', {
    value: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stops++ }] }) },
  });
  w.HTMLMediaElement.prototype.play = async () => {};
  Object.defineProperties(ui.get('camera'), {
    videoWidth: { value: 1600 },
    videoHeight: { value: 1200 },
    readyState: { value: 3 },
  });
  w.HTMLCanvasElement.prototype.getContext = () => ({ drawImage() {} });
  w.HTMLCanvasElement.prototype.toBlob = (callback, type) => {
    if (deferredBlob) deferredBlob(callback);
    else callback(new w.Blob(['live-camera'], { type }));
  };
  w.URL.createObjectURL = () => 'blob:frame-' + ++created;
  w.URL.revokeObjectURL = () => revoked++;
  return { stops: () => stops, revoked: () => revoked, created: () => created };
}

test('a copied QR never authorizes a non-active tablet or silently enrolls it', async (t) => {
  for (const state of ['unregistered', 'pending', 'revoked', 'expired', 'wrong_branch']) {
    const ui = page(t, async (url, options) => {
      assert.equal(url, '/api/branch-reports/device');
      assert.equal(options.method, 'GET');
      assert.equal(options.headers['X-Bulka-Report-Token'], 'branch-qr');
      return response(status(state, state === 'pending' ? { pairingCode: '012345' } : {}));
    });
    ui.start();
    await flush();
    assert.equal(ui.get('device').hidden, false, state);
    assert.equal(ui.get('intro').hidden, true, state);
    assert.equal(ui.get('device-branch').textContent, branch.name);
    assert.equal(ui.w.location.hash, '', 'QR leaves address bar');
    ui.w.document.querySelector('[data-kind=hall]').click();
    ui.get('send').dispatchEvent(new ui.w.Event('click'));
    ui.get('next-report').click();
    await flush();
    assert.equal(ui.calls.length, 1, 'non-active controls cannot create a session or upload');
    assert.equal(ui.w.localStorage.length, 0);
    assert.equal(ui.w.sessionStorage.length, 1);
    assert.equal(ui.w.sessionStorage.key(0), 'bulka-closing-qr', 'only branch QR is stored');
    if (state === 'wrong_branch') {
      assert.equal(ui.get('enroll-device').hidden, true);
      ui.get('enroll-device').dispatchEvent(new ui.w.Event('click'));
      await flush();
      assert.equal(
        ui.calls.length,
        1,
        'wrong-branch cookie cannot be rebound by the connect button',
      );
    }
  }
});

test('explicit enrollment displays the code and approval automatically opens a cookie-bound session', async (t) => {
  let enrolled = false;
  let approved = false;
  const ui = page(t, async (url, options) => {
    if (url.endsWith('/session')) {
      assert.equal(approved, true);
      assert.equal(options.method, 'POST');
      return response(session());
    }
    assert.equal(options.headers['X-Bulka-Report-Token'], 'branch-qr');
    if (options.method === 'POST') {
      enrolled = true;
      assert.equal(options.body, '{}', 'no device secret or identity is sent by JavaScript');
    }
    return response(
      status(approved ? 'active' : enrolled ? 'pending' : 'unregistered', {
        pairingCode: enrolled && !approved ? '012345' : undefined,
        expiresAt: '2030-10-04T12:05:00Z',
      }),
    );
  });
  ui.start();
  await flush();
  assert.equal(enrolled, false);
  ui.get('enroll-device').click();
  ui.get('enroll-device').dispatchEvent(new ui.w.Event('click'));
  await flush();
  assert.equal(
    ui.calls.filter(({ options }) => options.method === 'POST').length,
    1,
    'double enrollment is blocked',
  );
  assert.equal(ui.get('pairing-code').textContent, '012345');
  assert.match(ui.get('pairing-expiry').textContent, /Действует до/);
  assert.equal(ui.get('pairing').hidden, false);
  assert.equal(ui.get('enroll-device').hidden, true, 'a pending code stays valid until it expires');
  assert.equal(ui.polls(), 1);
  approved = true;
  await ui.poll();
  assert.equal(ui.get('intro').hidden, false);
  assert.equal(ui.get('device').hidden, true);
  assert.equal(ui.polls(), 0);
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/session')).length, 1);
});

test('pending polling stops while hidden, after pagehide, and on network failure until manual retry', async (t) => {
  let offline = false;
  const ui = page(t, async () => {
    if (offline) throw new TypeError('Failed to fetch');
    return response(status('pending', { pairingCode: '123456' }));
  });
  ui.start();
  await flush();
  assert.equal(ui.polls(), 1);
  ui.visibility(true);
  assert.equal(ui.polls(), 0);
  assert.equal(ui.calls.length, 1);
  ui.visibility(false);
  await flush();
  assert.equal(ui.calls.length, 2);
  offline = true;
  await ui.poll();
  assert.equal(ui.polls(), 0);
  assert.match(ui.get('error').textContent, /Нет связи/);
  ui.visibility(true);
  ui.visibility(false);
  await flush();
  assert.equal(ui.calls.length, 3, 'network failure does not restart automatic polling');
  offline = false;
  ui.get('check-device').click();
  await flush();
  assert.equal(ui.calls.length, 4);
  assert.equal(ui.polls(), 1);
  ui.w.dispatchEvent(new ui.w.Event('pagehide'));
  assert.equal(ui.polls(), 0);
  ui.get('check-device').dispatchEvent(new ui.w.Event('click'));
  await flush();
  assert.equal(ui.calls.length, 4);
});

test('an aborted stale approval cannot open reports over a newer pending response', async (t) => {
  let completeFirst;
  let count = 0;
  const ui = page(t, async (url) => {
    assert.equal(url, '/api/branch-reports/device');
    if (++count === 1)
      return new Promise((resolve) => {
        completeFirst = resolve;
      });
    return response(status('pending', { pairingCode: '654321' }));
  });
  ui.start();
  await flush();
  ui.visibility(true);
  assert.equal(ui.calls[0].options.signal.aborted, true);
  ui.visibility(false);
  await flush();
  completeFirst(response(status('active')));
  await flush();
  assert.equal(ui.get('pairing-code').textContent, '654321');
  assert.equal(ui.get('device').hidden, false);
  assert.equal(ui.calls.length, 2, 'late active response cannot create a report session');
});

test('session device failures return to enrollment without silently requesting another session', async (t) => {
  const codes = {
    PHOTO_REPORT_DEVICE_REQUIRED: /не подключён/,
    PHOTO_REPORT_DEVICE_REVOKED: /отключён/,
    PHOTO_REPORT_DEVICE_EXPIRED: /истекло/,
    PHOTO_REPORT_DEVICE_BRANCH_MISMATCH: /другой точки/,
  };
  for (const [code, message] of Object.entries(codes)) {
    const ui = page(t, async (url) =>
      url.endsWith('/device')
        ? response(status('active'))
        : response({ code, error: 'Device access denied' }, 403),
    );
    ui.start();
    await flush();
    assert.equal(ui.get('device').hidden, false);
    assert.match(ui.get('device-status').textContent, message);
    assert.equal(ui.get('intro').hidden, true);
    assert.equal(ui.calls.length, 2);
    ui.get('next-report').click();
    ui.get('send').dispatchEvent(new ui.w.Event('click'));
    await flush();
    assert.equal(ui.calls.length, 2, code + ' does not reuse or reopen a session');
  }
});

test('upload device failures discard unsafe captures and cannot retry the old session', async (t) => {
  for (const code of [
    'PHOTO_REPORT_DEVICE_REQUIRED',
    'PHOTO_REPORT_DEVICE_REVOKED',
    'PHOTO_REPORT_DEVICE_EXPIRED',
    'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH',
  ]) {
    let sessions = 0;
    const ui = page(t, async (url, options) => {
      if (url.endsWith('/device')) return response(status('active'));
      if (url.endsWith('/session')) return response(session(++sessions));
      assert.equal(options.headers['X-Bulka-Report-Session'], 'session-1');
      return response({ code, error: 'Device access denied' }, 403);
    });
    const captured = camera(ui);
    ui.start();
    await flush();
    ui.w.document.querySelector('[data-kind=hall]').click();
    await flush();
    ui.get('take-photo').click();
    await flush();
    assert.equal(ui.w.document.querySelectorAll('.preview').length, 1);
    ui.get('send').click();
    await flush();
    assert.equal(ui.get('device').hidden, false, code);
    assert.equal(ui.get('capture').hidden, true);
    assert.equal(ui.w.document.querySelectorAll('.preview').length, 0);
    assert.equal(captured.revoked(), 1);
    assert.ok(captured.stops() >= 1);
    assert.equal(ui.get('send').disabled, true);
    ui.get('send').dispatchEvent(new ui.w.Event('click'));
    ui.w.document.querySelector('[data-kind=hall]').click();
    await flush();
    assert.equal(ui.calls.filter(({ url }) => url.endsWith('/submit')).length, 1);
    assert.equal(sessions, 1, 'device error cannot automatically reuse the rejected session');
    ui.get('check-device').click();
    await flush();
    assert.equal(sessions, 2, 'a new active confirmation gets a fresh session');
    assert.equal(ui.get('intro').hidden, false);
    ui.get('send').dispatchEvent(new ui.w.Event('click'));
    await flush();
    assert.equal(
      ui.calls.filter(({ url }) => url.endsWith('/submit')).length,
      1,
      'cleared batch is never resent',
    );
  }
});

test('a late camera frame is discarded when device access is revoked during capture', async (t) => {
  let denied = false;
  let finishBlob;
  const ui = page(t, async (url) =>
    url.endsWith('/device') ? response(status(denied ? 'revoked' : 'active')) : response(session()),
  );
  const captured = camera(ui, (callback) => {
    finishBlob = callback;
  });
  ui.start();
  await flush();
  ui.w.document.querySelector('[data-kind=hall]').click();
  await flush();
  ui.get('take-photo').click();
  await flush();
  denied = true;
  ui.visibility(true);
  ui.visibility(false);
  await flush();
  finishBlob(new ui.w.Blob(['late-frame'], { type: 'image/jpeg' }));
  await flush();
  assert.equal(ui.get('device').hidden, false);
  assert.equal(ui.w.document.querySelectorAll('.preview').length, 0);
  assert.equal(captured.created(), 0, 'invalidated frame is never retained');
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/submit')).length, 0);
});

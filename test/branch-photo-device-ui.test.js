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

function page(t, reply, url = 'https://bulka.com.kz/branch-reports#t=branch-qr') {
  const dom = new JSDOM(html, {
    url,
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
    PHOTO_REPORT_DEVICE_EXPIRED: /Код истёк/,
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

test('device reauthorization preserves local captures for the same branch; revocation and branch mismatch discard them', async (t) => {
  for (const code of [
    'PHOTO_REPORT_DEVICE_REQUIRED',
    'PHOTO_REPORT_DEVICE_REVOKED',
    'PHOTO_REPORT_DEVICE_EXPIRED',
    'PHOTO_REPORT_DEVICE_BRANCH_MISMATCH',
  ]) {
    let sessions = 0;
    const preserve = ['PHOTO_REPORT_DEVICE_REQUIRED', 'PHOTO_REPORT_DEVICE_EXPIRED'].includes(code);
    const ui = page(t, async (url, options) => {
      if (url.endsWith('/device')) return response(status('active'));
      if (url.endsWith('/session')) return response(session(++sessions));
      if (sessions === 2 && preserve) {
        assert.equal(options.headers['X-Bulka-Report-Session'], 'session-2');
        return response({ submitted: true });
      }
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
    assert.equal(ui.w.document.querySelectorAll('.preview').length, preserve ? 1 : 0);
    assert.equal(captured.revoked(), preserve ? 0 : 1);
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
    assert.equal(ui.get(preserve ? 'capture' : 'intro').hidden, false);
    if (preserve)
      assert.equal(ui.get('send').disabled, false, 'reauthorization restores the real send button');
    ui.get('send').dispatchEvent(new ui.w.Event('click'));
    await flush();
    assert.equal(
      ui.calls.filter(({ url }) => url.endsWith('/submit')).length,
      preserve ? 2 : 1,
      'only a preserved batch with a fresh active session can be manually resent',
    );
  }
});

test('an approved tablet opens without QR, URL fragment or browser storage', async (t) => {
  const ui = page(
    t,
    async (url, options) => {
      assert.equal(options.headers['X-Bulka-Report-Token'], '');
      return url.endsWith('/device') ? response(status('active')) : response(session());
    },
    'https://bulka.com.kz/branch-reports',
  );
  ui.start();
  await flush();
  assert.equal(ui.get('intro').hidden, false);
  assert.equal(ui.get('branch').textContent, branch.name);
  assert.equal(ui.w.localStorage.length, 0);
  assert.equal(ui.w.sessionStorage.length, 0);
  assert.equal(ui.calls.length, 2);
});

test('an expired report session renews automatically and retries the same three photos once with the same upload ID', async (t) => {
  let sessions = 0;
  const submissions = [];
  const ui = page(t, async (url, options) => {
    if (url.endsWith('/device')) return response(status('active'));
    if (url.endsWith('/session')) return response(session(++sessions));
    submissions.push(options);
    if (submissions.length === 1)
      return response({ code: 'PHOTO_REPORT_SESSION_EXPIRED', error: 'Сеанс завершён' }, 401);
    assert.equal(options.headers['X-Bulka-Report-Session'], 'session-2');
    return response({ submitted: true });
  });
  const captured = camera(ui);
  ui.start();
  await flush();
  assert.equal(ui.w.sessionStorage.length, 0, 'approval no longer depends on storing the QR');
  ui.w.document.querySelector('[data-kind=hall]').click();
  await flush();
  for (let index = 0; index < 3; index++) {
    ui.get('take-photo').click();
    await flush();
  }
  ui.get('send').click();
  await flush();
  assert.equal(sessions, 2);
  assert.equal(submissions.length, 2);
  assert.equal(
    submissions[0].body,
    submissions[1].body,
    'the original batch and idempotency key are retained',
  );
  assert.equal(submissions[1].body.getAll('photos').length, 3);
  assert.equal(ui.get('success').hidden, false);
  assert.match(ui.get('success-detail').textContent, /3 фото/);
  assert.equal(captured.revoked(), 3, 'only successful completion releases the previews');
  assert.equal(
    ui.calls.filter(({ url }) => url.endsWith('/device')).length,
    1,
    'no pairing request or QR rescan is needed',
  );
});

test('failed session renewal preserves three previews and a usable retry button without rescan instructions', async (t) => {
  let sessions = 0;
  const ui = page(t, async (url) => {
    if (url.endsWith('/device')) return response(status('active'));
    if (url.endsWith('/session'))
      return ++sessions === 1
        ? response(session())
        : response({ error: 'Storage temporarily unavailable' }, 503);
    return response({ code: 'PHOTO_REPORT_SESSION_EXPIRED', error: 'Сеанс завершён' }, 401);
  });
  const captured = camera(ui);
  ui.start();
  await flush();
  ui.w.document.querySelector('[data-kind=hall]').click();
  await flush();
  for (let index = 0; index < 3; index++) {
    ui.get('take-photo').click();
    await flush();
  }
  ui.get('send').click();
  await flush();
  assert.equal(ui.get('capture').hidden, false);
  assert.equal(ui.w.document.querySelectorAll('.preview').length, 3);
  assert.equal(captured.revoked(), 0);
  assert.equal(ui.get('send').disabled, false);
  assert.doesNotMatch(ui.get('error').textContent, /QR|Сеанс завершён/);
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/submit')).length, 1);
});

test('period rollover preserves photos, updates the visible date and waits for a new send instead of silently moving the report', async (t) => {
  let sessions = 0;
  const submissions = [];
  const ui = page(t, async (url, options) => {
    if (url.endsWith('/device')) return response(status('active'));
    if (url.endsWith('/session')) {
      sessions++;
      return response({ ...session(sessions), date: sessions === 1 ? '2026-10-04' : '2026-10-05' });
    }
    submissions.push(options);
    return submissions.length === 1
      ? response({ code: 'PHOTO_REPORT_SESSION_EXPIRED' }, 401)
      : response({ submitted: true });
  });
  const captured = camera(ui);
  ui.start();
  await flush();
  ui.w.document.querySelector('[data-kind=hall]').click();
  await flush();
  ui.get('take-photo').click();
  await flush();
  ui.get('send').click();
  await flush();
  assert.equal(submissions.length, 1);
  assert.equal(ui.w.document.querySelectorAll('.preview').length, 1);
  assert.equal(captured.revoked(), 0);
  assert.match(ui.get('capture-date').textContent, /5 октября/);
  assert.match(ui.get('error').textContent, /Смена изменилась/);
  assert.equal(ui.get('send').disabled, false);
  ui.get('send').click();
  await flush();
  assert.equal(submissions.length, 2);
  assert.notEqual(submissions[0].body.get('uploadId'), submissions[1].body.get('uploadId'));
  assert.equal(submissions[1].headers['X-Bulka-Report-Session'], 'session-2');
  assert.equal(ui.get('success').hidden, false);
});

test('network errors keep the paired tablet and its unsent photos without instructing another QR scan', async (t) => {
  let checks = 0;
  const ui = page(t, async (url) => {
    if (url.endsWith('/device')) {
      if (++checks > 1) throw new Error('network offline');
      return response(status('active'));
    }
    return response(session());
  });
  const captured = camera(ui);
  ui.start();
  await flush();
  ui.w.document.querySelector('[data-kind=hall]').click();
  await flush();
  ui.get('take-photo').click();
  await flush();
  ui.visibility(true);
  ui.visibility(false);
  await flush();
  assert.equal(ui.get('capture').hidden, false);
  assert.equal(ui.w.document.querySelectorAll('.preview').length, 1);
  assert.equal(captured.revoked(), 0);
  assert.match(ui.get('error').textContent, /интернет/);
  assert.doesNotMatch(ui.get('error').textContent, /QR/);
  assert.equal(ui.get('send').disabled, false);
});

test('cookie bootstrap rejection disables a previously paired tablet and manual logout uses no client-selected identity', async (t) => {
  let revoked = false;
  const ui = page(t, async (url, options) => {
    if (url.endsWith('/device/logout')) {
      assert.equal(options.method, 'POST');
      assert.equal(options.body, '{}');
      revoked = true;
      return response({ success: true });
    }
    if (url.endsWith('/device'))
      return revoked
        ? response({ code: 'PHOTO_REPORT_DEVICE_REVOKED' }, 403)
        : response(status('active'));
    return response(session());
  });
  ui.start();
  await flush();
  ui.get('disconnect-device').click();
  await flush();
  assert.equal(ui.get('device').hidden, false);
  assert.match(ui.get('device-status').textContent, /отключён/);
  assert.equal(ui.get('send').disabled, true);
  ui.get('check-device').click();
  await flush();
  assert.equal(ui.get('intro').hidden, true);
  assert.equal(ui.get('device').hidden, false);
  assert.equal(ui.calls.filter(({ url }) => url.endsWith('/session')).length, 1);
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

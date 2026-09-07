const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('BulkaAndroid/web/app_bootstrap.js', 'utf8');

async function start({ previous, blocked = false, status = 200, stalled = '' } = {}) {
  const storage = new Map([['customer', 'preserved']]);
  if (previous) storage.set('bulka.font-manifest-release', previous);
  const events = [];
  let finish;
  const started = new Promise((resolve) => { finish = resolve; });
  const document = {
    baseURI: 'https://example.com/',
    currentScript: { src: 'https://example.com/app_bootstrap.js?v=release-new' },
    addEventListener() {},
    createElement: () => ({ addEventListener() {} }),
    body: { append: (script) => { events.push({ script: script.src }); finish(); } },
  };
  const window = {
    location: { href: 'https://example.com/', replace() {} },
    setTimeout, clearTimeout, setInterval() {}, addEventListener() {},
    history: { state: null, replaceState() {} },
    localStorage: {
      getItem(key) { if (blocked) throw new Error('disabled'); return storage.get(key); },
      setItem(key, value) { if (blocked) throw new Error('disabled'); storage.set(key, value); },
    },
  };
  vm.runInNewContext(source, {
    document, window, navigator: stalled === 'worker'
      ? { serviceWorker: { getRegistrations: () => new Promise(() => {}) } } : {},
    URL, AbortController, console: { warn() {} },
    fetch: async (url, options) => {
      if (url.pathname.includes(stalled) && stalled && stalled !== 'worker') {
        return new Promise((_, reject) => {
          options.signal.addEventListener('abort', () => reject(new Error('timeout')));
        });
      }
      if (url.pathname === '/release-version.json') {
        return { ok: true, json: async () => ({ version: 'release-new' }) };
      }
      events.push({ path: url.pathname, cache: options.cache });
      return { ok: status === 200, arrayBuffer: async () => new ArrayBuffer(0) };
    },
  });
  await started;
  return { storage, events };
}

test('new release refreshes the HTTP font cache before Flutter starts', async () => {
  const { storage, events } = await start({ previous: 'release-old' });
  assert.deepEqual(events, [
    { path: '/assets/FontManifest.json', cache: 'reload' },
    { script: 'https://example.com/flutter_bootstrap.js?v=release-new' },
  ]);
  assert.equal(storage.get('bulka.font-manifest-release'), 'release-new');
  assert.equal(storage.get('customer'), 'preserved');
});

test('stalled release, font and worker services cannot hold the splash indefinitely', async () => {
  for (const stalled of ['release-version', 'FontManifest', 'worker']) {
    const began = Date.now();
    const { events } = await start({ stalled });
    assert.ok(events.at(-1).script);
    assert.ok(Date.now() - began < 1500, `Startup blocked by ${stalled}`);
  }
});

test('unchanged release does not add a font-manifest request', async () => {
  const { events } = await start({ previous: 'release-new' });
  assert.equal(events.length, 1);
  assert.ok(events[0].script);
});

test('blocked storage and failed font refresh do not block startup', async () => {
  for (const options of [{ blocked: true }, { status: 503 }]) {
    const { storage, events } = await start(options);
    assert.ok(events.at(-1).script);
    assert.equal(storage.has('bulka.font-manifest-release'), false);
    assert.equal(storage.get('customer'), 'preserved');
  }
});

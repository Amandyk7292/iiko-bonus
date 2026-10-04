const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const express = require('express');

require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      from() {
        throw new Error('Unexpected database call');
      },
    },
  },
};
const { supabase } = require('../src/config/supabase');
const { getLatestPluginUpdate } = require('../src/services/plugin-update.service');
const { posDeviceTokenHash } = require('../src/services/pos-pairing.service');
const { posTransportMiddleware } = require('../src/middlewares/pos-transport.middleware');

const version = '1.13.0';
const manifestName = `BulkaPlugin-${version}-update.manifest.json`;
const updatePath = '/api/loyalty/pos/updates/latest';
const token = 'pt1_' + 'a'.repeat(64);
const terminal = randomUUID();
const branch = randomUUID();

function payload(overrides = {}) {
  return {
    schemaVersion: 1,
    version,
    apiVersion: 'V9Preview7',
    packageUrl: `https://bulka.com.kz/downloads/BulkaPlugin-${version}-update.zip`,
    packageSha256: 'b'.repeat(64),
    packageSizeBytes: 200000,
    files: {
      'Resto.Front.Api.IikoBonusPlugin.dll': 'c'.repeat(64),
      'Manifest.xml': 'd'.repeat(64),
      'BulkaPluginUpdater.exe': 'e'.repeat(64),
    },
    sourceCommit: 'f'.repeat(40),
    publishedAt: '2026-10-04T00:00:00Z',
    ...overrides,
  };
}

function envelope(value = payload(), overrides = {}) {
  return {
    algorithm: 'RSA-SHA256',
    keyId: 'bulka-plugin-2026',
    payloadBase64: Buffer.from(JSON.stringify(value, null, 2), 'utf8').toString('base64'),
    signatureBase64: Buffer.alloc(384, 7).toString('base64'),
    ...overrides,
  };
}

function database(policyOverrides = {}, active = true, branchActive = true) {
  const calls = [];
  return {
    calls,
    from(table) {
      calls.push(table);
      const data =
        table === 'pos_plugin_policy'
          ? {
              latest_version: version,
              minimum_version: version,
              enforce_minimum: true,
              download_url: `/downloads/BulkaPlugin-${version}-update.zip`,
              ...policyOverrides,
            }
          : table === 'pos_devices'
            ? active
              ? {
                  terminal_id: terminal,
                  branch_id: branch,
                  terminal_group_id: randomUUID(),
                  token_hash: posDeviceTokenHash(token),
                  plugin_version: '1.12.1',
                }
              : null
            : table === 'bulka_locations'
              ? branchActive
                ? { id: branch }
                : null
              : null;
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        update() {
          return this;
        },
        async single() {
          return { data };
        },
        async maybeSingle() {
          return { data };
        },
      };
    },
  };
}

async function directory(t) {
  const target = await fs.mkdtemp(path.join(os.tmpdir(), 'bulka-plugin-update-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(target)), path.resolve(os.tmpdir()));
    assert.match(path.basename(target), /^bulka-plugin-update-/);
    return fs.rm(target, { recursive: true, force: true });
  });
  return target;
}

async function storeManifest(target, value) {
  await fs.writeFile(path.join(target, manifestName), JSON.stringify(value));
}

async function unavailable(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(error.statusCode, 503);
    assert.equal(error.code, 'UPDATE_RELEASE_UNAVAILABLE');
    return true;
  });
}

test('update manifest preserves signed bytes and returns only the release envelope', async (t) => {
  const target = await directory(t);
  const release = envelope();
  await storeManifest(target, release);
  assert.deepEqual(await getLatestPluginUpdate(database(), target), release);
});

test('only the exact policy-selected local update artifact can be read', async (t) => {
  const target = await directory(t);
  await storeManifest(target, envelope());
  for (const download_url of [
    'https://bulka.com.kz/downloads/BulkaPlugin-1.13.0-update.zip',
    'https://evil.example/update.zip',
    '/downloads/BulkaPlugin-1.13.0-full.zip',
    '/downloads/../BulkaPlugin-1.13.0-update.zip',
    '/downloads/BulkaPlugin-1.13.0-update.zip?file=../secret',
    '/downloads/BulkaPlugin-1.12.1-update.zip',
  ]) {
    await unavailable(() => getLatestPluginUpdate(database({ download_url }), target));
  }
  await unavailable(() =>
    getLatestPluginUpdate(database({ latest_version: '../../outside' }), target),
  );
});

test('missing, oversized and invalid JSON manifests fail closed', async (t) => {
  const target = await directory(t);
  await unavailable(() => getLatestPluginUpdate(database(), target));
  for (const bytes of ['', '{', ' '.repeat(64 * 1024 + 1)]) {
    await fs.writeFile(path.join(target, manifestName), bytes);
    await unavailable(() => getLatestPluginUpdate(database(), target));
  }
});

test('manifest envelope requires the pinned key ID, algorithm and canonical bounded base64', async (t) => {
  const target = await directory(t);
  for (const changes of [
    { algorithm: 'none' },
    { keyId: 'downloaded-key' },
    { payloadBase64: '!!!!' },
    { payloadBase64: Buffer.from('{').toString('base64') },
    { payloadBase64: envelope().payloadBase64 + '\n' },
    { signatureBase64: 'AAAA' },
    { signatureBase64: Buffer.alloc(1025).toString('base64') },
    { signatureBase64: 'AB==' },
    { verified: true },
  ]) {
    await storeManifest(target, envelope(payload(), changes));
    await unavailable(() => getLatestPluginUpdate(database(), target));
  }
});

test('payload rejects wrong version/API, remote or altered package paths, invalid size and hashes', async (t) => {
  const target = await directory(t);
  for (const changes of [
    { schemaVersion: 2 },
    { version: '1.12.1' },
    { apiVersion: 'V9' },
    { packageUrl: 'https://evil.example/BulkaPlugin-1.13.0-update.zip' },
    { packageUrl: 'http://bulka.com.kz/downloads/BulkaPlugin-1.13.0-update.zip' },
    { packageUrl: 'https://bulka.com.kz/downloads/BulkaPlugin-1.13.0-update.zip?x=1' },
    { packageUrl: 'https://bulka.com.kz@evil.example/downloads/BulkaPlugin-1.13.0-update.zip' },
    { packageSha256: 'xyz' },
    { packageSizeBytes: 0 },
    { packageSizeBytes: 20 * 1024 * 1024 + 1 },
    { packageSizeBytes: 10.5 },
  ]) {
    await storeManifest(target, envelope(payload(changes)));
    await unavailable(() => getLatestPluginUpdate(database(), target));
  }
});

test('manifest file inventory permits exactly DLL, iiko manifest and updater', async (t) => {
  const target = await directory(t);
  const expected = payload().files;
  for (const files of [
    { ...expected, 'Resto.Front.Api.IikoBonusPlugin.dll.config': 'a'.repeat(64) },
    { ...expected, '../BulkaPluginUpdater.exe': 'a'.repeat(64) },
    { 'Resto.Front.Api.IikoBonusPlugin.dll': 'a'.repeat(64), 'Manifest.xml': 'a'.repeat(64) },
    { ...expected, 'BulkaPluginUpdater.exe': 'invalid' },
  ]) {
    await storeManifest(target, envelope(payload({ files })));
    await unavailable(() => getLatestPluginUpdate(database(), target));
  }
});

function loadRoute(mocks) {
  const filename = require.resolve('../src/routes/pos-health.routes');
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const run = vm.runInThisContext(
    `(function(require,module,exports){${readFileSync(filename, 'utf8')}\n})`,
    { filename },
  );
  run((id) => (Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id)), module, module.exports);
  return module.exports;
}

async function api(t, db, target) {
  t.mock.method(supabase, 'from', db.from.bind(db));
  const app = express();
  app.use(express.json());
  app.use(
    loadRoute({
      '../services/plugin-update.service': {
        getLatestPluginUpdate: () => getLatestPluginUpdate(db, target),
      },
    }),
  );
  app.use((error, _req, res, _next) => {
    res.status(error.statusCode || 500).json({ success: false, code: error.code });
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(
    () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  return (headers = {}) =>
    fetch(`http://127.0.0.1:${server.address().port}${updatePath}`, {
      headers: {
        authorization: `Bearer ${token}`,
        'x-bulka-terminal-id': terminal,
        'x-bulka-branch-id': branch,
        'x-bulka-plugin-version': '1.12.1',
        ...headers,
      },
    });
}

test('HTTP update route authenticates physical register and active branch before returning release', async (t) => {
  const target = await directory(t);
  const release = envelope();
  await storeManifest(target, release);
  const request = await api(t, database(), target);
  const response = await request();
  assert.equal(response.status, 200, 'minimum-version enforcement must not block the update check');
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { success: true, release });
  for (const headers of [
    { authorization: 'Bearer pt1_bad' },
    { authorization: `Bearer pt1_${'b'.repeat(64)}` },
    { 'x-bulka-terminal-id': randomUUID() },
    { 'x-bulka-branch-id': randomUUID() },
  ]) {
    assert.equal((await request(headers)).status, 401);
  }
});

test('HTTP update route documents an unpublished release with noncached 503', async (t) => {
  const request = await api(t, database(), await directory(t));
  const response = await request();
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: false,
    code: 'UPDATE_RELEASE_UNAVAILABLE',
    error: 'Обновление плагина пока не опубликовано.',
  });
});

test('inactive paired registers cannot use the update endpoint', async (t) => {
  const target = await directory(t);
  await storeManifest(target, envelope());
  const request = await api(t, database({}, false), target);
  assert.equal((await request()).status, 401);
});

test('a paired register from a disabled branch cannot use the update endpoint', async (t) => {
  const target = await directory(t);
  await storeManifest(target, envelope());
  const request = await api(t, database({}, true, false), target);
  const response = await request();
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'BRANCH_POS_UNAUTHORIZED');
});

async function invoke(req) {
  const result = {};
  const res = {
    status(code) {
      result.status = code;
      return this;
    },
    json(body) {
      result.body = body;
      return this;
    },
  };
  await posTransportMiddleware(req, res, (error) => {
    if (error) result.error = error;
    else result.next = true;
  });
  return result;
}

test('minimum-version exemption is confined to authenticated GET of the exact update path', async (t) => {
  const db = database();
  t.mock.method(supabase, 'from', db.from.bind(db));
  const request = (method, requestPath, headers = {}) => ({
    method,
    path: requestPath,
    headers: {
      authorization: `Bearer ${token}`,
      'x-bulka-terminal-id': terminal,
      'x-bulka-plugin-version': '1.12.1',
      ...headers,
    },
  });
  assert.equal((await invoke(request('GET', updatePath))).next, true);
  assert.equal(db.calls.includes('pos_plugin_policy'), false);
  for (const [method, requestPath] of [
    ['POST', updatePath],
    ['HEAD', updatePath],
    ['GET', updatePath + '/'],
    ['GET', updatePath + '-other'],
    ['GET', '/api/loyalty/inventory/sale'],
    ['POST', '/api/loyalty/prepare'],
  ]) {
    const result = await invoke(request(method, requestPath));
    assert.equal(result.status, 426);
    assert.equal(result.body.code, 'POS_PLUGIN_UPDATE_REQUIRED');
  }
  assert.equal(
    (await invoke(request('GET', updatePath, { 'x-bulka-terminal-id': randomUUID() }))).status,
    401,
  );
});

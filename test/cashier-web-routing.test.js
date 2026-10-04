const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

process.env.BULKA_PUBLIC_APP_DIR = path.join(__dirname, 'fixtures/flutter-app');
const app = require('../src/app');

test('cashier QR registration loads the web shell on a path not claimed by installed iOS apps', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/cashier-register?cashier=${'a'.repeat(64)}`);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(await response.text(), /flutter_bootstrap|app_bootstrap/);
  const association = await (
    await fetch(`${origin}/.well-known/apple-app-site-association`)
  ).json();
  assert.ok(
    association.applinks.details.every(
      (entry) =>
        !entry.paths.some(
          (value) =>
            value === '*' || value === '/cashier-register' || value === '/cashier-register/*',
        ),
    ),
  );
});

test('old printed branch links resolve to the current Flutter registration shell', async (t) => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(`${origin}/invite/90c3a8b5-9c7c-4407-bf7e-18d093da218f`);
  assert.equal(response.status, 200);
  assert.equal(response.url, `${origin}/profile?register=1`);
  assert.match(response.headers.get('content-type'), /text\/html/);
  assert.match(response.headers.get('cache-control'), /no-store/);
  assert.match(await response.text(), /flutter_bootstrap|app_bootstrap/);
});

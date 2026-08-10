const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.BULKA_PUBLIC_APP_DIR = path.join(__dirname, 'fixtures', 'flutter-app');
process.env.BULKA_ADMIN_UI_DIR = path.join(__dirname, 'fixtures', 'admin-ui');
process.env.YANDEX_MAPS_API_KEY = 'test_yandex_maps_key_1234567890';

const app = require('../src/app');
const {
  directivesForPath,
  normalizePolicyPath,
  serializePolicy,
} = require('../src/middlewares/content-security-policy.middleware');

const scriptSources = (policy) => policy.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] || '';

test('CSP routing mirrors one optional trailing slash without broad path matching', () => {
  const nonce = 'fixed-test-nonce';
  for (const canonicalPath of [
    '/guest',
    '/wallet',
    '/courier',
    '/maps/yandex',
    '/payments/forte-widget',
  ]) {
    const canonical = directivesForPath(canonicalPath, nonce);
    assert.deepEqual(directivesForPath(`${canonicalPath}/`, nonce), canonical, canonicalPath);
    assert.deepEqual(
      directivesForPath(`${canonicalPath}/?source=regression`, nonce),
      canonical,
      `${canonicalPath} query`,
    );
  }

  assert.equal(normalizePolicyPath('/guest/?source=test#section'), '/guest');
  assert.equal(normalizePolicyPath('/maps/yandex//'), '/maps/yandex/');
  assert.equal(normalizePolicyPath('/payments/forte-widget%2F'), '/payments/forte-widget%2F');

  const doubledMapPolicy = serializePolicy(directivesForPath('/maps/yandex//', nonce));
  const encodedPaymentPolicy = serializePolicy(
    directivesForPath('/payments/forte-widget%2F', nonce),
  );
  assert.doesNotMatch(doubledMapPolicy, /api-maps\.yandex\.ru/);
  assert.doesNotMatch(encodedPaymentPolicy, /js\.fortebank\.com/);

  for (const apiPath of [
    '/api',
    '/api/',
    '/internal/',
    '/admin/api/',
    '/webhooks/',
    '/.well-known/',
  ]) {
    const apiPolicy = serializePolicy(directivesForPath(apiPath, nonce));
    assert.match(apiPolicy, /default-src 'none'/, apiPath);
    assert.match(apiPolicy, /frame-ancestors 'none'/, apiPath);
  }
});

test('registration and isolated documents receive executable least-privilege CSP on both URLs', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const route of ['/guest', '/guest/', '/wallet', '/wallet/']) {
    const response = await fetch(`${origin}${route}?source=csp-test`);
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') || '';
    const scripts = scriptSources(csp);

    assert.equal(response.status, 200, route);
    assert.match(html, /id="regForm"/, route);
    assert.match(html, /\/taplink\/assets\/fonts\/GolosText-Regular\.ttf/, route);
    assert.doesNotMatch(html, /fonts\.(?:googleapis|gstatic)\.com/, route);
    assert.match(scripts, /'self' 'sha256-[A-Za-z0-9+/]+=*'/, route);
    assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval|https:/, route);
    assert.match(csp, /style-src 'self' 'sha256-[A-Za-z0-9+/]+=*'/, route);
    assert.match(csp, /font-src 'self' data:/, route);
    assert.match(csp, /connect-src 'self'/, route);
    assert.match(csp, /img-src 'self' data:/, route);
  }

  for (const font of ['GolosText-Regular.ttf', 'GolosText-SemiBold.ttf']) {
    const response = await fetch(`${origin}/taplink/assets/fonts/${font}`);
    assert.equal(response.status, 200, font);
    assert.match(response.headers.get('content-type') || '', /font\/ttf/, font);
    assert.match(response.headers.get('cache-control') || '', /immutable/, font);
  }

  for (const route of ['/courier', '/courier/']) {
    const response = await fetch(`${origin}${route}`);
    const html = await response.text();
    const scripts = scriptSources(response.headers.get('content-security-policy') || '');
    assert.equal(response.status, 200, route);
    assert.match(html, /id="phoneForm"/, route);
    assert.match(scripts, /'self' 'sha256-[A-Za-z0-9+/]+=*'/, route);
    assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval|https:/, route);
  }

  for (const route of ['/payments/forte-widget', '/payments/forte-widget/']) {
    const response = await fetch(`${origin}${route}?embedded=app`);
    const csp = response.headers.get('content-security-policy') || '';
    const scripts = scriptSources(csp);
    assert.equal(response.status, 200, route);
    assert.equal(response.headers.get('cross-origin-embedder-policy'), null, route);
    assert.equal(scripts, "'self' https://js.fortebank.com", route);
    assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval/, route);
    assert.match(csp, /frame-src https:\/\/securepayments\.fortebank\.com/, route);
  }

  for (const route of ['/maps/yandex', '/maps/yandex/']) {
    const response = await fetch(`${origin}${route}?mode=admin`);
    const html = await response.text();
    const csp = response.headers.get('content-security-policy') || '';
    const scripts = scriptSources(csp);
    const nonce = scripts.match(/'nonce-([^']+)'/)?.[1];
    assert.equal(response.status, 200, route);
    assert.ok(nonce, `${route} CSP nonce`);
    assert.match(scripts, /https:\/\/api-maps\.yandex\.ru/, route);
    assert.doesNotMatch(scripts, /(?:^|\s)https:(?:\s|$)|unsafe-inline/, route);
    assert.ok(html.includes(`nonce="${nonce}"`), route);
  }
});

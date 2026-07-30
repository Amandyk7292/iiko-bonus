const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

const app = require('../src/app');

test('health check stays independent from external services', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/healthz`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok' });
  const csp = response.headers.get('content-security-policy') || '';
  assert.match(csp, /default-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
});

test('readiness and metrics endpoints expose bounded operational state', async (t) => {
  const previousMetricsToken = process.env.METRICS_BEARER_TOKEN;
  const previousKaspiReady = app.locals.kaspiReady;
  const metricsToken = 'metrics-test-token-that-is-at-least-32-characters';
  process.env.METRICS_BEARER_TOKEN = metricsToken;
  app.locals.kaspiReady = true;
  t.after(() => {
    app.locals.kaspiReady = previousKaspiReady;
    if (previousMetricsToken === undefined) delete process.env.METRICS_BEARER_TOKEN;
    else process.env.METRICS_BEARER_TOKEN = previousMetricsToken;
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const readiness = await fetch(`${origin}/readyz`);
  assert.equal(readiness.status, 200);
  assert.deepEqual(await readiness.json(), { status: 'ready' });

  assert.equal((await fetch(`${origin}/internal/metrics`)).status, 401);
  assert.equal((await fetch(`${origin}/internal/readiness`)).status, 401);
  const detailedReadiness = await fetch(`${origin}/internal/readiness`, {
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  assert.equal(detailedReadiness.status, 200);
  const detailedReadinessBody = await detailedReadiness.json();
  assert.equal(detailedReadinessBody.status, 'ready');
  assert.equal(detailedReadinessBody.dependencies.database.ok, true);
  const metrics = await fetch(`${origin}/internal/metrics`, {
    headers: { Authorization: `Bearer ${metricsToken}` },
  });
  assert.equal(metrics.status, 200);
  assert.match(await metrics.text(), /bulka_http_requests_total/);
});

test('mobile association files open catalog links in installed apps', async (t) => {
  const previousFingerprints = process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS;
  const fingerprint =
    '1D:46:30:E7:F2:29:8D:19:B8:A8:39:5F:26:D3:43:5C:B8:30:79:D1:D3:1A:08:0B:DD:18:08:9C:D7:EB:4D:30';
  process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS = fingerprint;
  t.after(() => {
    if (previousFingerprints === undefined) {
      delete process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS;
    } else {
      process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS = previousFingerprints;
    }
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const aasaResponse = await fetch(`${origin}/.well-known/apple-app-site-association`);
  const aasa = await aasaResponse.json();
  assert.equal(aasaResponse.status, 200);
  assert.equal(aasa.applinks.details[0].appID, 'GKRRT4JU9G.com.bulka.bonus');
  assert.ok(aasa.applinks.details[0].paths.includes('/catalog/*'));

  const assetLinksResponse = await fetch(`${origin}/.well-known/assetlinks.json`);
  const assetLinks = await assetLinksResponse.json();
  assert.equal(assetLinksResponse.status, 200);
  assert.equal(assetLinks[0].target.package_name, 'com.bulka.bonus');
  assert.deepEqual(assetLinks[0].target.sha256_cert_fingerprints, [fingerprint]);
});

test('admin and Flutter CSP remove general-purpose script evaluation', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const admin = await fetch(`${origin}/admin`);
  const adminCsp = admin.headers.get('content-security-policy') || '';
  const adminScriptPolicy = adminCsp.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] || '';
  assert.equal(admin.status, 200);
  assert.equal(adminScriptPolicy, "'self'");
  assert.doesNotMatch(adminScriptPolicy, /unsafe-inline|unsafe-eval/);

  const client = await fetch(`${origin}/`);
  const clientCsp = client.headers.get('content-security-policy') || '';
  const clientScriptPolicy = clientCsp.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] || '';
  assert.equal(client.status, 200);
  assert.equal(client.headers.get('cross-origin-embedder-policy'), 'credentialless');
  assert.match(clientScriptPolicy, /sha256-/);
  assert.match(clientScriptPolicy, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(clientScriptPolicy, /(?:^|\s)'unsafe-eval'(?:\s|$)/);
  assert.doesNotMatch(clientScriptPolicy, /(?:^|\s)'unsafe-inline'(?:\s|$)/);
});

test('Forte widget shell is private, pinned to official hosts and never reflects query tokens', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const leakedToken = 'query-token-must-not-be-used';
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/payments/forte-widget?token=${leakedToken}`,
  );
  const html = await response.text();
  const csp = response.headers.get('content-security-policy') || '';
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  assert.equal(response.headers.get('cross-origin-embedder-policy'), null);
  assert.doesNotMatch(html, new RegExp(leakedToken));
  assert.match(html, /https:\/\/js\.fortebank\.com\/widget\/be_gateway\.js/);
  assert.match(html, /\/assets\/forte-widget\.js\?v=3/);
  assert.match(html, /\/assets\/forte-widget\.css\?v=3/);
  assert.match(html, /class="phone-frame"/);
  assert.match(html, /class="phone-screen"/);
  assert.match(csp, /script-src 'self' https:\/\/js\.fortebank\.com/);
  assert.match(csp, /frame-src https:\/\/securepayments\.fortebank\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);

  const styleResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/assets/forte-widget.css?v=3`,
  );
  const styles = await styleResponse.text();
  assert.equal(styleResponse.status, 200);
  assert.match(styles, /@media \(min-width: 900px\)/);
  assert.match(styles, /--phone-screen-width/);
  assert.match(styles, /\.payment-widget-app:not\(\.payment-widget-app_full\)/);
});

test('payment and refund policy is publicly available as a stable HTML page', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/payment-and-refund`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(html, /Условия оплаты и возврата/);
  assert.match(html, /не позднее 10 календарных дней/);
  assert.match(html, /\+7 701 277 22 33/);
});

test('Yandex Courier delivery terms are publicly available as a stable HTML page', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/delivery-terms`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(response.headers.get('cache-control') || '', /no-cache/);
  assert.match(html, /Условия доставки/);
  assert.match(html, /Яндекс (?:Курьер|Доставка)/);
  assert.match(html, /Стоимость доставки и итоговая сумма/);
  assert.match(html, /\+7 701 277 22 33/);
});

test('company details are publicly available as a stable HTML page', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/company-details`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(response.headers.get('cache-control') || '', /no-cache/);
  assert.match(html, /ИП РУБЛЕВА/);
  assert.match(html, /680225402521/);
  assert.match(html, /KZ19722S000009046690/);
  assert.match(html, /bulka\.kazakhstan@mail\.ru/);
});

test('robots and sitemap expose public legal pages to acquiring checks', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const robots = await fetch(`${origin}/robots.txt`);
  const sitemap = await fetch(`${origin}/sitemap.xml`);
  const robotsText = await robots.text();
  const sitemapText = await sitemap.text();

  assert.equal(robots.status, 200);
  assert.match(robots.headers.get('content-type') || '', /text\/plain/);
  assert.match(robotsText, /Sitemap: https:\/\/bulka\.com\.kz\/sitemap\.xml/);
  assert.match(robotsText, /Disallow: \/payment-receipts\//);
  assert.equal(sitemap.status, 200);
  assert.match(sitemap.headers.get('content-type') || '', /xml/);
  for (const route of [
    'public-offer',
    'payment-and-refund',
    'delivery-terms',
    'company-details',
    'privacy',
    'terms',
  ]) {
    for (const prefix of ['', 'kk/', 'en/']) {
      assert.match(sitemapText, new RegExp(`https://bulka\\.com\\.kz/${prefix}${route}`));
    }
  }
});

test('payment policy documents ForteBank, card brands and 3-D Secure', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/payment-and-refund`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /ForteBank/);
  assert.match(html, /Visa/);
  assert.match(html, /Mastercard/);
  assert.match(html, /3‑D Secure/);
  assert.match(html, /href="https:\/\/forte\.kz\/"/);
  assert.match(html, /Торговый\s+чек/);
});

test('legal pages are complete and indexable in Russian, Kazakh and English', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const languages = {
    ru: { prefix: '', title: 'Условия оплаты и возврата' },
    kk: { prefix: '/kk', title: 'Төлем және қайтару шарттары' },
    en: { prefix: '/en', title: 'Payment and refund terms' },
  };
  const slugs = [
    'public-offer',
    'payment-and-refund',
    'delivery-terms',
    'company-details',
    'privacy',
    'terms',
  ];

  for (const [language, expected] of Object.entries(languages)) {
    for (const slug of slugs) {
      const route = `${expected.prefix}/${slug}`;
      const response = await fetch(`${origin}${route}`);
      const html = await response.text();
      const csp = response.headers.get('content-security-policy') || '';

      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('content-language'), language, route);
      assert.match(html, new RegExp(`<html lang="${language}">`), route);
      assert.match(
        html,
        new RegExp(`<link rel="canonical" href="https://bulka\\.com\\.kz${route}"`),
        route,
      );
      assert.match(html, /hreflang="ru"/, route);
      assert.match(html, /hreflang="kk"/, route);
      assert.match(html, /hreflang="en"/, route);
      assert.match(html, /hreflang="x-default"/, route);
      assert.match(csp, /script-src 'none'/, route);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval/, route);
    }
  }

  const russian = await (await fetch(`${origin}/payment-and-refund`)).text();
  const kazakh = await (await fetch(`${origin}/kk/payment-and-refund`)).text();
  const english = await (await fetch(`${origin}/en/payment-and-refund`)).text();
  assert.match(russian, new RegExp(languages.ru.title));
  assert.match(kazakh, new RegExp(languages.kk.title));
  assert.match(english, new RegExp(languages.en.title));
});

test('public offer is available in Russian, Kazakh and English', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const expectations = [
    ['/public-offer', /Публичная оферта интернет-магазина Bulka/, /ИИН: 680225402521/],
    ['/kk/public-offer', /Bulka интернет-дүкенінің жария офертасы/, /ЖСН: 680225402521/],
    ['/en/public-offer', /Bulka online shop public offer/, /IIN: 680225402521/],
  ];

  for (const [route, title, sellerId] of expectations) {
    const response = await fetch(`${origin}${route}`);
    const html = await response.text();
    assert.equal(response.status, 200, route);
    assert.match(html, title, route);
    assert.match(html, sellerId, route);
    assert.match(html, /bulka\.kazakhstan@mail\.ru/, route);
    assert.match(html, /payment-and-refund/, route);
    assert.match(html, /delivery-terms/, route);
    assert.match(html, /privacy/, route);
  }
});

test('privacy policy discloses messaging and AI subprocessors in every language', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  for (const route of ['/privacy', '/kk/privacy', '/en/privacy']) {
    const html = await (await fetch(`http://127.0.0.1:${server.address().port}${route}`)).text();
    assert.match(html, /WhatsApp\/Meta/, route);
    assert.match(html, /Google Gemini/, route);
    assert.match(html, /Alibaba Cloud\/Qwen/, route);
    assert.match(html, /DeepSeek/, route);
    assert.match(html, /ForteBank/, route);
  }
});

test('private receipt route rejects an invalid signed link', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/payment-receipts/117615f9-b35f-4eb4-9f6d-777f2236bb25?token=invalid`,
  );
  assert.equal(response.status, 403);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(response.headers.get('content-security-policy') || '', /style-src 'self'/);
  assert.doesNotMatch(
    response.headers.get('content-security-policy') || '',
    /unsafe-inline|unsafe-eval/,
  );
});

test('admin API GET routes are not swallowed by the admin SPA fallback', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/admin/api/session`);

  assert.equal(response.status, 401);
  assert.match(response.headers.get('content-type') || '', /application\/json/);
  const body = await response.json();
  assert.equal(body.error, 'Admin session is invalid or expired');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});

test('missing admin build assets are not mistaken for the SPA shell', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  const missingAsset = await fetch(`${origin}/admin/assets/OperationsPage-stale-build.js`);
  const missingBody = await missingAsset.text();
  const deepLink = await fetch(`${origin}/admin/operations`);

  assert.equal(missingAsset.status, 404);
  assert.match(missingAsset.headers.get('content-type') || '', /text\/plain/);
  assert.match(missingAsset.headers.get('cache-control') || '', /no-store/);
  assert.doesNotMatch(missingBody, /<!doctype html>/i);
  assert.equal(deepLink.status, 200);
  assert.match(deepLink.headers.get('content-type') || '', /text\/html/);
});

test('client deep links return the Flutter application shell', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  for (const route of [
    '/catalog',
    '/catalog/category/%D0%91%D1%83%D0%BB%D0%BE%D1%87%D0%BA%D0%B8',
    '/catalog/product/test-product?category=%D0%91%D1%83%D0%BB%D0%BE%D1%87%D0%BA%D0%B8',
    '/cart',
    '/promos',
    '/profile',
  ]) {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${route}`);
    const html = await response.text();
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('content-type') || '', /text\/html/, route);
    assert.match(html, /flutter_bootstrap\.js/, route);
  }
});

test('manual iiko menu synchronization is protected by the admin session', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/api/menu/sync`, {
    method: 'POST',
  });

  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Admin session is invalid or expired');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});

test('Kaspi reconnection console is protected by the admin session', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/admin/kaspi-pos/`);
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error, 'Admin session is invalid or expired');
  assert.equal(body.requestId, response.headers.get('x-request-id'));
});

test('embedded Yandex map hides the external map footer labels', async (t) => {
  const previousApiKey = process.env.YANDEX_MAPS_API_KEY;
  process.env.YANDEX_MAPS_API_KEY = 'test_yandex_maps_key_1234567890';
  t.after(() => {
    if (previousApiKey === undefined) delete process.env.YANDEX_MAPS_API_KEY;
    else process.env.YANDEX_MAPS_API_KEY = previousApiKey;
  });

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const response = await fetch(`http://127.0.0.1:${server.address().port}/maps/yandex`);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /suppressMapOpenBlock:true/);
  assert.match(html, /#map \[class\*="-gotoymaps"\]/);
  assert.match(html, /#map \[class\*="-copyright"\]/);
  assert.match(html, /display:none!important/);
  assert.match(html, /new ymaps\.control\.SearchControl/);
  assert.match(html, /Найти город или адрес/);
  assert.match(html, /type:'geocode'/);
});

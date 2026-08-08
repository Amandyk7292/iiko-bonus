const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.BULKA_PUBLIC_APP_DIR = path.join(__dirname, 'fixtures', 'flutter-app');
process.env.BULKA_ADMIN_UI_DIR = path.join(__dirname, 'fixtures', 'admin-ui');
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
  const metricsToken = 'metrics-test-token-that-is-at-least-32-characters';
  process.env.METRICS_BEARER_TOKEN = metricsToken;
  t.after(() => {
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
  const admin = await fetch(`${origin}/admin/operations`);
  const adminCsp = admin.headers.get('content-security-policy') || '';
  const adminScriptPolicy = adminCsp.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] || '';
  assert.equal(admin.status, 200);
  assert.equal(adminScriptPolicy, "'self'");
  assert.doesNotMatch(adminScriptPolicy, /unsafe-inline|unsafe-eval/);

  const client = await fetch(`${origin}/app/`);
  const clientCsp = client.headers.get('content-security-policy') || '';
  const clientScriptPolicy = clientCsp.match(/(?:^|;\s*)script-src ([^;]+)/)?.[1] || '';
  assert.equal(client.status, 200);
  assert.equal(client.headers.get('cross-origin-embedder-policy'), 'credentialless');
  assert.match(clientScriptPolicy, /sha256-/);
  assert.match(clientScriptPolicy, /'wasm-unsafe-eval'/);
  assert.doesNotMatch(clientScriptPolicy, /(?:^|\s)'unsafe-eval'(?:\s|$)/);
  assert.doesNotMatch(clientScriptPolicy, /(?:^|\s)'unsafe-inline'(?:\s|$)/);
});

test('Flutter shell stays fresh while the current versioned bundle is immutable', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  for (const route of [
    '/',
    '/app/catalog/test',
    '/app/app_bootstrap.js',
    '/app/flutter_bootstrap.js',
    '/app/flutter_service_worker.js',
    '/app/main.dart.js',
    '/app/release-version.json',
  ]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('cache-control') || '', /no-store/, route);
  }

  const currentBundle = await fetch(`${origin}/app/main.dart.js?v=fixture-release`);
  assert.equal(currentBundle.status, 200);
  assert.match(currentBundle.headers.get('cache-control') || '', /max-age=31536000/);
  assert.match(currentBundle.headers.get('cache-control') || '', /immutable/);

  const unknownBundle = await fetch(`${origin}/app/main.dart.js?v=another-release`);
  assert.equal(unknownBundle.status, 200);
  assert.match(unknownBundle.headers.get('cache-control') || '', /no-store/);

  const versionedBootstrap = await fetch(`${origin}/app/flutter_bootstrap.js?v=fixture-release`);
  assert.equal(versionedBootstrap.status, 200);
  assert.match(versionedBootstrap.headers.get('cache-control') || '', /no-store/);
});

test('taplink exposes delivery and city links as a fast standalone page', async (t) => {
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;

  const response = await fetch(`${origin}/taplink`);
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/html/);
  assert.match(response.headers.get('cache-control') || '', /no-store/);
  assert.match(html, /href="https:\/\/wa\.me\/77012772233"/);
  assert.match(
    html,
    /href="https:\/\/wa\.me\/77012772233"[\s\S]*?target="_blank"[\s\S]*?rel="noopener noreferrer"/,
  );
  assert.match(html, /https:\/\/2gis\.kz\/aktau\/branches\/70000001035248861/);
  assert.match(html, /https:\/\/2gis\.kz\/astana\/branches\/70000001114429416/);
  assert.match(html, /rel="canonical" href="https:\/\/bulka\.com\.kz\/taplink"/);
  assert.match(html, /<html\b[^>]*\blang="kk"/);
  assert.match(html, /data-language="kk"/);
  assert.match(html, /data-language="ru"/);
  assert.match(html, /Bulka жаныңызда/);
  assert.doesNotMatch(html, /data-i18n="cities"/);
  assert.doesNotMatch(html, /link-icon_aktau|city-icon-baiterek-sphere/);
  assert.match(html, /class="taplink-background-brand"/);
  assert.match(html, /data-taplink-meta="theme-color"[^>]*content="#FFB814"/i);
  assert.match(html, /--taplink-background-color: #FFB814/);
  assert.match(
    html,
    /--taplink-background-image: url\(&quot;https:\/\/bulka\.com\.kz\/taplink\/assets\/mobile-background\.png\?v=20260806-1&quot;\)/,
  );
  assert.match(
    html,
    /class="profile-card taplink-buttons-soft taplink-animation-stagger taplink-effect-shine"/,
  );
  assert.equal((html.match(/\/taplink\/assets\/2gis-icon\.png\?v=20260806-1/g) || []).length, 2);

  for (const asset of [
    '/taplink/styles.css?v=20260807-5',
    '/taplink/app.js?v=20260807-4',
    '/taplink/assets/mobile-background.png?v=20260806-1',
    '/taplink/assets/2gis-icon.png?v=20260806-1',
    '/taplink/assets/brand/bulka_logo.png?v=20260806-1',
    '/taplink/assets/fonts/GolosText-Regular.ttf',
  ]) {
    const assetResponse = await fetch(`${origin}${asset}`);
    assert.equal(assetResponse.status, 200, asset);
    assert.match(assetResponse.headers.get('cache-control') || '', /immutable/, asset);
  }

  const styles = await (await fetch(`${origin}/taplink/styles.css?v=20260807-5`)).text();
  assert.match(styles, /transform-style:\s*preserve-3d/);
  assert.match(styles, /--specular-opacity/);
  assert.match(styles, /radial-gradient\(\s*112px circle at var\(--specular-x\)/);
  assert.match(styles, /mobile-background\.png\?v=20260806-1/);
  assert.match(styles, /background-size:\s*cover/);
  assert.match(
    styles,
    /\.taplink-effect-shine \.link-card:not\(\[data-taplink-effect\]\)::before,[\s\S]*animation:\s*card-sheen-auto 420ms both/,
  );
  assert.match(styles, /\.taplink-animation-stagger \.link-card/);
  assert.match(styles, /\.taplink-effect-lift \.link-card:not\(\[data-taplink-effect\]\):hover/);
  assert.match(styles, /\.taplink-effect-glow \.link-card:not\(\[data-taplink-effect\]\):hover/);
  assert.match(styles, /\.link-card:active\s*\{[\s\S]*?opacity:\s*0\.88/);
  assert.match(styles, /opacity 120ms ease/);
  assert.match(styles, /animation:\s*taplink-rise 300ms backwards/);
  assert.match(styles, /animation-delay:\s*calc\(\(var\(--taplink-order,\s*0\) \+ 1\) \* 32ms\)/);
  assert.doesNotMatch(styles, /card-sheen-auto[^{;\n]*\binfinite\b/);
  assert.doesNotMatch(styles, /\.link-card_city::before[\s\S]*rgba\(255,\s*184,\s*20/);
  assert.match(styles, /@keyframes card-sheen-auto/);
  assert.doesNotMatch(styles, /\.profile-card::before/);
  assert.doesNotMatch(styles, /\.city-label/);
  assert.match(styles, /prefers-reduced-motion:\s*reduce/);
  assert.match(styles, /--taplink-background-image/);
  assert.match(styles, /--taplink-background-color/);
  assert.match(styles, /body\.taplink-background-gradient/);
  assert.match(styles, /--taplink-button-background-color/);
  assert.match(styles, /--taplink-primary-button-background-color/);
  assert.match(
    styles,
    /\.taplink-buttons-outlined \.link-card_standard:not\(\[data-taplink-button-style\]\)/,
  );
  assert.match(
    styles,
    /\.taplink-buttons-solid \.link-card_standard:not\(\[data-taplink-button-style\]\)/,
  );
  assert.match(
    styles,
    /\.link-card_city\s*\{[\s\S]*?background:\s*var\(--taplink-link-background-color,\s*var\(--taplink-button-background-color\)\);[\s\S]*?\}/,
  );
  assert.match(styles, /\.link-copy small\s*\{[\s\S]*?opacity:\s*1/);
  assert.match(
    styles,
    /@media \(max-width:\s*520px\)[\s\S]*?\.profile-header\s*\{[\s\S]*?background:\s*var\(--taplink-surface-color\)/,
  );
  const outlinedButtonRule =
    styles.match(
      /\.taplink-buttons-outlined \.link-card_standard:not\(\[data-taplink-button-style\]\),[\s\S]*?\{([^}]*)\}/,
    )?.[1] || '';
  assert.match(
    outlinedButtonRule,
    /background:\s*var\(--taplink-link-background-color,\s*var\(--taplink-button-background-color\)\)/,
  );
  assert.doesNotMatch(outlinedButtonRule, /color-mix/);
  assert.doesNotMatch(outlinedButtonRule, /box-shadow:\s*none/);
  assert.match(
    styles,
    /\.link-card\[data-taplink-button-style='solid'\] \.link-icon,[\s\S]*background:\s*color-mix\(in srgb,\s*currentColor 13%,\s*transparent\)/,
  );
  assert.match(styles, /--taplink-link-radius,\s*var\(--radius-control\)/);
  assert.match(styles, /\.link-card\[data-taplink-effect='none'\]\s*\{[\s\S]*?box-shadow:\s*none/);

  const script = await (await fetch(`${origin}/taplink/app.js?v=20260807-4`)).text();
  assert.match(script, /DEFAULT_LANGUAGE = 'kk'/);
  assert.match(script, /bulka-taplink-language/);
  assert.match(script, /PUBLIC_CONFIG_URL = '\/api\/public\/taplink'/);
  assert.match(script, /validatePublicPayload/);
  assert.match(script, /validateTaplinkDocument/);
  assert.match(script, /replaceChildren/);
  assert.match(script, /WhatsApp арқылы Bulka жеткізуіне тапсырыс беру/);
  assert.match(script, /Заказать доставку Bulka в WhatsApp/);
  assert.match(script, /const PROXIMITY = 250/);
  assert.match(script, /const FOLLOW_SPEED = 0\.35/);
  assert.match(script, /const BACKGROUND_MODES = new Set/);
  assert.match(script, /const GRADIENT_DIRECTIONS = new Map/);
  assert.match(script, /const ENTRANCE_ANIMATIONS = new Set/);
  assert.match(script, /const BUTTON_EFFECTS = new Set/);
  assert.match(script, /HEX_COLOR_PATTERN/);
  assert.match(script, /contrastRatio/);
  assert.match(script, /contrastRatio\(theme\.mutedTextColor,\s*theme\.surfaceColor\) < 4\.5/);
  assert.match(script, /isValidLinkAppearance/);
  assert.match(
    script,
    /contrastRatio\(appearance\.textColor,\s*appearance\.backgroundColor\) >= 4\.5/,
  );
  assert.match(script, /link\.dataset\.taplinkButtonStyle = block\.appearance\.buttonStyle/);
  assert.match(script, /link\.dataset\.taplinkEffect = block\.appearance\.buttonEffect/);
  assert.match(script, /--taplink-link-background-color/);
  assert.match(script, /--taplink-link-text-color/);
  assert.match(script, /--taplink-link-radius/);
  assert.match(script, /--taplink-background-overlay-color/);
  assert.match(script, /BRAND_BACKGROUND_IMAGE_URL/);
  assert.match(script, /Math\.min\(order,\s*5\)/);
  assert.match(script, /\.taplink-effect-shine \.specular-surface:not\(\[data-taplink-effect\]\)/);
  assert.match(script, /window\.addEventListener\('pointermove'/);
  assert.doesNotMatch(script, /\.innerHTML|insertAdjacentHTML|document\.write/);
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
  assert.match(html, /\/assets\/forte-widget\.js\?v=4/);
  assert.match(html, /\/assets\/forte-widget\.css\?v=4/);
  assert.match(html, /class="phone-frame"/);
  assert.match(html, /class="phone-screen"/);
  assert.match(csp, /script-src 'self' https:\/\/js\.fortebank\.com/);
  assert.match(csp, /frame-src https:\/\/securepayments\.fortebank\.com/);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-eval/);

  const styleResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/assets/forte-widget.css?v=4`,
  );
  const styles = await styleResponse.text();
  assert.equal(styleResponse.status, 200);
  assert.match(styles, /@media \(min-width: 900px\)/);
  assert.match(styles, /--phone-screen-width/);
  assert.match(styles, /\.payment-widget-app:not\(\.payment-widget-app_full\)/);
  assert.match(styles, /html\.embedded-app \.payment-header/);

  const scriptResponse = await fetch(
    `http://127.0.0.1:${server.address().port}/assets/forte-widget.js?v=4`,
  );
  const script = await scriptResponse.text();
  assert.equal(scriptResponse.status, 200);
  assert.match(script, /get\('embedded'\) === 'app'/);
  assert.match(script, /classList\.add\('embedded-app'\)/);
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

test('retired payment endpoints and webhook are not mounted', async (t) => {
  const publicRoutesSource = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'routes', 'public.routes.js'),
    'utf8',
  );
  assert.doesNotMatch(publicRoutesSource, /\/api\/customer\/kaspi-pay|\/webhooks\/kaspi/);

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());

  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const [route, options, expectedStatus] of [
    ['/api/customer/kaspi-pay/availability', undefined, 401],
    ['/api/customer/kaspi-pay/create', { method: 'POST', body: '{}' }, 401],
    ['/webhooks/kaspi', { method: 'POST', body: '{}' }, 404],
    ['/kaspi-pos/api/payment/availability', undefined, 404],
  ]) {
    const response = await fetch(`${origin}${route}`, {
      ...options,
      headers: options ? { 'Content-Type': 'application/json' } : undefined,
    });
    assert.equal(response.status, expectedStatus, `${route} must stay unmounted`);
  }
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

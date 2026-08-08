const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');
const canonicalLink =
  '<link rel="icon" type="image/png" sizes="48x48" href="/favicon.png?v=20260730-1"';

const staticHtmlFiles = [
  'BulkaAndroid/web/index.html',
  'admin-ui/index.html',
  'public/app.html',
  'public/courier.html',
  'public/forte-widget.html',
  'public/taplink/index.html',
  'public/legal/account-deletion.en.html',
  'public/legal/account-deletion.html',
  'public/legal/account-deletion.kk.html',
  'public/legal/company-details.html',
  'public/legal/delivery-terms.html',
  'public/legal/payment-and-refund.html',
  'public/legal/privacy.html',
  'public/legal/terms.html',
];

const dynamicHtmlSources = [
  'src/controllers/wallet.controller.js',
  'src/middlewares/site-access.middleware.js',
  'src/routes/yandex-map.routes.js',
  'src/services/legal-page.service.js',
  'src/services/payment-receipt.service.js',
];

test('every Bulka browser surface uses the catalog favicon', () => {
  for (const relativePath of [...staticHtmlFiles, ...dynamicHtmlSources]) {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    const normalizedSource = source.replace(/\s+/g, ' ');
    assert.ok(
      normalizedSource.includes(canonicalLink),
      `${relativePath} must use the catalog favicon`,
    );
    assert.doesNotMatch(source, /sizes="660x660"[^>]*bulka-wallet-logo/);
  }
});

test('canonical favicon is a real 48 by 48 PNG and legacy requests share it', () => {
  const favicon = fs.readFileSync(path.join(root, 'BulkaAndroid/web/favicon.png'));
  assert.deepEqual([...favicon.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.equal(favicon.readUInt32BE(16), 48);
  assert.equal(favicon.readUInt32BE(20), 48);

  const appSource = fs.readFileSync(path.join(root, 'src/app.js'), 'utf8');
  assert.match(appSource, /app\.get\('\/favicon\.png', sendBrandPng\('favicon\.png'\)\)/);
  assert.match(appSource, /app\.get\('\/favicon\.ico', sendBrandPng\('favicon\.png'\)\)/);
});

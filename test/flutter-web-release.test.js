const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

test('production web build disables Flutter PWA caching', () => {
  const buildScript = fs.readFileSync(path.join(root, 'build_web.ps1'), 'utf8');
  assert.match(buildScript, /flutter build web[\s\S]*--pwa-strategy=none/);
});

test('web bootstrap removes only the legacy Flutter worker and caches before loading Flutter', () => {
  const index = fs.readFileSync(path.join(root, 'BulkaAndroid', 'web', 'index.html'), 'utf8');
  const appBootstrap = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'web', 'app_bootstrap.js'),
    'utf8',
  );
  const flutterBootstrap = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'web', 'flutter_bootstrap.js'),
    'utf8',
  );

  assert.match(index, /<script src="app_bootstrap\.js"><\/script>/);
  assert.doesNotMatch(index, /<script src="flutter_bootstrap\.js"/);
  assert.match(appBootstrap, /flutter_service_worker\.js/);
  assert.match(appBootstrap, /registration\.unregister\(\)/);
  assert.match(appBootstrap, /flutter-app-cache/);
  assert.match(appBootstrap, /flutter-app-manifest/);
  assert.match(appBootstrap, /flutter-temp-cache/);
  assert.match(appBootstrap, /\.finally\(loadFlutter\)/);
  assert.doesNotMatch(appBootstrap, /firebase-messaging-sw\.js/);
  assert.doesNotMatch(appBootstrap, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(flutterBootstrap, /await _flutter\.loader\.load\(\)/);
  assert.doesNotMatch(flutterBootstrap, /serviceWorkerSettings|flutter_service_worker_version/);
});

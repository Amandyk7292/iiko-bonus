const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { finalizeFlutterWebBuild, sha256File } = require('../scripts/finalize-flutter-web');

const root = path.join(__dirname, '..');

test('production web build disables Flutter PWA caching', () => {
  const buildScript = fs.readFileSync(path.join(root, 'build_web.ps1'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(buildScript, /flutter build web[\s\S]*--pwa-strategy=none/);
  assert.match(workflow, /flutter build web[\s\S]*--no-wasm-dry-run/);
  assert.doesNotMatch(workflow, /flutter build web[^\r\n]*--wasm/);
});

test('web bootstrap versions every mutable Flutter entrypoint and checks for new releases', () => {
  const index = fs.readFileSync(path.join(root, 'BulkaAndroid', 'web', 'index.html'), 'utf8');
  const appBootstrap = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'web', 'app_bootstrap.js'),
    'utf8',
  );
  const flutterBootstrap = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'web', 'flutter_bootstrap.js'),
    'utf8',
  );

  assert.match(index, /<script src="app_bootstrap\.js\?v=__BULKA_RELEASE_VERSION__"><\/script>/);
  assert.doesNotMatch(index, /<script src="flutter_bootstrap\.js"/);
  assert.match(index, /class="app-loading-label"/);
  assert.match(index, /class="app-loading-bar"/);
  assert.match(index, /window\.setTimeout\(showLoadingError,\s*30000\)/);
  assert.doesNotMatch(index, /setTimeout\([^)]*,\s*12000\)/);
  assert.match(index, /src="assets\/assets\/brand\/bulka_logo\.png"/);
  assert.doesNotMatch(index, /bulka_logo\.png\?v=/);
  assert.match(appBootstrap, /flutter_service_worker\.js/);
  assert.match(appBootstrap, /registration\.unregister\(\)/);
  assert.match(appBootstrap, /flutter-app-cache/);
  assert.match(appBootstrap, /flutter-app-manifest/);
  assert.match(appBootstrap, /flutter-temp-cache/);
  assert.match(appBootstrap, /cacheName\.startsWith\('flutter-'\)/);
  assert.match(appBootstrap, /release-version\.json/);
  assert.match(appBootstrap, /cache:\s*'no-store'/);
  assert.match(appBootstrap, /flutter_bootstrap\.js/);
  assert.match(appBootstrap, /__bulka_release/);
  assert.match(appBootstrap, /window\.location\.replace/);
  assert.match(appBootstrap, /visibilitychange/);
  assert.match(appBootstrap, /setInterval/);
  assert.doesNotMatch(appBootstrap, /firebase-messaging-sw\.js/);
  assert.doesNotMatch(appBootstrap, /localStorage|sessionStorage|indexedDB|document\.cookie/);
  assert.match(flutterBootstrap, /^\{\{flutter_js\}\}\r?\n\{\{flutter_build_config\}\}/);
  assert.match(flutterBootstrap, /mutableEntrypointFields/);
  assert.match(flutterBootstrap, /build\[field\]/);
  assert.match(flutterBootstrap, /mainJsPath/);
  assert.match(flutterBootstrap, /mainWasmPath/);
  assert.match(flutterBootstrap, /jsSupportRuntimePath/);
  assert.match(flutterBootstrap, /encodeURIComponent/);
  assert.match(flutterBootstrap, /await _flutter\.loader\.load\(\)/);
  assert.doesNotMatch(flutterBootstrap, /serviceWorkerSettings|flutter_service_worker_version/);
});

test('cleanup worker takes over immediately and removes only legacy Flutter caches', () => {
  const worker = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'web', 'flutter_service_worker.js'),
    'utf8',
  );

  assert.match(worker, /event\.waitUntil\(self\.skipWaiting\(\)\)/);
  assert.match(worker, /self\.clients\.claim\(\)/);
  assert.match(worker, /includeUncontrolled:\s*true/);
  assert.match(worker, /self\.registration\.unregister\(\)/);
  assert.match(worker, /client\.navigate\(client\.url\)/);
  assert.match(worker, /keys\.filter\(isFlutterCache\)/);
  assert.doesNotMatch(worker, /keys\.map\(\(key\) => caches\.delete/);
});

test('Flutter finalizer restores the cleanup worker and writes a hashed release manifest', (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-flutter-release-'));
  t.after(() => fs.rmSync(directory, { force: true, recursive: true }));
  fs.writeFileSync(
    path.join(directory, 'index.html'),
    '<script src="app_bootstrap.js?v=__BULKA_RELEASE_VERSION__"></script>',
  );
  fs.writeFileSync(path.join(directory, 'main.dart.js'), 'current-app-bundle');
  fs.writeFileSync(path.join(directory, 'flutter_service_worker.js'), '');

  const manifest = finalizeFlutterWebBuild({
    directory,
    version: 'abcdef123456',
  });
  const finalizedIndex = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  const finalizedWorker = fs.readFileSync(
    path.join(directory, 'flutter_service_worker.js'),
    'utf8',
  );
  const storedManifest = JSON.parse(
    fs.readFileSync(path.join(directory, 'release-version.json'), 'utf8'),
  );

  assert.match(finalizedIndex, /app_bootstrap\.js\?v=abcdef123456/);
  assert.doesNotMatch(finalizedIndex, /__BULKA_RELEASE_VERSION__/);
  assert.match(finalizedWorker, /self\.skipWaiting/);
  assert.equal(finalizedWorker.length > 100, true);
  assert.deepEqual(storedManifest, manifest);
  assert.equal(manifest.version, 'abcdef123456');
  assert.equal(manifest.mainSha256, sha256File(path.join(directory, 'main.dart.js')));
});

test('release scripts finalize and verify the public Flutter bundle', () => {
  const buildScript = fs.readFileSync(path.join(root, 'build_web.ps1'), 'utf8');
  const windowsDeploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-vps.ps1'), 'utf8');
  const remoteDeploy = fs.readFileSync(path.join(root, 'scripts', 'deploy-release.sh'), 'utf8');
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');

  assert.match(buildScript, /finalize-flutter-web\.js/);
  assert.match(workflow, /finalize-flutter-web\.js/);
  assert.match(windowsDeploy, /release-version\.json/);
  assert.match(windowsDeploy, /publicFlutterHash/);
  assert.match(windowsDeploy, /remoteFlutterHash/);
  assert.match(remoteDeploy, /flutter_release_details=\$\(/);
  assert.match(remoteDeploy, /expected_flutter_hash/);
  assert.match(remoteDeploy, /production_flutter_hash/);
  assert.match(remoteDeploy, /verify_client_shell\(\)/);
  assert.match(remoteDeploy, /Accept: application\/json/);
  assert.match(remoteDeploy, /SITE_IP_NOT_ALLOWED/);
  assert.equal(
    (remoteDeploy.match(/verify_client_shell 'http:\/\/127\.0\.0\.1:\d+\/app\/'/g) || []).length,
    3,
  );
  assert.doesNotMatch(remoteDeploy, /curl -fsS 'http:\/\/127\.0\.0\.1:\d+\/app\/'/);
});

test('Flutter CI installs the static QA server before browser tests', () => {
  const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'ci.yml'), 'utf8');
  const installIndex = workflow.indexOf('name: Install QA server dependencies');
  const browserQaIndex = workflow.indexOf('name: Run Flutter browser QA matrix');
  const fullApplicationIndex = workflow.indexOf('name: Prepare full application browser tests');

  assert.notEqual(installIndex, -1);
  assert.notEqual(browserQaIndex, -1);
  assert.notEqual(fullApplicationIndex, -1);
  assert.ok(installIndex < browserQaIndex);
  assert.ok(browserQaIndex < fullApplicationIndex);
  assert.match(workflow, /qa_server_ready=0[\s\S]*\[\[ "\$qa_server_ready" != 1 \]\]/);
  assert.match(workflow, /full_app_ready=0[\s\S]*\[\[ "\$full_app_ready" != 1 \]\]/);
});

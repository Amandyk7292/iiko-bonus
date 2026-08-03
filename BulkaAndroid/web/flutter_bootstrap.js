{{flutter_js}}
{{flutter_build_config}}

const bulkaBootstrapUrl = new URL(
  document.currentScript?.src || 'flutter_bootstrap.js',
  window.location.href,
);
const bulkaReleaseVersion = bulkaBootstrapUrl.searchParams.get('v') || '';
if (/^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/.test(bulkaReleaseVersion)) {
  const mutableEntrypointFields = ['mainJsPath', 'mainWasmPath', 'jsSupportRuntimePath'];
  for (const build of _flutter.buildConfig.builds) {
    for (const field of mutableEntrypointFields) {
      const assetPath = build[field];
      if (!assetPath) continue;
      const separator = assetPath.includes('?') ? '&' : '?';
      build[field] =
        `${assetPath}${separator}v=${encodeURIComponent(bulkaReleaseVersion)}`;
    }
  }
}

// FlutterFire normally creates inline script elements for these SDK modules.
// Load them explicitly so production CSP can keep script-src unsafe-inline off.
window.flutterfire_ignore_scripts = ['core', 'messaging'];
window.bulkaFirebaseModulesReady = new Promise((resolve) => window.setTimeout(resolve, 1200))
  .then(() =>
    Promise.all([
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js'),
      import('https://www.gstatic.com/firebasejs/12.15.0/firebase-messaging.js'),
    ]),
  )
  .then(([core, messaging]) => {
    window.firebase_core = core;
    window.firebase_messaging = messaging;
  });

(async () => {
  await _flutter.loader.load();
})();

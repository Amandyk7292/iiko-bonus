{{flutter_js}}
{{flutter_build_config}}

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
  await _flutter.loader.load({
    serviceWorkerSettings: {
      serviceWorkerVersion: {{flutter_service_worker_version}},
    },
  });
})();

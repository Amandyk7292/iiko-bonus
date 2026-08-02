(() => {
  const flutterCacheNames = new Set([
    'flutter-app-cache',
    'flutter-app-manifest',
    'flutter-temp-cache',
  ]);

  const workerScriptUrl = (registration) =>
    registration.active?.scriptURL ||
    registration.waiting?.scriptURL ||
    registration.installing?.scriptURL ||
    '';

  const isLegacyFlutterWorker = (registration) => {
    try {
      return new URL(workerScriptUrl(registration), window.location.href).pathname.endsWith(
        '/flutter_service_worker.js',
      );
    } catch (_) {
      return false;
    }
  };

  const removeLegacyFlutterOfflineCache = async () => {
    if ('serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(
        registrations
          .filter(isLegacyFlutterWorker)
          .map((registration) => registration.unregister()),
      );
    }

    if ('caches' in window) {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames
          .filter((cacheName) => flutterCacheNames.has(cacheName))
          .map((cacheName) => window.caches.delete(cacheName)),
      );
    }
  };

  const loadFlutter = () => {
    const script = document.createElement('script');
    script.src = 'flutter_bootstrap.js';
    script.async = true;
    script.addEventListener('error', () => {
      window.dispatchEvent(new Event('bulka-flutter-bootstrap-error'));
    });
    document.body.append(script);
  };

  removeLegacyFlutterOfflineCache()
    .catch((error) => {
      console.warn('Could not remove the legacy Flutter offline cache:', error);
    })
    .finally(loadFlutter);
})();

(() => {
  const releaseVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/;
  const reloadParameter = '__bulka_release';
  const releaseCheckIntervalMs = 60_000;
  const flutterCacheNames = new Set([
    'flutter-app-cache',
    'flutter-app-manifest',
    'flutter-temp-cache',
  ]);
  const isFlutterCache = (cacheName) =>
    flutterCacheNames.has(cacheName) || cacheName.startsWith('flutter-');
  const bootstrapScriptUrl = new URL(
    document.currentScript?.src || 'app_bootstrap.js',
    window.location.href,
  );
  const releaseVersionCandidate = bootstrapScriptUrl.searchParams.get('v') || '';
  const releaseVersion = releaseVersionPattern.test(releaseVersionCandidate)
    ? releaseVersionCandidate
    : 'development';
  let releaseReloadStarted = false;

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

  const versionedAssetUrl = (relativePath) => {
    const url = new URL(relativePath, document.baseURI);
    if (releaseVersion !== 'development') {
      url.searchParams.set('v', releaseVersion);
    }
    return url.toString();
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
        cacheNames.filter(isFlutterCache).map((cacheName) => window.caches.delete(cacheName)),
      );
    }
  };

  const clearSatisfiedReloadGuard = () => {
    const currentUrl = new URL(window.location.href);
    if (currentUrl.searchParams.get(reloadParameter) !== releaseVersion) return;
    currentUrl.searchParams.delete(reloadParameter);
    window.history.replaceState(window.history.state, '', currentUrl);
  };

  const checkForNewRelease = async () => {
    if (releaseReloadStarted || releaseVersion === 'development') return false;
    const manifestUrl = new URL('release-version.json', document.baseURI);
    manifestUrl.searchParams.set('check', Date.now().toString());

    try {
      const response = await fetch(manifestUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) return false;
      const manifest = await response.json();
      const nextVersion = String(manifest?.version || '');
      if (!releaseVersionPattern.test(nextVersion)) return false;
      if (nextVersion === releaseVersion) {
        clearSatisfiedReloadGuard();
        return false;
      }

      const targetUrl = new URL(window.location.href);
      if (targetUrl.searchParams.get(reloadParameter) === nextVersion) {
        return false;
      }

      releaseReloadStarted = true;
      await removeLegacyFlutterOfflineCache();
      targetUrl.searchParams.set(reloadParameter, nextVersion);
      window.location.replace(targetUrl.toString());
      return true;
    } catch (error) {
      console.warn('Could not check the current Bulka release:', error);
      return false;
    }
  };

  const loadFlutter = () => {
    const script = document.createElement('script');
    script.src = versionedAssetUrl('flutter_bootstrap.js');
    script.async = true;
    script.addEventListener('error', () => {
      window.dispatchEvent(new Event('bulka-flutter-bootstrap-error'));
    });
    document.body.append(script);
  };

  const startReleaseChecks = () => {
    window.setInterval(() => void checkForNewRelease(), releaseCheckIntervalMs);
    window.addEventListener('focus', () => void checkForNewRelease());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkForNewRelease();
    });
  };

  const startApplication = async () => {
    try {
      await removeLegacyFlutterOfflineCache();
    } catch (error) {
      console.warn('Could not remove the legacy Flutter offline cache:', error);
    }
    const reloading = await checkForNewRelease();
    if (!reloading) loadFlutter();
    startReleaseChecks();
  };

  void startApplication();
})();

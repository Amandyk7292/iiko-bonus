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
  let releaseCheckPending = false;

  const within = (task, milliseconds) => new Promise((resolve) => {
    const timer = window.setTimeout(resolve, milliseconds);
    Promise.resolve(task).catch((error) => console.warn('Startup maintenance:', error))
      .finally(() => { window.clearTimeout(timer); resolve(); });
  });

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
    if (releaseReloadStarted || releaseCheckPending || releaseVersion === 'development') return false;
    releaseCheckPending = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    const manifestUrl = new URL('release-version.json', document.baseURI);
    manifestUrl.searchParams.set('check', Date.now().toString());

    try {
      const response = await fetch(manifestUrl, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
        signal: controller.signal,
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
      await within(removeLegacyFlutterOfflineCache(), 500);
      targetUrl.searchParams.set(reloadParameter, nextVersion);
      window.location.replace(targetUrl.toString());
      return true;
    } catch (error) {
      console.warn('Could not check the current Bulka release:', error);
      return false;
    } finally {
      releaseCheckPending = false;
      window.clearTimeout(timeout);
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

  const refreshFontManifest = async () => {
    const key = 'bulka.font-manifest-release';
    try {
      if (window.localStorage.getItem(key) === releaseVersion) return;
    } catch (_) {
      // Restricted storage must not prevent startup.
    }
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 1000);
    try {
      // Refresh the same URL Flutter reads, including the browser HTTP cache.
      const response = await fetch(new URL('assets/FontManifest.json', document.baseURI), {
        cache: 'reload', credentials: 'same-origin', signal: controller.signal,
      });
      if (!response.ok) return;
      await response.arrayBuffer();
      try { window.localStorage.setItem(key, releaseVersion); } catch (_) {}
    } catch (error) {
      console.warn('Could not refresh the font manifest:', error);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const startReleaseChecks = () => {
    window.setInterval(() => void checkForNewRelease(), releaseCheckIntervalMs);
    window.addEventListener('focus', () => void checkForNewRelease());
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void checkForNewRelease();
    });
  };

  const startApplication = async () => {
    // Maintenance runs together with a strict budget, never as a network waterfall.
    await Promise.all([
      within(removeLegacyFlutterOfflineCache(), 500),
      within(refreshFontManifest(), 1000),
    ]);
    loadFlutter();
    void checkForNewRelease();
    startReleaseChecks();
  };

  void startApplication();
})();

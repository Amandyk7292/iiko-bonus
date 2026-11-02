(() => {
  const releaseVersionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{5,63}$/;
  const reloadParameter = '__bulka_release';
  const releaseCheckIntervalMs = 60_000;
  const desktopVersionPattern = /^\d+\.\d+\.\d+$/;
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
  let releaseReloadDeferred = false;
  let releasePromptVersion = '';
  let releasePromptNode = null;
  let staffUpdateCheckPending = false;
  let staffUpdatePromptVersion = '';
  let staffUpdatePromptNode = null;
  let staffUpdateDismissedVersion = '';
  const pageUrl = new URL(window.location.href);
  const isDesktopStaff = pageUrl.searchParams.get('desktop') === '1';
  const installedStaffVersion = desktopVersionPattern.test(
    pageUrl.searchParams.get('desktopVersion') || '',
  )
    ? pageUrl.searchParams.get('desktopVersion')
    : '1.0.1';

  const within = (task, milliseconds) =>
    new Promise((resolve) => {
      const timer = window.setTimeout(resolve, milliseconds);
      Promise.resolve(task)
        .catch((error) => console.warn('Startup maintenance:', error))
        .finally(() => {
          window.clearTimeout(timer);
          resolve();
        });
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

  const removeNotice = (notice) => {
    if (notice?.parentNode) notice.parentNode.removeChild(notice);
  };

  const compareVersions = (left, right) => {
    const leftParts = left.split('.').map(Number);
    const rightParts = right.split('.').map(Number);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference) return difference;
    }
    return 0;
  };

  const createNotice = (title, message, primaryLabel, onPrimary, secondaryLabel, onSecondary) => {
    const notice = document.createElement('section');
    notice.setAttribute('role', 'status');
    notice.setAttribute('aria-live', 'polite');
    notice.style.cssText = [
      'position:fixed',
      'z-index:2147483647',
      'left:16px',
      'right:16px',
      'bottom:calc(16px + env(safe-area-inset-bottom, 0px))',
      'max-width:640px',
      'margin:0 auto',
      'padding:16px',
      'border:1px solid #e8d9c3',
      'border-radius:18px',
      'background:#fffaf1',
      'box-shadow:0 12px 36px rgba(62, 35, 19, .22)',
      'color:#4b2918',
      'font:15px/1.45 Arial, sans-serif',
      'box-sizing:border-box',
    ].join(';');

    const heading = document.createElement('strong');
    heading.textContent = title;
    heading.style.cssText = 'display:block;font-size:16px;margin-bottom:5px';
    const detail = document.createElement('div');
    detail.textContent = message;
    detail.style.cssText = 'margin-bottom:12px';
    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end';

    const secondary = document.createElement('button');
    secondary.type = 'button';
    secondary.textContent = secondaryLabel;
    secondary.style.cssText = 'border:1px solid #d9c6ae;border-radius:12px;background:#fff;color:#4b2918;padding:10px 14px;font:inherit;font-weight:600;cursor:pointer';
    secondary.addEventListener('click', onSecondary);
    const primary = document.createElement('button');
    primary.type = 'button';
    primary.textContent = primaryLabel;
    primary.style.cssText = 'border:0;border-radius:12px;background:#f4ad17;color:#4b2918;padding:10px 14px;font:inherit;font-weight:700;cursor:pointer';
    primary.addEventListener('click', onPrimary);

    actions.append(secondary, primary);
    notice.append(heading, detail, actions);
    document.body.append(notice);
    return notice;
  };

  const showReleaseNotice = (nextVersion) => {
    if (releaseReloadStarted || releaseReloadDeferred) return;
    if (releasePromptNode && releasePromptVersion === nextVersion) return;
    removeNotice(releasePromptNode);
    releasePromptVersion = nextVersion;
    releasePromptNode = createNotice(
      'Доступна новая версия Bulka',
      'Страница не обновится сама. Сначала завершите и сохраните текущую работу.',
      'Обновить страницу',
      async () => {
        const confirmed = window.confirm(
          'Обновить страницу сейчас? Если заказ или форма ещё не сохранены, данные могут потеряться.',
        );
        if (!confirmed) return;
        releaseReloadStarted = true;
        const targetUrl = new URL(window.location.href);
        targetUrl.searchParams.set(reloadParameter, nextVersion);
        await within(removeLegacyFlutterOfflineCache(), 500);
        window.location.replace(targetUrl.toString());
      },
      'Позже',
      () => {
        releaseReloadDeferred = true;
        removeNotice(releasePromptNode);
        releasePromptNode = null;
      },
    );
  };

  const checkForStaffInstallerUpdate = async () => {
    if (!isDesktopStaff || staffUpdateCheckPending) return false;
    staffUpdateCheckPending = true;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 3000);
    const manifestUrl = new URL('staff-release.json', document.baseURI);
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
      const latestVersion = String(manifest?.version || '');
      if (!desktopVersionPattern.test(latestVersion) ||
          compareVersions(latestVersion, installedStaffVersion) <= 0) return false;
      if (staffUpdateDismissedVersion === latestVersion) return false;
      const installerUrl = new URL(String(manifest?.installerUrl || ''), window.location.origin);
      if (installerUrl.origin !== window.location.origin ||
          !installerUrl.pathname.startsWith('/downloads/') ||
          !installerUrl.pathname.endsWith('.exe')) return false;
      if (staffUpdatePromptNode && staffUpdatePromptVersion === latestVersion) return false;
      removeNotice(staffUpdatePromptNode);
      staffUpdatePromptVersion = latestVersion;
      staffUpdatePromptNode = createNotice(
        'Доступно обновление кассового приложения',
        `Версия ${latestVersion}. Скачайте установщик, закройте Bulka и запустите его. Профиль и вход сохранятся.`,
        'Скачать установщик',
        () => {
          const link = document.createElement('a');
          link.href = installerUrl.toString();
          link.download = '';
          link.rel = 'noopener';
          document.body.append(link);
          link.click();
          removeNotice(link);
        },
        'Позже',
        () => {
          staffUpdateDismissedVersion = latestVersion;
          removeNotice(staffUpdatePromptNode);
          staffUpdatePromptNode = null;
        },
      );
      return true;
    } catch (error) {
      console.warn('Could not check the Bulka Staff installer:', error);
      return false;
    } finally {
      staffUpdateCheckPending = false;
      window.clearTimeout(timeout);
    }
  };

  const checkForNewRelease = async () => {
    if (releaseReloadStarted || releaseCheckPending || releaseVersion === 'development')
      return false;
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

      showReleaseNotice(nextVersion);
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
        cache: 'reload',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      if (!response.ok) return;
      await response.arrayBuffer();
      try {
        window.localStorage.setItem(key, releaseVersion);
      } catch (_) {}
    } catch (error) {
      console.warn('Could not refresh the font manifest:', error);
    } finally {
      window.clearTimeout(timeout);
    }
  };

  const startReleaseChecks = () => {
    const checkReleases = () => {
      void checkForNewRelease();
      void checkForStaffInstallerUpdate();
    };
    window.setInterval(checkReleases, releaseCheckIntervalMs);
    window.addEventListener('focus', checkReleases);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') checkReleases();
    });
  };

  const startApplication = async () => {
    // Fetch renderer and Dart code while the font manifest refreshes. The
    // engine initializer waits for this bounded promise before reading fonts.
    window.bulkaFontManifestReady = within(refreshFontManifest(), 1000);
    await within(removeLegacyFlutterOfflineCache(), 500);
    const preload = document.createElement('link');
    preload.rel = 'preload';
    preload.as = 'script';
    preload.href = versionedAssetUrl('main.dart.js');
    document.head.append(preload);
    loadFlutter();
    void checkForNewRelease();
    void checkForStaffInstallerUpdate();
    startReleaseChecks();
  };

  void startApplication();
})();

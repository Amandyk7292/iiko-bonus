'use strict';
(() => {
  const element = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.hash.slice(1));
  let token = params.get('t') || '';
  try {
    token ||= sessionStorage.getItem('bulka-closing-qr') || '';
  } catch {
    /* Keep the QR in memory when browser storage is disabled. */
  }
  if (params.has('t')) {
    try {
      sessionStorage.setItem('bulka-closing-qr', token);
    } catch {
      /* The open page still works without browser storage. */
    }
    history.replaceState(null, '', location.pathname);
  }
  let context,
    kind,
    stream,
    photos = [],
    sending = false,
    uploadId,
    captureBusy = false;
  let device = { status: 'unregistered' },
    deviceBranch,
    deviceAllowed = false,
    deviceBusy = false,
    deviceFailed = false,
    pairingCode,
    pairingExpiresAt,
    pollTimer,
    deviceController,
    deviceGeneration = 0,
    sessionController,
    sessionGeneration = 0,
    authGeneration = 0,
    pageHidden = false;
  const deviceStatuses = new Set([
    'unregistered',
    'pending',
    'active',
    'revoked',
    'expired',
    'wrong_branch',
  ]);
  const deviceErrors = {
    PHOTO_REPORT_DEVICE_REQUIRED: 'unregistered',
    PHOTO_REPORT_DEVICE_REVOKED: 'revoked',
    PHOTO_REPORT_DEVICE_EXPIRED: 'expired',
    PHOTO_REPORT_DEVICE_BRANCH_MISMATCH: 'wrong_branch',
    PHOTO_REPORT_BRANCH_MISMATCH: 'wrong_branch',
  };
  const formatDate = (date) =>
    new Intl.DateTimeFormat('ru-KZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(date + 'T12:00:00Z'));
  const show = (section) =>
    ['loading', 'device', 'intro', 'capture', 'success'].forEach((id) => {
      element(id).hidden = id !== section;
    });
  const error = (message = '') => {
    element('error').textContent = message;
    element('error').hidden = !message;
  };
  const stopCamera = () => {
    stream?.getTracks().forEach((track) => track.stop());
    stream = undefined;
    element('camera').srcObject = null;
    element('take-photo').hidden = true;
    element('enable-camera').hidden = false;
  };
  const clearPhotos = () => {
    photos.forEach((photo) => URL.revokeObjectURL(photo.url));
    photos = [];
    uploadId = undefined;
    renderPhotos();
  };
  const stopDeviceChecks = () => {
    clearTimeout(pollTimer);
    pollTimer = undefined;
    deviceGeneration++;
    deviceController?.abort();
    deviceController = undefined;
    deviceBusy = false;
  };
  const clearReportState = () => {
    authGeneration++;
    sessionGeneration++;
    sessionController?.abort();
    sessionController = undefined;
    context = undefined;
    kind = undefined;
    stopCamera();
    clearPhotos();
    element('send-status').textContent = '';
  };
  const setText = (id, text) => {
    if (element(id).textContent !== text) element(id).textContent = text;
  };
  function renderDevice() {
    const messages = {
      unregistered: ['Планшет не подключён', 'Подключите этот планшет к точке.'],
      pending: ['Ждём подтверждения', 'Покажите код администратору.'],
      active: ['Планшет подключён', ''],
      revoked: ['Доступ отключён', 'Администратор отключил этот планшет.'],
      expired: ['Подключение истекло', 'Получите новый код для подключения.'],
      wrong_branch: ['Планшет другой точки', 'Откройте QR своей точки.'],
    };
    const [title, message] = messages[device.status];
    setText('device-branch', deviceBranch?.name || 'Планшет точки');
    setText('device-city', deviceBranch?.city || '');
    setText('device-status', title);
    setText('device-message', message);
    const hasCode = device.status === 'pending' && /^\d{6}$/.test(pairingCode || '');
    element('pairing').hidden = !hasCode;
    setText('pairing-code', hasCode ? pairingCode : '');
    const expiry = pairingExpiresAt && new Date(pairingExpiresAt);
    setText(
      'pairing-expiry',
      hasCode && expiry && !Number.isNaN(expiry.getTime())
        ? 'Действует до ' +
            new Intl.DateTimeFormat('ru-KZ', { hour: '2-digit', minute: '2-digit' }).format(expiry)
        : '',
    );
    element('enroll-device').textContent =
      device.status === 'expired' ? 'Новый код' : 'Подключить планшет';
    element('enroll-device').hidden = ['pending', 'wrong_branch', 'active'].includes(device.status);
    element('enroll-device').disabled = deviceBusy || !token;
    element('check-device').disabled = deviceBusy || !token;
    element('device').setAttribute('aria-busy', String(deviceBusy));
  }
  function returnToDevice(code) {
    deviceBranch ||= context?.branch;
    stopDeviceChecks();
    deviceAllowed = false;
    device = { status: deviceErrors[code] || 'unregistered' };
    pairingCode = pairingExpiresAt = undefined;
    deviceFailed = false;
    clearReportState();
    error();
    element('retry').hidden = true;
    renderDevice();
    show('device');
  }
  function scheduleDeviceCheck() {
    clearTimeout(pollTimer);
    if (device.status !== 'pending' || deviceFailed || document.hidden || pageHidden) return;
    pollTimer = setTimeout(() => {
      pollTimer = undefined;
      if (document.hidden || pageHidden || device.status !== 'pending' || deviceFailed) return;
      void checkDevice();
    }, 5000);
  }
  async function request(path, options = {}) {
    const controller = new AbortController();
    const external = options.signal;
    const abort = () => controller.abort();
    if (external?.aborted) abort();
    else external?.addEventListener('abort', abort, { once: true });
    const deadline = setTimeout(abort, path === '/submit' ? 180000 : 20000);
    try {
      const response = await fetch('/api/branch-reports' + path, {
        ...options,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: {
          ...options.headers,
          ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
        },
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        const caught = new Error(
          body.error ||
            (response.status === 413
              ? 'Слишком большой отчёт. Сделайте снимки заново.'
              : 'Не удалось отправить. Попробуйте ещё раз.'),
        );
        caught.code = body.code;
        caught.isApiError = true;
        throw caught;
      }
      return body;
    } finally {
      clearTimeout(deadline);
      external?.removeEventListener('abort', abort);
    }
  }
  async function checkDevice(method = 'GET') {
    if (pageHidden || (method === 'POST' && (deviceBusy || device.status === 'wrong_branch')))
      return;
    stopDeviceChecks();
    const generation = deviceGeneration;
    const controller = new AbortController();
    deviceController = controller;
    deviceBusy = true;
    deviceFailed = false;
    error();
    element('retry').hidden = true;
    renderDevice();
    if (!deviceAllowed) show('device');
    try {
      if (!token) throw new Error('Откройте QR своей точки.');
      const response = await request('/device', {
        method,
        headers: { 'X-Bulka-Report-Token': token },
        ...(method === 'POST' ? { body: '{}' } : {}),
        signal: controller.signal,
      });
      if (generation !== deviceGeneration || controller.signal.aborted || pageHidden) return;
      if (
        response.success !== true ||
        !response.branch ||
        !deviceStatuses.has(response.device?.status)
      )
        throw new Error('Не удалось проверить подключение. Попробуйте ещё раз.');
      device = response.device;
      deviceBranch = response.branch;
      pairingCode = response.pairingCode == null ? undefined : String(response.pairingCode);
      pairingExpiresAt = response.expiresAt || response.device.expiresAt;
      deviceAllowed = device.status === 'active';
      if (!deviceAllowed) {
        clearReportState();
        renderDevice();
        show('device');
      } else if (!context) {
        await load();
      }
      if (generation === deviceGeneration) scheduleDeviceCheck();
    } catch (caught) {
      if (generation !== deviceGeneration || controller.signal.aborted || pageHidden) return;
      deviceFailed = true;
      if (!deviceAllowed) show('device');
      error(
        !token
          ? 'Откройте QR своей точки.'
          : caught.isApiError
            ? caught.message
            : 'Нет связи. Проверьте интернет и повторите проверку.',
      );
    } finally {
      if (generation === deviceGeneration) {
        deviceBusy = false;
        deviceController = undefined;
        renderDevice();
      }
    }
  }
  async function load(shift) {
    if (!deviceAllowed) {
      renderDevice();
      show('device');
      return;
    }
    sessionController?.abort();
    const controller = new AbortController();
    sessionController = controller;
    const generation = ++sessionGeneration;
    const authorization = authGeneration;
    show('loading');
    error();
    element('retry').hidden = true;
    try {
      const loaded = await request('/session', {
        method: 'POST',
        headers: { 'X-Bulka-Report-Token': token },
        body: JSON.stringify(shift ? { shift } : {}),
        signal: controller.signal,
      });
      if (
        generation !== sessionGeneration ||
        authorization !== authGeneration ||
        !deviceAllowed ||
        controller.signal.aborted ||
        pageHidden
      )
        return;
      context = loaded;
      element('branch').textContent = context.branch.name;
      element('city').textContent = context.branch.city;
      element('date').textContent = formatDate(context.date);
      element('report-mode').textContent = context.branch.roundTheClock
        ? 'Передача смены'
        : 'Закрытие точки';
      element('shifts').hidden = !context.branch.roundTheClock;
      document.querySelectorAll('[data-shift]').forEach((button) => {
        button.setAttribute('aria-pressed', String(button.dataset.shift === context.shift));
        const day = context.branch.photoDayShiftStart;
        const night = context.branch.photoNightShiftStart;
        button.querySelector('small').textContent =
          button.dataset.shift === 'day' ? day + '–' + night : night + '–' + day;
      });
      document.querySelectorAll('[data-kind]').forEach((button) => {
        const report = context.reports.find((r) => r.kind === button.dataset.kind);
        button.classList.toggle('done', Boolean(report));
        button.disabled = Boolean(report);
        element(button.dataset.kind + '-status').textContent = report
          ? '✓ Отправлен · ' + report.photoCount + ' фото'
          : 'Ещё не отправлен';
      });
      show('intro');
    } catch (caught) {
      if (
        generation !== sessionGeneration ||
        authorization !== authGeneration ||
        controller.signal.aborted ||
        pageHidden
      )
        return;
      if (deviceErrors[caught.code]) {
        returnToDevice(caught.code);
        return;
      }
      element('loading').hidden = true;
      error(caught.isApiError ? caught.message : 'Нет связи с сервером. Проверьте интернет.');
      element('retry').hidden = false;
    } finally {
      if (generation === sessionGeneration) sessionController = undefined;
    }
  }
  function renderPhotos() {
    element('previews').replaceChildren();
    photos.forEach((photo, index) => {
      const figure = document.createElement('figure');
      figure.className = 'preview';
      const image = document.createElement('img');
      image.src = photo.url;
      image.alt = 'Снимок ' + (index + 1);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', 'Удалить снимок ' + (index + 1));
      remove.disabled = sending;
      remove.addEventListener('click', () => {
        if (sending) return;
        URL.revokeObjectURL(photo.url);
        photos.splice(index, 1);
        uploadId = undefined;
        renderPhotos();
      });
      figure.append(image, remove);
      element('previews').append(figure);
    });
    element('count').textContent = photos.length + ' / 10';
    if (!sending)
      element('send').textContent = photos.length
        ? 'Отправить ' + photos.length + ' фото'
        : 'Отправить отчёт';
    element('take-photo').disabled =
      !deviceAllowed || photos.length >= 10 || sending || captureBusy;
    element('send').disabled =
      !deviceAllowed || !context || !photos.length || sending || captureBusy;
    element('back').disabled = sending || captureBusy;
    element('enable-camera').disabled = sending || captureBusy;
  }
  async function openCamera() {
    if (!deviceAllowed || !context || element('capture').hidden || sending) return;
    const authorization = authGeneration;
    error();
    if (!navigator.mediaDevices?.getUserMedia) {
      error('Камера недоступна. Откройте QR в Safari или Chrome на планшете через HTTPS.');
      return;
    }
    element('enable-camera').disabled = true;
    element('enable-camera').textContent = 'Открываем…';
    try {
      const active = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      });
      if (
        !deviceAllowed ||
        authorization !== authGeneration ||
        element('capture').hidden ||
        sending ||
        pageHidden ||
        document.hidden
      ) {
        active.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = active;
      element('camera').srcObject = stream;
      await element('camera').play();
      if (
        !deviceAllowed ||
        authorization !== authGeneration ||
        element('capture').hidden ||
        pageHidden ||
        document.hidden
      ) {
        active.getTracks().forEach((track) => track.stop());
        return;
      }
      element('enable-camera').hidden = true;
      element('take-photo').hidden = false;
      element('camera-hint').hidden = true;
    } catch (caught) {
      if (!deviceAllowed || authorization !== authGeneration || pageHidden) return;
      stopCamera();
      error(
        caught.name === 'NotAllowedError'
          ? 'Разрешите камеру в настройках браузера для bulka.com.kz и нажмите «Открыть камеру».'
          : 'Не удалось открыть камеру. Закройте другие приложения с камерой и попробуйте снова.',
      );
    } finally {
      element('enable-camera').disabled = false;
      element('enable-camera').textContent = 'Открыть камеру';
      renderPhotos();
    }
  }
  async function takePhoto() {
    const video = element('camera');
    if (
      !deviceAllowed ||
      !context ||
      element('capture').hidden ||
      sending ||
      captureBusy ||
      photos.length >= 10 ||
      !stream ||
      !video.videoWidth ||
      video.readyState < 2
    )
      return;
    captureBusy = true;
    const authorization = authGeneration;
    renderPhotos();
    error();
    try {
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
      if (
        !deviceAllowed ||
        authorization !== authGeneration ||
        element('capture').hidden ||
        pageHidden
      )
        return;
      if (!blob || blob.size > 2000000)
        throw new Error('Не удалось сохранить снимок. Попробуйте ещё раз.');
      photos.push({ blob, url: URL.createObjectURL(blob), capturedAt: Date.now() });
      uploadId = undefined;
      element('send-status').textContent = 'Снимок добавлен.';
    } catch (caught) {
      error(caught.message);
    } finally {
      captureBusy = false;
      renderPhotos();
    }
  }
  async function send() {
    if (!deviceAllowed || !context || !kind || sending || !photos.length || captureBusy) return;
    const authorization = authGeneration;
    const reportContext = context;
    const reportKind = kind;
    sending = true;
    stopCamera();
    error();
    renderPhotos();
    element('send').textContent = 'Отправляем…';
    element('send-status').textContent = 'Не закрывайте страницу, пока снимки отправляются.';
    uploadId ||= crypto.randomUUID();
    const body = new FormData();
    body.append('uploadId', uploadId);
    body.append('kind', reportKind);
    photos.forEach((photo, index) => body.append('photos', photo.blob, 'camera-' + index + '.jpg'));
    try {
      await request('/submit', {
        method: 'POST',
        headers: { 'X-Bulka-Report-Session': reportContext.sessionToken },
        body,
      });
      if (!deviceAllowed || authorization !== authGeneration || pageHidden) return;
      element('success-detail').textContent =
        (reportKind === 'hall' ? 'Зал' : 'Пекарь') +
        ' · ' +
        reportContext.branch.name +
        ' · ' +
        formatDate(reportContext.date) +
        ' · ' +
        photos.length +
        ' фото';
      clearPhotos();
      show('success');
    } catch (caught) {
      if (authorization !== authGeneration || pageHidden) return;
      if (deviceErrors[caught.code]) {
        returnToDevice(caught.code);
      } else if (caught.code === 'PHOTO_REPORT_ALREADY_SUBMITTED') {
        clearPhotos();
        await load(reportContext.shift);
      } else {
        error(
          (caught.isApiError && caught.message) ||
            'Связь прервалась. Снимки сохранены на этой странице — повторите отправку.',
        );
        element('send-status').textContent = 'Снимки останутся здесь до успешной отправки.';
      }
    } finally {
      sending = false;
      element('send').textContent = 'Отправить отчёт';
      renderPhotos();
    }
  }
  document.querySelectorAll('[data-kind]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!deviceAllowed || sending || !context) return;
      kind = button.dataset.kind;
      clearPhotos();
      error();
      show('capture');
      element('capture-title').textContent =
        kind === 'hall' ? 'Фотоотчёт зала' : 'Фотоотчёт пекаря';
      element('capture-date').textContent =
        context.branch.name +
        ' · ' +
        formatDate(context.date) +
        (context.shift === 'daily'
          ? ''
          : ' · ' + (context.shift === 'day' ? '1 смена' : '2 смена'));
      element('send-status').textContent = '';
      void openCamera();
    }),
  );
  element('enable-camera').addEventListener('click', openCamera);
  element('take-photo').addEventListener('click', takePhoto);
  element('send').addEventListener('click', send);
  element('back').addEventListener('click', () => {
    if (
      sending ||
      captureBusy ||
      (photos.length && !confirm('Снимки ещё не отправлены. Вернуться и убрать их?'))
    )
      return;
    stopCamera();
    clearPhotos();
    error();
    show('intro');
  });
  document.querySelectorAll('[data-shift]').forEach((button) =>
    button.addEventListener('click', () => {
      if (!sending && button.dataset.shift !== context?.shift) void load(button.dataset.shift);
    }),
  );
  element('next-report').addEventListener('click', () => load(context?.shift));
  element('retry').addEventListener('click', () =>
    deviceAllowed ? load(context?.shift) : checkDevice(),
  );
  element('enroll-device').addEventListener('click', () => checkDevice('POST'));
  element('check-device').addEventListener('click', () => checkDevice());
  window.addEventListener('pagehide', () => {
    pageHidden = true;
    stopCamera();
    stopDeviceChecks();
    sessionGeneration++;
    sessionController?.abort();
  });
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    pageHidden = false;
    if (!document.hidden) void checkDevice();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      stopCamera();
      stopDeviceChecks();
      sessionGeneration++;
      sessionController?.abort();
      renderDevice();
    } else if (!pageHidden && !deviceFailed) {
      void checkDevice();
    }
  });
  window.addEventListener('beforeunload', (event) => {
    if (photos.length || sending) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  void checkDevice();
})();

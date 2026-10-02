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
  const formatDate = (date) =>
    new Intl.DateTimeFormat('ru-KZ', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(new Date(date + 'T12:00:00Z'));
  const show = (section) =>
    ['loading', 'intro', 'capture', 'success'].forEach((id) => {
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
  async function request(path, options = {}) {
    const response = await fetch('/api/branch-reports' + path, {
      ...options,
      credentials: 'omit',
      cache: 'no-store',
      headers: {
        ...options.headers,
        ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      },
      signal: AbortSignal.timeout(path === '/submit' ? 180000 : 20000),
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
      throw caught;
    }
    return body;
  }
  async function load() {
    show('loading');
    error();
    element('retry').hidden = true;
    try {
      context = await request('/session', {
        method: 'POST',
        headers: { 'X-Bulka-Report-Token': token },
        body: '{}',
      });
      element('branch').textContent = context.branch.name;
      element('city').textContent = context.branch.city;
      element('date').textContent = formatDate(context.date);
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
      element('loading').hidden = true;
      error(caught.message || 'Нет связи с сервером. Проверьте интернет.');
      element('retry').hidden = false;
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
      const caption = document.createElement('figcaption');
      caption.textContent =
        'Снято в ' +
        new Intl.DateTimeFormat('ru-KZ', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Almaty',
        }).format(new Date(photo.capturedAt));
      figure.append(image, remove, caption);
      element('previews').append(figure);
    });
    element('count').textContent = photos.length + ' / 10';
    element('remaining').textContent =
      photos.length === 10
        ? 'Максимум 10 снимков'
        : photos.length
          ? 'Можно добавить ещё ' + (10 - photos.length)
          : 'Добавьте хотя бы один';
    element('take-photo').disabled = photos.length >= 10 || sending || captureBusy;
    element('send').disabled = !photos.length || sending || captureBusy;
    element('back').disabled = sending || captureBusy;
    element('enable-camera').disabled = sending || captureBusy;
  }
  async function openCamera() {
    error();
    if (!navigator.mediaDevices?.getUserMedia) {
      error('Камера недоступна. Откройте QR в Safari или Chrome на планшете через HTTPS.');
      return;
    }
    element('enable-camera').disabled = true;
    try {
      const active = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1600 },
          height: { ideal: 1200 },
        },
        audio: false,
      });
      if (element('capture').hidden || sending) {
        active.getTracks().forEach((track) => track.stop());
        return;
      }
      stream = active;
      element('camera').srcObject = stream;
      await element('camera').play();
      element('enable-camera').hidden = true;
      element('take-photo').hidden = false;
      element('camera-hint').textContent =
        'Снимайте зал или рабочее место. Можно удалить неудачный снимок и переснять.';
    } catch (caught) {
      stopCamera();
      error(
        caught.name === 'NotAllowedError'
          ? 'Разрешите камеру в настройках браузера для bulka.com.kz и нажмите «Открыть камеру».'
          : 'Не удалось открыть камеру. Закройте другие приложения с камерой и попробуйте снова.',
      );
    } finally {
      element('enable-camera').disabled = false;
      renderPhotos();
    }
  }
  async function takePhoto() {
    const video = element('camera');
    if (
      sending ||
      captureBusy ||
      photos.length >= 10 ||
      !stream ||
      !video.videoWidth ||
      video.readyState < 2
    )
      return;
    captureBusy = true;
    renderPhotos();
    error();
    try {
      const scale = Math.min(1, 1600 / Math.max(video.videoWidth, video.videoHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
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
    if (sending || !photos.length || captureBusy) return;
    sending = true;
    stopCamera();
    error();
    renderPhotos();
    element('send').textContent = 'Отправляем…';
    element('send-status').textContent = 'Не закрывайте страницу, пока снимки отправляются.';
    uploadId ||= crypto.randomUUID();
    const body = new FormData();
    body.append('uploadId', uploadId);
    body.append('kind', kind);
    photos.forEach((photo, index) => body.append('photos', photo.blob, 'camera-' + index + '.jpg'));
    try {
      await request('/submit', {
        method: 'POST',
        headers: { 'X-Bulka-Report-Session': context.sessionToken },
        body,
      });
      element('success-detail').textContent =
        (kind === 'hall' ? 'Зал' : 'Пекарь') +
        ' · ' +
        context.branch.name +
        ' · ' +
        formatDate(context.date) +
        ' · ' +
        photos.length +
        ' фото';
      clearPhotos();
      show('success');
    } catch (caught) {
      if (caught.code === 'PHOTO_REPORT_ALREADY_SUBMITTED') {
        clearPhotos();
        await load();
      } else {
        error(
          caught.message ||
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
      if (sending || !context) return;
      kind = button.dataset.kind;
      clearPhotos();
      error();
      show('capture');
      element('capture-title').textContent =
        kind === 'hall' ? 'Фотоотчёт зала' : 'Фотоотчёт пекаря';
      element('capture-date').textContent = context.branch.name + ' · ' + formatDate(context.date);
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
  element('next-report').addEventListener('click', load);
  element('retry').addEventListener('click', load);
  window.addEventListener('pagehide', stopCamera);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
  });
  window.addEventListener('beforeunload', (event) => {
    if (photos.length || sending) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  void load();
})();

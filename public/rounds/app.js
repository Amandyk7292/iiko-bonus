(function () {
  'use strict';
  const M = window.BulkaRounds;
  const C = window.BulkaRoundsCamera;
  const $ = (id) => document.getElementById(id);
  const state = {
    inspector: null,
    csrf: '',
    date: M.localDate(),
    rounds: [],
    round: null,
    detailId: null,
    epoch: 0,
    uploads: new Map(),
    comments: new Map(),
    taskErrors: new Map(),
    completing: new Set(),
    camera: null,
  };
  const dateCalendar = window.BulkaCalendar.attach($('round-date'), {
    clearable: false,
    format: (value) => (value === M.localDate() ? 'Сегодня · ' : '') + M.displayDate(value),
  });
  const capture = new C.Capture($('camera-video'));
  let cameraGeneration = 0;
  let lastFocus = null;
  const icon = (name) =>
    '<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><use href="/assets/brand/bulka-icons.svg#' +
    name +
    '" /></svg>';
  const E = M.escape;
  function announce(message) {
    $('announcement').textContent = message;
  }
  function errorMessage(error) {
    if (error.status === 401) return 'Войдите в свой аккаунт снова.';
    if (error.status === 413) return 'Файл слишком большой. Максимум — 8 МБ.';
    if (error.status === 429) return 'Слишком много запросов. Подождите немного.';
    if (error.status >= 500) return 'Сервер временно недоступен. Попробуйте снова.';
    return (
      error.userMessage ||
      'Не удалось соединиться с сервером. Проверьте интернет и попробуйте снова.'
    );
  }
  function failPage(error) {
    $('loading').hidden = true;
    $('page-error').textContent = errorMessage(error);
    $('page-error').hidden = false;
    $('retry-page').hidden = false;
  }
  function clearError() {
    $('page-error').hidden = true;
    $('retry-page').hidden = true;
  }
  function apiError(data, status) {
    const error = new Error('API request failed');
    error.status = status;
    if (typeof data?.error === 'string' && !/^[A-Z_\d]+$/.test(data.error) && status < 500)
      error.userMessage = data.error;
    return error;
  }
  async function request(path, options = {}) {
    const headers = { Accept: 'application/json' };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
      if (state.csrf) headers['x-csrf-token'] = state.csrf;
    }
    const response = await fetch('/api/rounds' + path, {
      credentials: 'same-origin',
      cache: 'no-store',
      method: options.method || 'GET',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw apiError(null, response.status || 502);
    }
    if (!response.ok || data.success === false) {
      if (response.status === 401 && state.inspector) showLogin('Войдите в свой аккаунт снова.');
      throw apiError(data, response.status);
    }
    return data;
  }
  function view(name) {
    ['login', 'dashboard', 'detail'].forEach((id) => {
      $(id).hidden = id !== name;
    });
    $('loading').hidden = true;
    $('logout').hidden = !state.inspector;
    clearError();
  }
  function disposeUpload(upload) {
    if (upload.xhr) upload.xhr.abort();
    if (upload.preview) URL.revokeObjectURL(upload.preview);
  }
  function abortUploads() {
    state.uploads.forEach((upload) => {
      if (upload.xhr) {
        upload.status = 'error';
        upload.error = 'Загрузка прервана. Повторите отправку.';
        upload.xhr.abort();
        upload.xhr = null;
      }
    });
  }
  function showLogin(message = '') {
    state.epoch++;
    closeCamera();
    abortUploads();
    state.uploads.forEach(disposeUpload);
    state.uploads.clear();
    state.comments.clear();
    state.taskErrors.clear();
    state.inspector = null;
    state.csrf = '';
    state.round = null;
    state.detailId = null;
    state.rounds = [];
    $('round-detail').replaceChildren();
    $('round-list').replaceChildren();
    $('password').value = '';
    view('login');
    $('login-error').textContent = message;
    $('login-error').hidden = !message;
  }
  function badge(round) {
    const status = M.statuses[round.status] ? round.status : 'pending';
    return (
      '<span class="status ' +
      status +
      '">' +
      (status === 'completed' ? '✓ ' : '') +
      M.statuses[status] +
      '</span>'
    );
  }
  function renderList() {
    $('greeting').textContent = state.inspector.name;
    dateCalendar.setValue(state.date);
    const summary = M.summary(state.rounds);
    $('day-progress').hidden = !summary.total;
    $('day-progress').classList.toggle('is-complete', summary.allDone);
    $('day-progress').innerHTML =
      '<div class="progress-heading"><strong>' +
      (summary.allDone ? '✓ Все обходы выполнены' : 'Обходы на день') +
      '</strong><span>' +
      summary.completed +
      ' из ' +
      summary.total +
      '</span></div><progress max="' +
      Math.max(1, summary.total) +
      '" value="' +
      summary.completed +
      '" aria-label="Выполненные обходы"></progress>';
    $('round-list').innerHTML = state.rounds.length
      ? state.rounds
          .map(
            (round) =>
              '<button type="button" class="round-card ' +
              E(round.status) +
              '" data-round="' +
              E(round.id) +
              '">' +
              '<div class="card-top"><div><span class="card-subtitle">' +
              E(round.city) +
              '</span><strong class="card-title">' +
              E(round.branchName) +
              '</strong></div>' +
              badge(round) +
              '</div>' +
              '<div class="card-bottom"><span>' +
              E(round.title) +
              '<br>' +
              Number(round.completedTasks || 0) +
              ' / ' +
              Number(round.totalTasks || 0) +
              ' заданий' +
              (round.status !== 'completed' && round.status !== 'cancelled'
                ? ' · до ' + M.deadline(round.deadline)
                : '') +
              (round.completedLate ? '<br>Сдано после срока' : '') +
              '</span><span class="card-arrow" aria-hidden="true">›</span></div></button>',
          )
          .join('')
      : '<div class="empty">' +
        icon('ClipboardCheck') +
        '<strong>На этот день обходов нет</strong><p>Новые задания появятся здесь.</p></div>';
  }
  async function loadList(quiet = false) {
    if (!state.inspector) return;
    const epoch = ++state.epoch;
    closeCamera();
    if (!quiet) abortUploads();
    state.round = null;
    state.detailId = null;
    view('dashboard');
    dateCalendar.setValue(state.date);
    if (!quiet) {
      $('round-list').innerHTML =
        '<div class="loading" role="status"><span class="spinner" aria-hidden="true"></span>Загрузка обходов…</div>';
      $('day-progress').hidden = true;
    }
    try {
      const data = await request('/?date=' + encodeURIComponent(state.date));
      if (epoch !== state.epoch) return;
      state.rounds = Array.isArray(data.rounds) ? data.rounds : [];
      renderList();
    } catch (error) {
      if (epoch === state.epoch && state.inspector) failPage(error);
    }
  }
  function uploadHtml(task) {
    const upload = state.uploads.get(task.id);
    if (!upload) return '';
    const preview =
      upload.kind === 'photo'
        ? '<img src="' + E(upload.preview) + '" alt="Снятое фото" />'
        : '<video src="' +
          E(upload.preview) +
          '" controls playsinline preload="metadata" aria-label="Снятое видео"></video>';
    return (
      '<div class="upload-box">' +
      preview +
      '<span data-upload-label="' +
      E(task.id) +
      '" role="status">' +
      E(upload.status === 'uploading' ? 'Загрузка… ' + upload.progress + '%' : upload.error) +
      '</span>' +
      (upload.status === 'uploading'
        ? '<progress data-upload-progress="' +
          E(task.id) +
          '" max="100" value="' +
          upload.progress +
          '" aria-label="Загрузка файла"></progress>'
        : '<div class="upload-actions"><button class="primary" type="button" data-retry="' +
          E(task.id) +
          '">Повторить загрузку</button><button class="secondary" type="button" data-discard="' +
          E(task.id) +
          '">Удалить</button></div>') +
      '</div>'
    );
  }
  function taskHtml(task, index) {
    const round = state.round;
    const done = Boolean(task.completedAt),
      canEdit = M.editable(round) && !done;
    const uploading = state.uploads.has(task.id);
    const evidence = Array.isArray(task.evidence) ? task.evidence : [];
    const ready = M.evidenceReady(task),
      busy = state.completing.has(task.id);
    const hints = {
      none: '',
      photo: 'Нужно фото',
      video: 'Нужно видео · до 60 секунд',
      photo_video: 'Нужны фото и видео · до 60 секунд',
    };
    const media = evidence
      .map((entry) => {
        const url = M.mediaUrl(entry);
        if (!url) return '';
        return (
          '<div class="evidence-item">' +
          (entry.kind === 'photo'
            ? '<a href="' +
              E(url) +
              '" target="_blank" rel="noopener"><img src="' +
              E(url) +
              '" alt="Фото к заданию ' +
              (index + 1) +
              '" loading="lazy" /></a>'
            : '<video src="' +
              E(url) +
              '" controls playsinline preload="metadata" aria-label="Видео к заданию ' +
              (index + 1) +
              '"></video>') +
          (canEdit
            ? '<button class="remove-media" type="button" data-remove="' +
              E(entry.id) +
              '" data-task="' +
              E(task.id) +
              '" aria-label="Удалить ' +
              (entry.kind === 'photo' ? 'фото' : 'видео') +
              '">×</button>'
            : '') +
          '</div>'
        );
      })
      .join('');
    const buttonDisabled = uploading || busy || evidence.length >= 6;
    const captureButtons =
      canEdit && task.evidenceType !== 'none'
        ? '<div class="capture-actions">' +
          (['photo', 'photo_video'].includes(task.evidenceType)
            ? '<button class="secondary" type="button" data-capture="photo" data-task="' +
              E(task.id) +
              '"' +
              (buttonDisabled ? ' disabled' : '') +
              '>' +
              icon('Camera') +
              'Сделать фото</button>'
            : '') +
          (['video', 'photo_video'].includes(task.evidenceType)
            ? '<button class="secondary" type="button" data-capture="video" data-task="' +
              E(task.id) +
              '"' +
              (buttonDisabled ? ' disabled' : '') +
              '>' +
              icon('play-circle') +
              'Снять видео</button>'
            : '') +
          '</div>'
        : '';
    return (
      '<article class="task' +
      (done ? ' completed' : '') +
      '" id="task-' +
      E(task.id) +
      '">' +
      '<div class="task-heading"><span class="task-number" aria-hidden="true">' +
      (done ? '✓' : index + 1) +
      '</span><h3>' +
      E(task.title) +
      '</h3></div>' +
      (task.instructions ? '<p class="instructions">' + E(task.instructions) + '</p>' : '') +
      (canEdit && hints[task.evidenceType]
        ? '<p class="evidence-hint" id="hint-' +
          E(task.id) +
          '">' +
          hints[task.evidenceType] +
          (evidence.length >= 6 ? ' · максимум 6 файлов' : '') +
          '</p>'
        : '') +
      (media ? '<div class="evidence-grid">' + media + '</div>' : '') +
      captureButtons +
      uploadHtml(task) +
      (canEdit
        ? '<details class="comment-toggle"><summary>Добавить комментарий</summary><label class="sr-only" for="comment-' +
          E(task.id) +
          '">Комментарий к заданию ' +
          (index + 1) +
          '</label><textarea id="comment-' +
          E(task.id) +
          '" data-comment="' +
          E(task.id) +
          '" maxlength="2000" placeholder="Необязательно">' +
          E(state.comments.get(task.id) || '') +
          '</textarea></details>' +
          '<button class="primary complete-task" type="button" data-complete="' +
          E(task.id) +
          '"' +
          (!ready || uploading || busy ? ' disabled' : '') +
          ' aria-label="Выполнить задание ' +
          E(task.title) +
          '">' +
          icon('Check') +
          (busy ? 'Сохраняем…' : 'Выполнить') +
          '</button>'
        : '') +
      (done
        ? '<p class="task-done">' +
          icon('CheckCircle2') +
          'Выполнено</p>' +
          (task.comment ? '<p class="task-comment">' + E(task.comment) + '</p>' : '')
        : '') +
      (state.taskErrors.has(task.id)
        ? '<p class="error" role="alert">' + E(state.taskErrors.get(task.id)) + '</p>'
        : '') +
      '</article>'
    );
  }
  function renderDetail() {
    const round = state.round;
    if (!round) return;
    // A task can have been completed in another session while this page was away.
    state.uploads.forEach((upload, taskId) => {
      const task = round.tasks?.find((entry) => entry.id === taskId);
      if (task && (!M.editable(round) || task.completedAt)) {
        disposeUpload(upload);
        state.uploads.delete(taskId);
      }
    });
    $('round-detail').innerHTML =
      '<header class="round-heading ' +
      E(round.status) +
      '"><div class="card-top"><p class="eyebrow">' +
      E(round.city) +
      '</p>' +
      badge(round) +
      '</div>' +
      '<h1>' +
      E(round.branchName) +
      '</h1><p>' +
      E(round.title) +
      '</p><div class="card-bottom"><span>' +
      M.displayDate(round.date) +
      (round.status !== 'completed' && round.status !== 'cancelled'
        ? ' · до ' + M.deadline(round.deadline)
        : '') +
      '</span><span>' +
      Number(round.completedTasks || 0) +
      ' / ' +
      Number(round.totalTasks || 0) +
      '</span></div>' +
      '<progress max="' +
      Math.max(1, round.totalTasks || 0) +
      '" value="' +
      Number(round.completedTasks || 0) +
      '" aria-label="Выполненные задания"></progress>' +
      (round.completedLate ? '<p class="late-note">Сдано после срока</p>' : '') +
      '</header><div class="task-list">' +
      (round.tasks || []).map(taskHtml).join('') +
      '</div>';
  }
  async function loadDetail(id) {
    closeCamera();
    abortUploads();
    const epoch = ++state.epoch;
    state.round = null;
    state.detailId = id;
    view('detail');
    $('round-detail').innerHTML = '<div class="loading" role="status">Загрузка заданий…</div>';
    try {
      const data = await request('/' + encodeURIComponent(id));
      if (epoch !== state.epoch) return;
      state.round = data.round;
      renderDetail();
      $('content').focus();
      window.scrollTo(0, 0);
    } catch (error) {
      if (epoch === state.epoch && state.inspector) failPage(error);
    }
  }
  function taskById(id) {
    return state.round?.tasks?.find((task) => task.id === id);
  }
  function closeCamera() {
    cameraGeneration++;
    capture.close();
    state.camera = null;
    if ($('camera-dialog').open) $('camera-dialog').close();
    if (lastFocus?.isConnected) lastFocus.focus();
    lastFocus = null;
  }
  async function enableCamera() {
    if (!state.camera) return;
    const generation = ++cameraGeneration,
      { kind, facing } = state.camera;
    $('capture-photo').hidden = kind !== 'photo';
    $('record-video').hidden = kind !== 'video';
    $('stop-video').hidden = true;
    $('recording-time').hidden = true;
    $('switch-camera').hidden = false;
    $('capture-photo').disabled = true;
    $('record-video').disabled = true;
    $('switch-camera').disabled = true;
    $('camera-error').hidden = true;
    $('camera-retry').hidden = true;
    $('camera-message').hidden = false;
    $('camera-message').textContent = 'Открываем камеру…';
    try {
      if (!(await capture.open(kind, facing)) || generation !== cameraGeneration) return;
      $('camera-message').hidden = true;
      $('capture-photo').disabled = false;
      $('record-video').disabled = false;
      $('switch-camera').disabled = false;
    } catch (error) {
      if (generation !== cameraGeneration) return;
      capture.close();
      $('camera-message').hidden = true;
      $('camera-error').textContent = C.cameraError(error);
      $('camera-error').hidden = false;
      $('camera-retry').hidden = false;
    }
  }
  function openCamera(taskId, kind, button) {
    const task = taskById(taskId);
    if (!task || task.completedAt || !M.editable(state.round) || state.uploads.has(taskId)) return;
    if (typeof $('camera-dialog').showModal !== 'function') {
      state.taskErrors.set(
        taskId,
        'Камера недоступна в этом браузере. Откройте страницу в актуальном Safari или Chrome.',
      );
      renderDetail();
      return;
    }
    closeCamera();
    lastFocus = button;
    state.camera = { taskId, kind, facing: 'environment' };
    $('camera-title').textContent = kind === 'photo' ? 'Фото' : 'Видео · до 60 секунд';
    $('capture-photo').hidden = kind !== 'photo';
    $('record-video').hidden = kind !== 'video';
    $('stop-video').hidden = true;
    $('switch-camera').hidden = false;
    $('recording-time').hidden = true;
    $('camera-dialog').showModal();
    enableCamera();
  }
  async function acceptCapture(blob, taskId, kind, generation) {
    if (generation !== cameraGeneration || !taskById(taskId)) return;
    if (blob.size > C.MAX_BYTES) throw { userMessage: 'Максимальный размер файла — 8 МБ.' };
    closeCamera();
    state.uploads.set(taskId, {
      blob,
      kind,
      preview: URL.createObjectURL(blob),
      status: 'uploading',
      progress: 0,
      xhr: null,
    });
    renderDetail();
    await uploadMedia(taskId);
  }
  function uploadMedia(taskId) {
    const upload = state.uploads.get(taskId),
      task = taskById(taskId);
    if (!upload || !task || !state.inspector || !state.csrf || !M.editable(state.round)) return;
    const epoch = state.epoch;
    upload.status = 'uploading';
    upload.progress = 0;
    upload.error = '';
    state.taskErrors.delete(taskId);
    renderDetail();
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      upload.xhr = xhr;
      xhr.open('POST', '/api/rounds/tasks/' + encodeURIComponent(taskId) + '/media');
      xhr.setRequestHeader('x-csrf-token', state.csrf);
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.timeout = 180000;
      xhr.withCredentials = true;
      xhr.upload.onprogress = (event) => {
        if (!event.lengthComputable || epoch !== state.epoch) return;
        upload.progress = Math.min(95, Math.round((event.loaded / event.total) * 95));
        const progress = document.querySelector('[data-upload-progress="' + taskId + '"]');
        const label = document.querySelector('[data-upload-label="' + taskId + '"]');
        if (progress) progress.value = upload.progress;
        if (label)
          label.textContent =
            upload.progress >= 95 ? 'Проверяем файл…' : 'Загрузка… ' + upload.progress + '%';
      };
      const failed = (error) => {
        upload.xhr = null;
        upload.status = 'error';
        upload.error = errorMessage(error);
        if (epoch === state.epoch) renderDetail();
        resolve();
      };
      xhr.onerror = () => failed({});
      xhr.ontimeout = () =>
        failed({ userMessage: 'Загрузка заняла слишком много времени. Повторите отправку.' });
      xhr.onabort = () => failed({ userMessage: 'Загрузка прервана. Повторите отправку.' });
      xhr.onload = () => {
        upload.xhr = null;
        let data;
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          return failed({ status: xhr.status || 502 });
        }
        if (xhr.status === 401) {
          showLogin('Войдите в свой аккаунт снова.');
          return resolve();
        }
        if (
          xhr.status < 200 ||
          xhr.status >= 300 ||
          !data.success ||
          !data.media?.id ||
          !M.mediaUrl(data.media)
        )
          return failed(apiError(data, xhr.status || 502));
        if (epoch !== state.epoch || !state.inspector) return resolve();
        const currentTask = taskById(taskId);
        if (currentTask) {
          currentTask.evidence ||= [];
          if (!currentTask.evidence.some((entry) => entry.id === data.media.id))
            currentTask.evidence.push(data.media);
        }
        disposeUpload(upload);
        state.uploads.delete(taskId);
        renderDetail();
        announce('Файл прикреплён. Можно выполнить задание.');
        resolve();
      };
      const form = new FormData();
      form.append(
        'file',
        upload.blob,
        upload.kind === 'photo'
          ? 'photo.jpg'
          : upload.blob.type.includes('mp4')
            ? 'video.mp4'
            : 'video.webm',
      );
      xhr.send(form);
    });
  }
  async function completeTask(id) {
    const task = taskById(id);
    if (
      !task ||
      !M.editable(state.round) ||
      task.completedAt ||
      !M.evidenceReady(task) ||
      state.uploads.has(id) ||
      state.completing.has(id)
    )
      return;
    const epoch = state.epoch;
    state.completing.add(id);
    state.taskErrors.delete(id);
    renderDetail();
    try {
      const data = await request('/tasks/' + encodeURIComponent(id) + '/complete', {
        method: 'POST',
        body: { comment: state.comments.get(id) || '' },
      });
      if (epoch !== state.epoch) return;
      state.round = data.round;
      state.comments.delete(id);
      announce(state.round.status === 'completed' ? 'Обход выполнен.' : 'Задание выполнено.');
    } catch (error) {
      if (epoch === state.epoch) state.taskErrors.set(id, errorMessage(error));
    } finally {
      state.completing.delete(id);
      if (epoch === state.epoch) renderDetail();
    }
  }
  async function removeMedia(id, taskId, button) {
    const task = taskById(taskId);
    if (!task || task.completedAt || !M.editable(state.round)) return;
    const epoch = state.epoch;
    button.disabled = true;
    try {
      await request('/media/' + encodeURIComponent(id), { method: 'DELETE', body: {} });
      if (epoch !== state.epoch) return;
      task.evidence = (task.evidence || []).filter((entry) => entry.id !== id);
      state.taskErrors.delete(taskId);
      renderDetail();
    } catch (error) {
      if (epoch === state.epoch) {
        state.taskErrors.set(taskId, errorMessage(error));
        renderDetail();
      }
    }
  }
  $('login-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    $('login-submit').disabled = true;
    $('login-error').hidden = true;
    try {
      const data = await request('/login', {
        method: 'POST',
        body: { username: $('username').value.trim(), password: $('password').value },
      });
      if (!data.inspector || !data.csrfToken) throw apiError(null, 502);
      state.inspector = data.inspector;
      state.csrf = data.csrfToken;
      $('password').value = '';
      await loadList();
    } catch (error) {
      $('login-error').textContent = errorMessage(error);
      $('login-error').hidden = false;
    } finally {
      $('login-submit').disabled = false;
    }
  });
  $('logout').addEventListener('click', async () => {
    $('logout').disabled = true;
    closeCamera();
    abortUploads();
    try {
      await request('/logout', { method: 'POST', body: {} });
      showLogin();
    } catch (error) {
      if (state.inspector) failPage(error);
    } finally {
      $('logout').disabled = false;
    }
  });
  $('round-list').addEventListener('click', (event) => {
    const button = event.target.closest('[data-round]');
    if (button) loadDetail(button.dataset.round);
  });
  $('back').addEventListener('click', () => loadList());
  $('previous-day').addEventListener('click', () => {
    state.date = M.shiftDate(state.date, -1);
    loadList();
  });
  $('next-day').addEventListener('click', () => {
    state.date = M.shiftDate(state.date, 1);
    loadList();
  });
  $('round-date').addEventListener('change', () => {
    if (/^\d{4}-\d{2}-\d{2}$/.test($('round-date').value)) {
      state.date = $('round-date').value;
      loadList();
    }
  });
  $('retry-page').addEventListener('click', () =>
    state.detailId ? loadDetail(state.detailId) : state.inspector ? loadList() : boot(),
  );
  $('round-detail').addEventListener('input', (event) => {
    if (event.target.dataset.comment)
      state.comments.set(event.target.dataset.comment, event.target.value);
  });
  $('round-detail').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const d = button.dataset;
    if (d.capture) openCamera(d.task, d.capture, button);
    else if (d.complete) completeTask(d.complete);
    else if (d.remove) removeMedia(d.remove, d.task, button);
    else if (d.retry) uploadMedia(d.retry);
    else if (d.discard) {
      const upload = state.uploads.get(d.discard);
      if (upload) disposeUpload(upload);
      state.uploads.delete(d.discard);
      renderDetail();
    }
  });
  $('close-camera').addEventListener('click', closeCamera);
  $('camera-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    closeCamera();
  });
  $('camera-retry').addEventListener('click', enableCamera);
  $('switch-camera').addEventListener('click', () => {
    if (state.camera) {
      state.camera.facing = state.camera.facing === 'environment' ? 'user' : 'environment';
      enableCamera();
    }
  });
  $('capture-photo').addEventListener('click', async () => {
    if (!state.camera) return;
    const { taskId, kind } = state.camera,
      generation = cameraGeneration;
    $('capture-photo').disabled = true;
    try {
      await acceptCapture(await capture.photo(), taskId, kind, generation);
    } catch (error) {
      if (generation === cameraGeneration) {
        $('capture-photo').disabled = false;
        $('camera-error').textContent = C.cameraError(error);
        $('camera-error').hidden = false;
      }
    }
  });
  $('record-video').addEventListener('click', async () => {
    if (!state.camera) return;
    const { taskId, kind } = state.camera,
      generation = cameraGeneration;
    $('record-video').hidden = true;
    $('stop-video').hidden = false;
    $('switch-camera').hidden = true;
    $('recording-time').hidden = false;
    $('recording-time').textContent = '00:00 / 01:00';
    try {
      const blob = await capture.startRecording((seconds) => {
        $('recording-time').textContent = '00:' + String(seconds).padStart(2, '0') + ' / 01:00';
      });
      await acceptCapture(blob, taskId, kind, generation);
    } catch (error) {
      if (generation !== cameraGeneration || error.name === 'AbortError') return;
      capture.close();
      $('stop-video').hidden = true;
      $('recording-time').hidden = true;
      $('camera-retry').hidden = false;
      $('camera-error').textContent = C.cameraError(error);
      $('camera-error').hidden = false;
    }
  });
  $('stop-video').addEventListener('click', () => {
    $('stop-video').disabled = true;
    capture.stopRecording();
    $('stop-video').disabled = false;
  });
  function leaveCamera() {
    if (state.camera) closeCamera();
  }
  window.addEventListener('pagehide', () => {
    leaveCamera();
    abortUploads();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) leaveCamera();
    else if (state.inspector && !state.detailId) loadList(true);
  });
  window.setInterval(() => {
    if (state.inspector && !state.detailId && !document.hidden) loadList(true);
  }, 60000);
  async function boot() {
    clearError();
    $('loading').hidden = false;
    $('login').hidden = true;
    try {
      const data = await request('/session');
      if (!data.inspector || !data.csrfToken) {
        showLogin();
        return;
      }
      state.inspector = data.inspector;
      state.csrf = data.csrfToken;
      await loadList();
    } catch (error) {
      if (error.status === 401) showLogin();
      else failPage(error);
    }
  }
  boot();
})();

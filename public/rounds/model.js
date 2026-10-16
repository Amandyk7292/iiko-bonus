(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.BulkaRounds = api;
})(typeof window !== 'undefined' ? window : globalThis, function () {
  'use strict';
  const statuses = {
    pending: 'Не начат',
    in_progress: 'В работе',
    overdue: 'Просрочен',
    completed: 'Выполнен',
    cancelled: 'Отменён',
  };
  const escape = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
    );
  const editable = (round) => round && !['completed', 'cancelled'].includes(round.status);
  function evidenceReady(task) {
    const kinds = new Set((task.evidence || []).map((entry) => entry.kind));
    return (
      task.evidenceType === 'none' ||
      (task.evidenceType === 'photo' && kinds.has('photo')) ||
      (task.evidenceType === 'video' && kinds.has('video')) ||
      (task.evidenceType === 'photo_video' && kinds.has('photo') && kinds.has('video'))
    );
  }
  function mediaUrl(entry) {
    // Authenticated same-origin endpoint only; never render a supplied arbitrary URL.
    return /^[0-9a-f-]{36}$/i.test(entry.id || '') ? '/api/rounds/media/' + entry.id : '';
  }
  function localDate(value = new Date()) {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Almaty',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(value);
    return ['year', 'month', 'day']
      .map((type) => parts.find((part) => part.type === type).value)
      .join('-');
  }
  function shiftDate(value, days) {
    const date = new Date(value + 'T12:00:00Z');
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }
  function displayDate(value) {
    return new Intl.DateTimeFormat('ru', {
      day: 'numeric',
      month: 'long',
      weekday: 'short',
      timeZone: 'UTC',
    }).format(new Date(value + 'T12:00:00Z'));
  }
  function deadline(value) {
    const date = new Date(value);
    return Number.isNaN(date.valueOf())
      ? ''
      : new Intl.DateTimeFormat('ru', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Almaty',
        }).format(date);
  }
  function summary(rounds) {
    const active = rounds.filter((round) => round.status !== 'cancelled');
    const completed = active.filter((round) => round.status === 'completed').length;
    return {
      total: active.length,
      completed,
      allDone: active.length > 0 && completed === active.length,
    };
  }
  return {
    statuses,
    escape,
    editable,
    evidenceReady,
    mediaUrl,
    localDate,
    shiftDate,
    displayDate,
    deadline,
    summary,
  };
});

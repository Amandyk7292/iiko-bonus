(() => {
  const keys = ['all', 'year', 'month'];
  const status = document.getElementById('status');
  const metrics = document.getElementById('metrics');
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const counters = new Map(keys.map(key => {
    const element = document.getElementById(`${key}-count`);
    const card = element.closest('.metric');
    const delta = document.createElement('span');
    delta.className = 'delta';
    delta.setAttribute('aria-hidden', 'true');
    card.append(delta);
    return [key, { element, card, delta, value: null, shown: 0, period: null, frame: null, badgeTimer: null }];
  }));
  let timer;
  let controller;
  let hasData = false;
  let stopped = false;
  let resumeRequested = false;
  function finish(counter) {
    cancelAnimationFrame(counter.frame);
    counter.frame = null;
    if (counter.value !== null) {
      counter.shown = counter.value;
      counter.element.textContent = number.format(counter.value / 1000);
    }
  }
  function renderCounter(counter, quantity, period) {
    const target = Math.round(quantity * 1000);
    const previous = counter.value;
    const samePeriod = counter.period === period;
    if (previous === target && samePeriod) return;
    finish(counter);
    clearTimeout(counter.badgeTimer);
    counter.card.classList.remove('changed');
    counter.delta.classList.remove('visible');
    const start = previous === null ? 0 : (samePeriod ? counter.shown : target);
    counter.value = target;
    counter.period = period;
    counter.element.setAttribute('aria-label', `${number.format(quantity)} кг`);
    if (previous !== null && samePeriod) {
      const difference = (target - previous) / 1000;
      counter.delta.textContent = `${difference > 0 ? '+' : '−'}${number.format(Math.abs(difference))} кг`;
      void counter.card.offsetWidth;
      counter.card.classList.add('changed');
      counter.delta.classList.add('visible');
      counter.badgeTimer = setTimeout(() => {
        counter.delta.classList.remove('visible');
        counter.card.classList.remove('changed');
      }, 6000);
    }
    if (reducedMotion.matches || document.hidden || start === target) { finish(counter); return; }
    const began = performance.now();
    const duration = previous === null ? 1600 : 1200;
    const tick = now => {
      const progress = Math.min(1, (now - began) / duration);
      counter.shown = Math.round(start + (target - start) * (1 - Math.pow(1 - progress, 3)));
      counter.element.textContent = number.format(counter.shown / 1000);
      if (progress < 1) counter.frame = requestAnimationFrame(tick); else finish(counter);
    };
    counter.frame = requestAnimationFrame(tick);
  }
  function schedule(ms) {
    clearTimeout(timer);
    if (!document.hidden && !stopped) timer = setTimeout(update, ms);
  }
  async function update() {
    if (controller || document.hidden || stopped) return;
    clearTimeout(timer);
    const request = new AbortController();
    controller = request;
    status.classList.add('fetching');
    const timeout = setTimeout(() => request.abort(), 15000);
    let delay = 60000;
    try {
      const response = await fetch('/api/public/screencakes', { cache: 'no-store', signal: request.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (request.signal.aborted) return;
      if (!data.ready) {
        for (const counter of counters.values()) {
          finish(counter);
          counter.value = null;
          counter.period = null;
          counter.element.textContent = '—';
          counter.element.removeAttribute('aria-label');
          clearTimeout(counter.badgeTimer);
          counter.delta.classList.remove('visible');
          counter.card.classList.remove('changed');
        }
        metrics.setAttribute('aria-busy', 'true');
        hasData = false;
        status.textContent = data.updating ? 'Считаем продажи — данные появятся автоматически' : 'Источник временно недоступен. Повторяем подключение…';
        status.classList.add('stale');
        delay = 5000;
        return;
      }
      // Validate the entire snapshot before changing visible values.
      if (data.unit !== 'kg' || !Number.isFinite(Date.parse(data.generatedAt))) throw new Error('Invalid snapshot');
      for (const key of keys) {
        const period = data.periods?.[key];
        if (!Number.isFinite(period?.quantity) || period.quantity < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(period.from)) throw new Error('Invalid quantity');
      }
      const compact = keys.some(key => number.format(data.periods[key].quantity).length > 10);
      for (const key of keys) {
        const counter = counters.get(key);
        counter.element.classList.toggle('compact', compact);
        renderCounter(counter, data.periods[key].quantity, data.periods[key].from);
      }
      const monthDate = new Date(`${data.periods.month.from}T12:00:00+05:00`);
      document.getElementById('year-period').textContent = `${data.periods.year.from.slice(0, 4)} год · кг`;
      document.getElementById('month-period').textContent = `${new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'Asia/Almaty' }).format(monthDate)} · кг`;
      document.getElementById('all-period').textContent = 'Вся доступная история · кг';
      const timestamp = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(new Date(data.generatedAt));
      status.textContent = data.stale ? `Данные на ${timestamp}. Восстанавливаем обновление…` : `Обновлено ${timestamp} · автоматически`;
      status.classList.toggle('stale', Boolean(data.stale));
      metrics.setAttribute('aria-busy', 'false');
      hasData = true;
      if (data.updating) delay = 5000;
    } catch (_) {
      if (document.hidden || stopped) return;
      status.textContent = hasData ? 'Связь прервалась. Сохраняем последние данные и повторяем подключение…' : 'Подключаемся к источнику продаж…';
      status.classList.add('stale');
      delay = 10000;
    } finally {
      clearTimeout(timeout);
      controller = null;
      status.classList.remove('fetching');
      schedule(resumeRequested ? 0 : delay);
      resumeRequested = false;
    }
  }
  function suspend() {
    clearTimeout(timer);
    controller?.abort();
    for (const counter of counters.values()) finish(counter);
  }
  function resume() {
    if (controller) resumeRequested = true; else void update();
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) suspend(); else resume();
  });
  window.addEventListener('pagehide', () => { stopped = true; suspend(); });
  window.addEventListener('pageshow', event => { if (event.persisted || stopped) { stopped = false; resume(); } });
  window.addEventListener('online', resume);
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) for (const counter of counters.values()) finish(counter);
  });
  void update();
})();


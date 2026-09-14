(() => {
  const status = document.getElementById('status');
  const number = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 3 });
  let timer;
  let pending = false;
  let hasData = false;
  const schedule = (ms) => { clearTimeout(timer); timer = setTimeout(update, ms); };
  async function update() {
    if (pending || document.hidden) return;
    pending = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    let delay = 60000;
    try {
      const response = await fetch('/api/public/screencakes', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error('Unavailable');
      const data = await response.json();
      if (!data.ready) {
        for (const key of ['all', 'year', 'month']) document.getElementById(`${key}-count`).textContent = '—';
        document.getElementById('metrics').setAttribute('aria-busy', 'true');
        hasData = false;
        status.textContent = data.updating ? 'Считаем продажи — данные появятся автоматически' : 'Источник временно недоступен. Повторяем подключение…';
        status.classList.add('stale');
        delay = 5000;
        return;
      }
      for (const key of ['all', 'year', 'month']) {
        const value = data.periods[key]?.quantity;
        if (!Number.isFinite(value) || value < 0 || data.unit !== 'kg') throw new Error('Invalid quantity');
      }
      for (const key of ['all', 'year', 'month']) {
        const element = document.getElementById(`${key}-count`);
        const value = number.format(data.periods[key].quantity);
        element.textContent = value;
        element.classList.toggle('compact', ['all', 'year', 'month'].some(k => number.format(data.periods[k].quantity).length > 10));
      }
      const monthDate = new Date(`${data.periods.month.from}T12:00:00+05:00`);
      document.getElementById('year-period').textContent = `${data.periods.year.from.slice(0, 4)} год · кг`;
      document.getElementById('month-period').textContent = `${new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'Asia/Almaty' }).format(monthDate)} · кг`;
      document.getElementById('all-period').textContent = 'Вся доступная история · кг';
      const timestamp = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Almaty' }).format(new Date(data.generatedAt));
      status.textContent = data.stale ? `Данные на ${timestamp}. Восстанавливаем обновление…` : `Обновлено ${timestamp} · автоматически`;
      status.classList.toggle('stale', Boolean(data.stale));
      document.getElementById('metrics').setAttribute('aria-busy', 'false');
      hasData = true;
      if (data.updating) delay = 5000;
    } catch (_) {
      status.textContent = hasData ? 'Связь прервалась. Сохраняем последние данные и повторяем подключение…' : 'Подключаемся к источнику продаж…';
      status.classList.add('stale');
      delay = 10000;
    } finally {
      clearTimeout(timeout);
      pending = false;
      schedule(delay);
    }
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearTimeout(timer); else void update();
  });
  window.addEventListener('online', () => void update());
  void update();
})();

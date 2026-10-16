(function (root, factory) {
  'use strict';
  const calendar = factory();
  if (typeof module === 'object' && module.exports) module.exports = calendar;
  if (root) root.BulkaCalendar = calendar;
})(typeof window === 'undefined' ? null : window, function () {
  'use strict';
  const controls = new WeakMap();
  const pad = (value) => String(value).padStart(2, '0');
  const iso = (date) =>
    `${String(date.getUTCFullYear()).padStart(4, '0')}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
  function parse(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return null;
    const [year, month, day] = value.split('-').map(Number);
    if (year < 1 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(2000, month - 1, day));
    date.setUTCFullYear(year);
    return iso(date) === value ? date : null;
  }
  const today = () => {
    const now = new Date();
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };
  function shiftDay(value, amount) {
    const date = parse(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + amount);
    const result = iso(date);
    return parse(result) ? result : '';
  }
  function shiftMonth(value, amount) {
    const date = parse(value);
    if (!date) return '';
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + amount);
    const last = new Date(date);
    last.setUTCMonth(last.getUTCMonth() + 1, 0);
    date.setUTCDate(Math.min(day, last.getUTCDate()));
    const result = iso(date);
    return parse(result) ? result : '';
  }
  const inRange = (value, min, max) =>
    !!parse(value) && (!parse(min) || value >= min) && (!parse(max) || value <= max);
  function daysForMonth(month) {
    const first = parse(month + '-01');
    if (!first) return [];
    const offset = (first.getUTCDay() + 6) % 7;
    return Array.from({ length: 42 }, (_, index) => shiftDay(month + '-01', index - offset));
  }
  const format = (value, long = false) =>
    parse(value)?.toLocaleDateString('ru-RU', {
      timeZone: 'UTC',
      day: long ? 'numeric' : '2-digit',
      month: long ? 'long' : '2-digit',
      year: 'numeric',
    }) || '';
  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }
  function button(className, label, text) {
    const node = element('button', className, text);
    node.type = 'button';
    if (label) node.setAttribute('aria-label', label);
    return node;
  }
  function icon() {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(svg.namespaceURI, 'path');
    path.setAttribute(
      'd',
      'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
    );
    svg.append(path);
    return svg;
  }
  function attach(input, settings = {}) {
    if (!input || input.nodeName !== 'INPUT') throw new TypeError('Calendar requires an input');
    if (controls.has(input)) {
      const existing = controls.get(input);
      existing.configure(settings);
      return existing;
    }
    const label =
      settings.label ||
      input.getAttribute('aria-label') ||
      input.labels?.[0]?.textContent.trim() ||
      'Выбрать дату';
    const options = { ...settings };
    const name = (input.id || 'bulka-date') + '-calendar';
    // Text source retains the original ISO value/name and form validity. It can
    // never invoke a browser date picker; invalid events focus the real control.
    input.type = 'text';
    input.classList.add('bulka-calendar-source');
    input.setAttribute('aria-hidden', 'true');
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('inputmode', 'none');
    input.tabIndex = -1;
    const trigger = button('bulka-calendar-trigger', label);
    trigger.id = name + '-trigger';
    trigger.setAttribute('aria-haspopup', 'dialog');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', name);
    const triggerText = element('span');
    trigger.append(triggerText, icon());
    input.after(trigger);
    const dialog = element('dialog', 'bulka-calendar');
    dialog.id = name;
    dialog.setAttribute('aria-labelledby', name + '-title');
    const header = element('header', 'bulka-calendar-titlebar');
    const title = element('h2', '', label);
    title.id = name + '-title';
    const closeButton = button('bulka-calendar-icon', 'Закрыть календарь', '×');
    header.append(title, closeButton);
    const content = element('div', 'bulka-calendar-body');
    const navigation = element('div', 'bulka-calendar-heading');
    const previous = button('bulka-calendar-icon', 'Предыдущий месяц', '‹');
    const next = button('bulka-calendar-icon', 'Следующий месяц', '›');
    const monthSelect = element('select');
    monthSelect.setAttribute('aria-label', 'Месяц');
    const yearSelect = element('select');
    yearSelect.setAttribute('aria-label', 'Год');
    for (let month = 1; month <= 12; month++) {
      const option = element(
        'option',
        '',
        parse(`2026-${pad(month)}-01`).toLocaleDateString('ru-RU', {
          timeZone: 'UTC',
          month: 'long',
        }),
      );
      option.value = pad(month);
      monthSelect.append(option);
    }
    navigation.append(previous, monthSelect, yearSelect, next);
    const weekdays = element('div', 'bulka-calendar-weekdays');
    weekdays.setAttribute('aria-hidden', 'true');
    ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].forEach((day) =>
      weekdays.append(element('span', '', day)),
    );
    const grid = element('div', 'bulka-calendar-grid');
    grid.setAttribute('role', 'grid');
    grid.setAttribute('aria-label', 'Дни месяца');
    const selection = element('p', 'bulka-calendar-selection');
    selection.setAttribute('aria-live', 'polite');
    const error = element('p', 'bulka-calendar-error');
    error.setAttribute('role', 'alert');
    error.hidden = true;
    content.append(navigation, weekdays, grid, selection, error);
    const footer = element('footer', 'bulka-calendar-footer');
    const todayButton = button('bulka-calendar-text', '', 'Сегодня');
    const clearButton = button('bulka-calendar-text', '', 'Очистить');
    const cancelButton = button('bulka-calendar-cancel', '', 'Отмена');
    const applyButton = button('bulka-calendar-apply', '', 'Выбрать');
    footer.append(todayButton, clearButton, cancelButton, applyButton);
    dialog.append(header, content, footer);
    document.body.append(dialog);
    let draft = '',
      month = today().slice(0, 7),
      focus = '',
      touched = false;
    const valid = (value) => inRange(value, input.min, input.max);
    const bounded = (value) => {
      if (parse(input.min) && value < input.min) return input.min;
      if (parse(input.max) && value > input.max) return input.max;
      return value;
    };
    function refresh() {
      const acceptable = input.disabled || (!input.value ? !input.required : valid(input.value));
      input.setCustomValidity(
        acceptable ? '' : input.value ? 'Выберите дату в допустимом диапазоне' : 'Выберите дату',
      );
      trigger.disabled = input.disabled;
      triggerText.textContent =
        input.value && parse(input.value)
          ? (options.format || format)(input.value)
          : 'Выбрать дату';
      trigger.setAttribute(
        'aria-label',
        label + (input.value && parse(input.value) ? ': ' + format(input.value, true) : ''),
      );
      trigger.setAttribute('aria-invalid', String(touched && !acceptable));
      return acceptable;
    }
    function focusDay() {
      grid.querySelector('[data-date="' + focus + '"]')?.focus();
    }
    function render(moveFocus = false) {
      monthSelect.value = month.slice(5);
      const year = Number(month.slice(0, 4));
      yearSelect.replaceChildren();
      const years = new Set(
        Array.from({ length: 151 }, (_, i) => new Date().getFullYear() - 100 + i),
      );
      years.add(year);
      if (parse(input.min)) years.add(Number(input.min.slice(0, 4)));
      if (parse(input.max)) years.add(Number(input.max.slice(0, 4)));
      [...years]
        .filter((y) => y >= 1 && y <= 9999)
        .sort((a, b) => a - b)
        .forEach((y) => {
          const option = element('option', '', String(y));
          option.value = String(y);
          option.disabled =
            (!!parse(input.min) && y < Number(input.min.slice(0, 4))) ||
            (!!parse(input.max) && y > Number(input.max.slice(0, 4)));
          yearSelect.append(option);
        });
      yearSelect.value = String(year);
      const days = daysForMonth(month);
      if (!days.includes(focus) || !valid(focus))
        focus = days.find((day) => valid(day) && day.startsWith(month)) || days.find(valid) || '';
      previous.disabled =
        !shiftMonth(month + '-01', -1) || (!!parse(input.min) && month <= input.min.slice(0, 7));
      next.disabled =
        !shiftMonth(month + '-01', 1) || (!!parse(input.max) && month >= input.max.slice(0, 7));
      grid.replaceChildren();
      for (let week = 0; week < 6; week++) {
        const row = element('div', 'bulka-calendar-week');
        row.setAttribute('role', 'row');
        days.slice(week * 7, week * 7 + 7).forEach((day) => {
          const node = button(
            'bulka-calendar-day',
            day ? format(day, true) : 'Недоступная дата',
            day ? String(Number(day.slice(8))) : '',
          );
          node.dataset.date = day;
          node.setAttribute('role', 'gridcell');
          node.setAttribute('aria-selected', String(draft === day));
          node.classList.toggle('is-outside', !day.startsWith(month));
          if (day === today()) node.setAttribute('aria-current', 'date');
          node.disabled = !valid(day);
          node.tabIndex = day === focus ? 0 : -1;
          row.append(node);
        });
        grid.append(row);
      }
      todayButton.hidden = options.today === false;
      todayButton.disabled = !valid(today());
      clearButton.hidden = input.required || options.clearable === false;
      applyButton.disabled = !valid(draft);
      selection.textContent = draft && parse(draft) ? format(draft, true) : 'Выберите день';
      error.hidden = !touched || (!!draft && valid(draft));
      error.textContent = input.validationMessage || 'Выберите дату в допустимом диапазоне';
      if (moveFocus) focusDay();
    }
    function close() {
      if (dialog.open) dialog.close();
      trigger.setAttribute('aria-expanded', 'false');
      if (trigger.isConnected && !trigger.disabled) trigger.focus();
    }
    function open() {
      if (input.disabled) return;
      refresh();
      draft = valid(input.value) ? input.value : '';
      focus = bounded(draft || today());
      month = (parse(focus) ? focus : today()).slice(0, 7);
      render();
      if (!dialog.open) dialog.showModal();
      trigger.setAttribute('aria-expanded', 'true');
      focusDay();
    }
    function setValue(value, emit = false) {
      input.value = value;
      touched = true;
      refresh();
      if (emit) {
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
    trigger.addEventListener('click', open);
    closeButton.addEventListener('click', close);
    cancelButton.addEventListener('click', close);
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close();
    });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (
        event.clientX < rect.left ||
        event.clientX > rect.right ||
        event.clientY < rect.top ||
        event.clientY > rect.bottom
      )
        close();
    });
    applyButton.addEventListener('click', () => {
      if (valid(draft)) {
        setValue(draft, true);
        close();
      }
    });
    clearButton.addEventListener('click', () => {
      if (!input.required) {
        setValue('', true);
        close();
      }
    });
    todayButton.addEventListener('click', () => {
      if (!valid(today())) return;
      draft = focus = today();
      month = draft.slice(0, 7);
      render(true);
    });
    const moveMonth = (amount) => {
      const nextMonth = shiftMonth(month + '-01', amount);
      if (!nextMonth) return;
      month = nextMonth.slice(0, 7);
      focus = bounded(nextMonth);
      render(true);
    };
    previous.addEventListener('click', () => moveMonth(-1));
    next.addEventListener('click', () => moveMonth(1));
    monthSelect.addEventListener('change', () => {
      month = month.slice(0, 4) + '-' + monthSelect.value;
      focus = month + '-01';
      render();
    });
    yearSelect.addEventListener('change', () => {
      month = yearSelect.value.padStart(4, '0') + month.slice(4);
      focus = month + '-01';
      render();
    });
    grid.addEventListener('click', (event) => {
      const node = event.target.closest('[data-date]');
      if (!node || node.disabled || !valid(node.dataset.date)) return;
      draft = focus = node.dataset.date;
      touched = false;
      render(true);
    });
    grid.addEventListener('keydown', (event) => {
      const day = event.target.dataset.date;
      if (!day) return;
      let nextDay = '';
      const delta = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
      if (delta) nextDay = shiftDay(day, delta);
      else if (event.key === 'Home') nextDay = shiftDay(day, -((parse(day).getUTCDay() + 6) % 7));
      else if (event.key === 'End') nextDay = shiftDay(day, 6 - ((parse(day).getUTCDay() + 6) % 7));
      else if (event.key === 'PageUp' || event.key === 'PageDown')
        nextDay = shiftMonth(day, (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1));
      else return;
      event.preventDefault();
      if (!valid(nextDay)) return;
      focus = nextDay;
      month = nextDay.slice(0, 7);
      render(true);
    });
    input.addEventListener('input', refresh);
    input.addEventListener('change', refresh);
    input.addEventListener('focus', () => trigger.focus());
    input.addEventListener('invalid', (event) => {
      event.preventDefault();
      touched = true;
      refresh();
      open();
    });
    input.form?.addEventListener(
      'submit',
      (event) => {
        if (!refresh()) {
          event.preventDefault();
          event.stopImmediatePropagation();
          touched = true;
          open();
        }
      },
      true,
    );
    input.form?.addEventListener('reset', () => setTimeout(refresh, 0));
    new MutationObserver(() => {
      refresh();
      if (dialog.open) render();
    }).observe(input, {
      attributes: true,
      attributeFilter: ['disabled', 'required', 'min', 'max', 'value'],
    });
    const controller = {
      input,
      trigger,
      dialog,
      refresh,
      open,
      close,
      setValue,
      configure: (next) => {
        Object.assign(options, next);
        refresh();
        if (dialog.open) render();
      },
    };
    controls.set(input, controller);
    refresh();
    return controller;
  }
  const api = {
    attach,
    parse,
    iso,
    today,
    shiftDay,
    shiftMonth,
    inRange,
    daysForMonth,
    get: (input) => controls.get(input),
    refresh: (input) => controls.get(input)?.refresh(),
    setValue: (input, value, emit = false) => controls.get(input)?.setValue(value, emit),
  };
  if (typeof document !== 'undefined') {
    const init = () =>
      document.querySelectorAll('input[data-bulka-calendar]').forEach((input) => attach(input));
    if (document.readyState === 'loading')
      document.addEventListener('DOMContentLoaded', init, { once: true });
    else init();
  }
  return api;
});

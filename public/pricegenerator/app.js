(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const cityFromUrl = new URLSearchParams(location.search).get('city');
  const cityFromStorage = localStorage.getItem('bulka-pricegenerator-city');
  const initialCity = ['aktau', 'astana'].includes(cityFromUrl)
    ? cityFromUrl
    : ['aktau', 'astana'].includes(cityFromStorage)
      ? cityFromStorage
      : 'aktau';
  const cityQuery = () => `?city=${encodeURIComponent(state.city)}`;
  const templateStorageKey = () => `bulka-label-designer-v1-${state.city}`;
  const names = {
    name: 'Название',
    composition: 'Состав',
    barcode: 'Штрихкод',
    dates: 'Даты',
    price: 'Цена',
  };
  const defaults = {
    name: {
      x: 6,
      y: 3,
      w: 58,
      h: 7,
      font: 12,
      weight: 400,
      lineHeight: 1.15,
      align: 'center',
      visible: true,
    },
    composition: {
      x: 7,
      y: 11,
      w: 56,
      h: 12,
      font: 5.3,
      weight: 400,
      lineHeight: 1.15,
      breakLanguages: false,
      align: 'left',
      visible: true,
    },
    barcode: {
      x: 10,
      y: 24,
      w: 50,
      h: 12,
      font: 5,
      weight: 400,
      lineHeight: 1.15,
      align: 'center',
      visible: true,
    },
    dates: {
      x: 7,
      y: 39,
      w: 38,
      h: 8,
      font: 5.2,
      weight: 400,
      lineHeight: 1.15,
      align: 'left',
      visible: true,
    },
    price: {
      x: 47,
      y: 39,
      w: 17,
      h: 8,
      font: 8,
      weight: 700,
      lineHeight: 1.15,
      align: 'right',
      visible: true,
    },
  };
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(`bulka-label-designer-v1-${initialCity}`) || 'null');
  } catch {
    localStorage.removeItem(`bulka-label-designer-v1-${initialCity}`);
  }
  const state = {
    isAdmin: false,
    city: initialCity,
    products: [],
    selectedProduct: 0,
    selected: 'barcode',
    zoom: 1,
    layout: saved?.layout || structuredClone(defaults),
    label: saved?.label || {
      width: 70,
      height: 50,
      radius: 4,
      background: '#ffffff',
      foreground: '#222222',
      offsetX: 0,
      offsetY: 0,
    },
    paper: saved?.paper || { width: 210, height: 297, gapX: 3, gapY: 3, margin: 5 },
  };
  const history = [];
  const dirtyProductIds = new Set();
  let historyIndex = -1;
  let restoringHistory = false;
  function historySnapshot() {
    return {
      products: structuredClone(state.products),
      selectedProduct: state.selectedProduct,
      selected: state.selected,
      zoom: state.zoom,
      layout: structuredClone(state.layout),
      label: structuredClone(state.label),
      paper: structuredClone(state.paper),
      madeDate: $('made-date').value,
      madeTime: $('made-time').value,
      dateFormat: $('date-format').value,
    };
  }
  function recordHistory() {
    if (restoringHistory) return;
    const snapshot = historySnapshot();
    const serialized = JSON.stringify(snapshot);
    if (historyIndex >= 0 && JSON.stringify(history[historyIndex]) === serialized) return;
    history.splice(historyIndex + 1);
    history.push(snapshot);
    if (history.length > 60) history.shift();
    historyIndex = history.length - 1;
  }
  function restoreHistory(index) {
    const snapshot = history[index];
    if (!snapshot) return;
    restoringHistory = true;
    state.products = structuredClone(snapshot.products);
    state.selectedProduct = Math.min(
      snapshot.selectedProduct,
      Math.max(0, state.products.length - 1),
    );
    state.selected = snapshot.selected;
    state.zoom = snapshot.zoom;
    state.layout = structuredClone(snapshot.layout);
    state.label = structuredClone(snapshot.label);
    state.paper = structuredClone(snapshot.paper);
    $('made-date').value = snapshot.madeDate;
    $('made-time').value = snapshot.madeTime || '12:00';
    $('date-format').value = snapshot.dateFormat;
    renderedDate = snapshot.madeDate;
    for (const [id, value] of [
      ['label-width', state.label.width],
      ['label-height', state.label.height],
      ['label-radius', state.label.radius],
      ['background', state.label.background],
      ['foreground', state.label.foreground],
      ['offset-x', state.label.offsetX || 0],
      ['offset-y', state.label.offsetY || 0],
      ['paper-width', state.paper.width],
      ['paper-height', state.paper.height],
      ['gap-x', state.paper.gapX],
      ['gap-y', state.paper.gapY],
      ['page-margin', state.paper.margin],
    ])
      $(id).value = String(value);
    renderProducts();
    renderStage();
    historyIndex = index;
    restoringHistory = false;
    notice(index < history.length - 1 ? 'Изменение отменено.' : 'Изменение возвращено.');
  }
  let stage = $('label-stage');
  const printRoot = $('print-root');
  const notice = (message, error = false) => {
    $('notice').textContent = message;
    $('notice').style.color = error ? '#b42318' : '#6f4b2d';
  };
  const number = (id, fallback) => Number($(id).value) || fallback;
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
    );
  function formatDate(date) {
    const [year, month, day] = date.toISOString().slice(0, 10).split('-');
    return $('date-format').value === 'dd.mm.yy'
      ? `${day}.${month}.${year.slice(2)}`
      : `${day}.${month}.${year}`;
  }
  function expiryDate(days, unit = 'days') {
    const date = new Date(`${$('made-date').value}T${$('made-time').value || '12:00'}:00`);
    const amount = Math.max(0, Number(days) || 0);
    if (unit === 'hours') date.setHours(date.getHours() + amount);
    else date.setDate(date.getDate() + amount);
    const formatted = formatDate(date);
    return unit === 'hours'
      ? `${formatted} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
      : formatted;
  }
  function validEan(value) {
    return /^\d{13}$/.test(String(value));
  }
  const L = [
    '0001101',
    '0011001',
    '0010011',
    '0111101',
    '0100011',
    '0110001',
    '0101111',
    '0111011',
    '0110111',
    '0001011',
  ];
  const G = [
    '0100111',
    '0110011',
    '0011011',
    '0100001',
    '0011101',
    '0111001',
    '0000101',
    '0010001',
    '0001001',
    '0010111',
  ];
  const R = [
    '1110010',
    '1100110',
    '1101100',
    '1000010',
    '1011100',
    '1001110',
    '1010000',
    '1000100',
    '1001000',
    '1110100',
  ];
  const parity = [
    'LLLLLL',
    'LLGLGG',
    'LLGGLG',
    'LLGGGL',
    'LGLLGG',
    'LGGLLG',
    'LGGGLL',
    'LGLGLG',
    'LGLGGL',
    'LGGLGL',
  ];
  function eanSvg(value) {
    const code = String(value || '').replace(/\D/g, '');
    if (!validEan(code)) return `<div class="barcode-number">${esc(code || 'Нет штрихкода')}</div>`;
    let bits = '101';
    const scheme = parity[Number(code[0])];
    for (let i = 1; i <= 6; i++) bits += (scheme[i - 1] === 'L' ? L : G)[Number(code[i])];
    bits += '01010';
    for (let i = 7; i <= 12; i++) bits += R[Number(code[i])];
    bits += '101';
    const bars = [...bits]
      .map((bit, i) =>
        bit === '1'
          ? `<rect x="${i}" y="0" width="1" height="${i < 3 || (i >= 45 && i < 50) || i >= 92 ? 44 : 38}"/>`
          : '',
      )
      .join('');
    return `<svg class="barcode" viewBox="0 0 95 44" preserveAspectRatio="none" aria-label="Штрихкод ${code}">${bars}</svg><div class="barcode-number">${code}</div>`;
  }
  function product() {
    return (
      state.products[state.selectedProduct] || {
        name: 'Хот дог',
        composition:
          'Құрамы: хот-дог бөлкесі, сосиска, кетчуп, сарымсақ соусы, қияр, ірімшік соусы. Состав: булочка для хот-дога, сосиска, кетчуп, чесночный соус, свежий огурец, сырный соус.',
        price: '600',
        expiry: '1',
        barcode: '2101430000016',
      }
    );
  }
  function elementContent(key, item) {
    if (key === 'name') return esc(item.name);
    if (key === 'composition') {
      const text = state.layout.composition.breakLanguages
        ? String(item.composition || '').replace(/\s+(Состав:)/giu, '\n$1')
        : item.composition;
      return esc(text);
    }
    if (key === 'barcode') return eanSvg(item.barcode);
    if (key === 'dates')
      return `ИЗГОТОВЛЕНО: ${formatDate(new Date(`${$('made-date').value}T${$('made-time').value || '12:00'}:00`))}${item.expiryUnit === 'hours' ? ` ${esc($('made-time').value || '12:00')}` : ''}<br>ГОДЕН ДО: ${expiryDate(item.expiry, item.expiryUnit)}`;
    return `<span>ЦЕНА:</span><br><b>${esc(item.price)} ₸</b>`;
  }
  function styleElement(node, cfg, key, print = false) {
    const scale = state.zoom * 6;
    const unit = (value) => (print ? `${value}mm` : `${value * scale}px`);
    Object.assign(node.style, {
      left: unit(cfg.x),
      top: unit(cfg.y),
      width: unit(cfg.w),
      height: unit(cfg.h),
      fontSize: `${cfg.font * (print ? 1 : state.zoom)}pt`,
      fontWeight: String(cfg.weight || 400),
      lineHeight: String(cfg.lineHeight || 1.15),
      textAlign: cfg.align,
      justifyContent:
        cfg.align === 'center' ? 'center' : cfg.align === 'right' ? 'flex-end' : 'flex-start',
      alignItems: key === 'barcode' ? 'stretch' : 'flex-start',
      display: cfg.visible ? 'flex' : 'none',
      color: state.label.foreground,
    });
  }
  function buildLabel(item, print = false) {
    const label = document.createElement('div');
    label.className = print ? 'print-label' : 'label-stage';
    const scale = state.zoom * 6;
    Object.assign(label.style, {
      width: print ? `${state.label.width}mm` : `${state.label.width * scale}px`,
      height: print ? `${state.label.height}mm` : `${state.label.height * scale}px`,
      borderRadius: print ? `${state.label.radius}mm` : `${state.label.radius * scale}px`,
      background: state.label.background,
      color: state.label.foreground,
    });
    for (const key of Object.keys(state.layout)) {
      const node = document.createElement('div');
      node.className = `label-element field-${key}${!print && state.selected === key ? ' selected' : ''}`;
      node.dataset.key = key;
      node.innerHTML =
        elementContent(key, item) +
        (!print && state.isAdmin ? '<i class="resize" aria-hidden="true"></i>' : '');
      styleElement(node, state.layout[key], key, print);
      label.append(node);
    }
    return label;
  }
  function fitLabel(label, showWarning = false) {
    let hasOverflow = false;
    for (const node of label.querySelectorAll('.label-element:not(.field-barcode)')) {
      if (node.style.display === 'none') continue;
      let size = Number.parseFloat(getComputedStyle(node).fontSize);
      const minimum = 4;
      while (
        size > minimum &&
        (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
      ) {
        size = Math.max(minimum, size - 0.5);
        node.style.fontSize = `${size}px`;
      }
      if (node.scrollHeight > node.clientHeight + 1 || node.scrollWidth > node.clientWidth + 1)
        hasOverflow = true;
    }
    if (showWarning) $('overflow-warning').hidden = !hasOverflow;
    return !hasOverflow;
  }
  function updateLayoutWarnings() {
    const warnings = [];
    for (const [key, cfg] of Object.entries(state.layout)) {
      if (!cfg.visible) continue;
      if (
        cfg.x < 0 ||
        cfg.y < 0 ||
        cfg.x + cfg.w > state.label.width ||
        cfg.y + cfg.h > state.label.height
      )
        warnings.push(`Блок «${names[key]}» выходит за границы этикетки.`);
    }
    const barcode = state.layout.barcode;
    if (barcode.visible && (barcode.w < 30 || barcode.h < 10))
      warnings.push(
        'Штрихкод слишком маленький для надёжного сканирования. Нужно не менее 30 × 10 мм.',
      );
    const warning = $('layout-warning');
    warning.hidden = warnings.length === 0;
    warning.innerHTML = warnings.map((item) => `<div>${esc(item)}</div>`).join('');
  }
  function renderStage() {
    const fresh = buildLabel(product());
    stage.replaceWith(fresh);
    fresh.id = 'label-stage';
    stage = fresh;
    bindStage(fresh);
    fitLabel(fresh, true);
    updateLayoutWarnings();
    updateControls();
  }
  function bindStage(node) {
    node.addEventListener('pointerdown', (event) => {
      const field = event.target.closest('.label-element');
      if (!field) return;
      const key = field.dataset.key;
      state.selected = key;
      renderStage();
      const active = $('label-stage').querySelector(`[data-key="${key}"]`);
      const resize = event.target.classList.contains('resize');
      if (resize && !state.isAdmin) return;
      const start = { x: event.clientX, y: event.clientY, cfg: { ...state.layout[key] } };
      active.setPointerCapture(event.pointerId);
      active.onpointermove = (move) => {
        const factor = state.zoom * 6;
        const dx = (move.clientX - start.x) / factor,
          dy = (move.clientY - start.y) / factor;
        if (resize) {
          state.layout[key].w = Math.max(6, start.cfg.w + dx);
          state.layout[key].h = Math.max(4, start.cfg.h + dy);
        } else {
          state.layout[key].x = Math.max(
            0,
            Math.min(state.label.width - state.layout[key].w, start.cfg.x + dx),
          );
          state.layout[key].y = Math.max(
            0,
            Math.min(state.label.height - state.layout[key].h, start.cfg.y + dy),
          );
        }
        styleElement(active, state.layout[key], key);
        updateControls();
      };
      active.onpointerup = () => {
        active.onpointermove = null;
        active.onpointerup = null;
        recordHistory();
      };
    });
  }
  function updateControls() {
    const cfg = state.layout[state.selected];
    $('selected-name').textContent = names[state.selected];
    for (const [id, key] of [
      ['field-x', 'x'],
      ['field-y', 'y'],
      ['field-w', 'w'],
      ['field-h', 'h'],
      ['font-size', 'font'],
    ])
      $(id).value = String(Math.round(cfg[key] * 10) / 10);
    $('text-align').value = cfg.align;
    $('font-weight').value = String(cfg.weight || 400);
    $('line-height').value = String(cfg.lineHeight || 1.15);
    $('language-break-control').hidden = state.selected !== 'composition';
    $('language-break').checked = Boolean(cfg.breakLanguages);
    $('field-visible').checked = cfg.visible;
    $('zoom-value').value = `${Math.round(state.zoom * 100)}%`;
  }
  function renderProducts() {
    const q = $('search-products').value.trim().toLowerCase();
    const visibleProducts = state.products.map((p, i) => ({ p, i })).filter(({ p }) => !p.archived);
    $('product-select').innerHTML = visibleProducts
      .map(
        ({ p, i }) =>
          `<option value="${i}"${i === state.selectedProduct ? ' selected' : ''}>${esc(p.name)}</option>`,
      )
      .join('');
    const showArchived = state.isAdmin && $('show-archived')?.checked;
    const filtered = state.products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => (showArchived ? p.archived : !p.archived))
      .filter(({ p }) => `${p.name} ${p.barcode}`.toLowerCase().includes(q));
    $('product-count').textContent = `${visibleProducts.length} активных`;
    $('upload-status').textContent = `Загружено товаров: ${state.products.length}`;
    $('product-list').innerHTML = filtered
      .map(
        ({ p, i }) =>
          `<article class="product-row ${i === state.selectedProduct ? 'active' : ''}${p.archived ? ' archived' : ''}" data-index="${i}"><strong>${esc(p.name || 'Без названия')}${p.archived ? '<em class="archive-badge">В архиве</em>' : ''}${dirtyProductIds.has(p.id) ? '<em class="unsaved-badge">Не сохранено</em>' : ''}</strong><small><span>${esc(p.barcode)}</span><span>${esc(p.price)} ₸</span></small>${state.isAdmin && i === state.selectedProduct ? `<div class="product-editor"><label><span>Название товара</span><input data-edit="name" value="${esc(p.name)}" placeholder="Например: Синнабон"></label><label><span>Цена, ₸</span><input data-edit="price" type="number" min="0" step="1" value="${esc(p.price)}" placeholder="Например: 535"></label><label><span>Штрихкод</span><input data-edit="barcode" inputmode="numeric" maxlength="13" value="${esc(p.barcode)}" placeholder="13 цифр"></label><div class="expiry-row"><label><span>Срок годности</span><input data-edit="expiry" type="number" min="0" max="87600" step="1" value="${esc(p.expiry)}" placeholder="Например: 3"></label><label><span>Единица</span><select data-edit="expiryUnit"><option value="days"${p.expiryUnit !== 'hours' ? ' selected' : ''}>Дней</option><option value="hours"${p.expiryUnit === 'hours' ? ' selected' : ''}>Часов</option></select></label></div><small class="editor-hint">Например: 12 часов, 24 часа или 3 дня</small><label><span>Состав на казахском и русском</span><textarea data-edit="composition" rows="5" placeholder="Құрамы: ...&#10;Состав: ...">${esc(p.composition)}</textarea></label><div class="product-editor-actions"><button type="button" data-save-product>${dirtyProductIds.size ? 'Сохранить изменения' : 'Сохранено'}</button><button type="button" data-duplicate-product>Дублировать</button><button type="button" class="danger" data-archive-product>${p.archived ? 'Восстановить' : 'В архив'}</button></div></div>` : ''}</article>`,
      )
      .join('');
  }
  function selectProduct(index) {
    state.selectedProduct = Number(index) || 0;
    renderProducts();
    renderStage();
  }
  function syncSettings() {
    state.label.width = number('label-width', 70);
    state.label.height = number('label-height', 50);
    state.label.radius = number('label-radius', 0);
    state.label.background = $('background').value;
    state.label.foreground = $('foreground').value;
    state.label.offsetX = number('offset-x', 0);
    state.label.offsetY = number('offset-y', 0);
    state.paper.width = number('paper-width', 210);
    state.paper.height = number('paper-height', 297);
    state.paper.gapX = number('gap-x', 0);
    state.paper.gapY = number('gap-y', 0);
    state.paper.margin = number('page-margin', 0);
    renderStage();
  }
  function applyTemplate(template) {
    if (!template) return;
    state.layout = structuredClone(template.layout);
    state.label = structuredClone(template.label);
    state.label.offsetX ??= 0;
    state.label.offsetY ??= 0;
    state.paper = structuredClone(template.paper);
    for (const [id, value] of [
      ['label-width', state.label.width],
      ['label-height', state.label.height],
      ['label-radius', state.label.radius],
      ['background', state.label.background],
      ['foreground', state.label.foreground],
      ['offset-x', state.label.offsetX],
      ['offset-y', state.label.offsetY],
      ['paper-width', state.paper.width],
      ['paper-height', state.paper.height],
      ['gap-x', state.paper.gapX],
      ['gap-y', state.paper.gapY],
      ['page-margin', state.paper.margin],
    ])
      $(id).value = String(value);
    renderStage();
  }
  async function loadSharedTemplate() {
    try {
      const response = await fetch(`/api/pricegenerator/template${cityQuery()}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка загрузки');
      if (data.template) {
        applyTemplate(data.template);
        localStorage.setItem(templateStorageKey(), JSON.stringify(data.template));
        notice('Общий шаблон загружен.');
      }
    } catch {
      notice('Сервер недоступен. Используется сохранённая копия этого браузера.', true);
    }
  }
  async function loadAccess() {
    try {
      const response = await fetch('/admin/api/session', { credentials: 'include' });
      if (!response.ok) return;
      const data = await response.json();
      state.isAdmin = ['owner', 'admin'].includes(String(data.user?.role || ''));
      document.body.classList.toggle('admin-mode', state.isAdmin);
      if (state.isAdmin) {
        $('data-help').textContent = 'Excel обрабатывается и не сохраняется';
        $('canvas-help').textContent =
          'Перетаскивайте блоки. Потяните за угол, чтобы изменить размер.';
        loadHistory();
      }
    } catch {
      state.isAdmin = false;
    }
  }
  const historyActionNames = {
    save: 'сохранил товар',
    archive: 'переместил в архив',
    restore: 'восстановил товар',
    duplicate: 'создал копию товара',
    import: 'сохранил импортированный список',
  };
  async function loadHistory() {
    if (!state.isAdmin) return;
    try {
      const response = await fetch(`/admin/api/pricegenerator/history${cityQuery()}`, {
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error();
      $('product-history').innerHTML = data.history?.length
        ? data.history
            .slice(0, 20)
            .map(
              (event) =>
                `<div><strong>${esc(event.username)}</strong> ${esc(historyActionNames[event.type] || event.type)}${event.productName ? ` «${esc(event.productName)}»` : ''}<time>${new Date(event.at).toLocaleString('ru-RU')}</time></div>`,
            )
            .join('')
        : 'История пока пуста.';
    } catch {
      $('product-history').textContent = 'История временно недоступна.';
    }
  }
  async function confirmPrint(summary) {
    const dialog = $('print-confirm');
    $('print-summary').innerHTML = summary;
    dialog.showModal();
    return new Promise((resolve) => {
      dialog.addEventListener('close', () => resolve(dialog.returnValue === 'confirm'), {
        once: true,
      });
    });
  }
  async function preparePrint(mode) {
    syncSettings();
    const rollMode = mode === 'roll' || mode === 'test';
    const sourceProducts = rollMode ? [product()] : state.products.filter((item) => !item.archived);
    const products = sourceProducts.flatMap((p) =>
      Array.from({ length: mode === 'test' ? 1 : Math.max(1, number('copies', 1)) }, () => p),
    );
    if (!products.length) return notice('Нет товаров для печати.', true);
    printRoot.replaceChildren();
    const printSettings = $('print-page-settings');
    if (rollMode) {
      printSettings.textContent = `@media print{@page{size:${state.label.width}mm ${state.label.height}mm;margin:0!important}html,body{width:${state.label.width}mm!important;height:${state.label.height}mm!important;min-width:0!important;margin:0!important;padding:0!important;overflow:hidden!important}#print-root{width:${state.label.width}mm!important;height:auto!important;margin:0!important;padding:0!important}.print-page{width:${state.label.width}mm!important;height:${state.label.height}mm!important;margin:0!important;padding:0!important;overflow:hidden!important}.print-label{width:${state.label.width}mm!important;height:${state.label.height}mm!important;margin:0!important;transform:translate(${state.label.offsetX || 0}mm,${state.label.offsetY || 0}mm)}.test-print .print-label{outline:.3mm solid #000!important;outline-offset:-.3mm}}`;
      for (const item of products) {
        const page = document.createElement('section');
        page.className = 'print-page';
        if (mode === 'test') page.classList.add('test-print');
        page.append(buildLabel(item, true));
        printRoot.append(page);
      }
    } else {
      const usableW = state.paper.width - state.paper.margin * 2,
        usableH = state.paper.height - state.paper.margin * 2;
      const cols = Math.max(
        1,
        Math.floor((usableW + state.paper.gapX) / (state.label.width + state.paper.gapX)),
      );
      const rows = Math.max(
        1,
        Math.floor((usableH + state.paper.gapY) / (state.label.height + state.paper.gapY)),
      );
      const per = cols * rows;
      printSettings.textContent = `@media print{@page{size:${state.paper.width}mm ${state.paper.height}mm;margin:${state.paper.margin}mm}.print-page{width:${usableW}mm;height:${usableH}mm;grid-template-columns:repeat(${cols},${state.label.width}mm);grid-auto-rows:${state.label.height}mm;gap:${state.paper.gapY}mm ${state.paper.gapX}mm}.print-label{width:${state.label.width}mm!important;height:${state.label.height}mm!important}}`;
      products.forEach((item, i) => {
        if (i % per === 0) {
          const page = document.createElement('section');
          page.className = 'print-page';
          printRoot.append(page);
        }
        printRoot.lastElementChild.append(buildLabel(item, true));
      });
    }
    Object.assign(printRoot.style, {
      display: 'block',
      position: 'fixed',
      visibility: 'hidden',
      left: '-10000px',
      top: '0',
    });
    for (const label of printRoot.querySelectorAll('.print-label')) fitLabel(label);
    printRoot.removeAttribute('style');
    notice(
      rollMode
        ? `Выбранный товар подготовлен: ${products.length} этикеток, размер ${state.label.width} × ${state.label.height} мм.`
        : `Подготовлено этикеток: ${products.length}. В окне печати выберите масштаб 100%.`,
    );
    const accepted = await confirmPrint(
      `<dl><dt>Товар</dt><dd>${mode === 'sheet' ? `Все активные товары (${products.length})` : esc(product().name)}</dd><dt>Копий</dt><dd>${products.length}</dd><dt>Размер</dt><dd>${state.label.width} × ${state.label.height} мм</dd><dt>Дата</dt><dd>${esc($('made-date').value)} ${esc($('made-time').value)}</dd><dt>Калибровка</dt><dd>X: ${state.label.offsetX || 0} мм, Y: ${state.label.offsetY || 0} мм</dd></dl>`,
    );
    if (accepted) setTimeout(() => window.print(), 80);
  }
  async function loadDefaults() {
    try {
      const savedResponse = await fetch(`/api/pricegenerator/products${cityQuery()}`);
      const savedData = await savedResponse.json();
      if (!savedResponse.ok) throw new Error(savedData.error || 'Ошибка загрузки');
      if (Array.isArray(savedData.products)) state.products = savedData.products;
      else if (state.city === 'aktau') {
        const response = await fetch('/pricegenerator/products.json');
        state.products = await response.json();
      } else state.products = [];
      state.products = state.products.map((item) => ({
        ...item,
        expiryUnit: item.expiryUnit || 'days',
        archived: Boolean(item.archived),
      }));
      const firstActive = state.products.findIndex((item) => !item.archived);
      selectProduct(firstActive >= 0 ? firstActive : 0);
      if (!state.products.length)
        notice(
          `Для города ${state.city === 'astana' ? 'Астана' : 'Актау'} товары ещё не добавлены. Администратор может загрузить Excel или добавить товар вручную.`,
        );
      history.length = 0;
      historyIndex = -1;
      recordHistory();
    } catch {
      notice('Не удалось загрузить исходный список.', true);
    }
  }
  $('made-date').value = new Date().toISOString().slice(0, 10);
  $('city-select').value = state.city;
  $('city-select').addEventListener('change', (event) => {
    const city = event.target.value;
    localStorage.setItem('bulka-pricegenerator-city', city);
    const url = new URL(location.href);
    url.searchParams.set('city', city);
    location.assign(url.toString());
  });
  let renderedDate = $('made-date').value;
  for (const [id, value] of [
    ['label-width', state.label.width],
    ['label-height', state.label.height],
    ['label-radius', state.label.radius],
    ['background', state.label.background],
    ['foreground', state.label.foreground],
    ['offset-x', state.label.offsetX || 0],
    ['offset-y', state.label.offsetY || 0],
    ['paper-width', state.paper.width],
    ['paper-height', state.paper.height],
    ['gap-x', state.paper.gapX],
    ['gap-y', state.paper.gapY],
    ['page-margin', state.paper.margin],
  ])
    $(id).value = String(value);
  $('excel-file').addEventListener('change', async (event) => {
    if (!state.isAdmin) return;
    const file = event.target.files[0];
    if (!file) return;
    const form = new FormData();
    form.append('file', file);
    notice('Читаю Excel…');
    try {
      const response = await fetch('/admin/api/pricegenerator/import', {
        method: 'POST',
        body: form,
        credentials: 'include',
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка импорта');
      state.products = data.products;
      dirtyProductIds.clear();
      for (const item of state.products) dirtyProductIds.add(item.id);
      selectProduct(0);
      recordHistory();
      notice(`Импортировано товаров: ${state.products.length}.`);
    } catch (error) {
      notice(
        error.message === "Unexpected token '<'"
          ? 'Войдите в админку и повторите импорт.'
          : error.message,
        true,
      );
    }
    event.target.value = '';
  });
  $('product-select').addEventListener('change', (e) => selectProduct(e.target.value));
  $('search-products').addEventListener('input', renderProducts);
  $('product-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-save-product]')) {
      saveProducts();
      return;
    }
    if (e.target.closest('[data-duplicate-product]')) {
      duplicateSelectedProduct();
      return;
    }
    if (e.target.closest('[data-archive-product]')) {
      toggleArchiveSelectedProduct();
      return;
    }
    const row = e.target.closest('.product-row');
    if (row && !e.target.matches('input, textarea')) selectProduct(row.dataset.index);
  });
  $('product-list').addEventListener('input', (e) => {
    if (!state.isAdmin || !e.target.dataset.edit) return;
    state.products[state.selectedProduct][e.target.dataset.edit] = e.target.value;
    dirtyProductIds.add(product().id);
    const badge = e.target.closest('.product-row').querySelector('.unsaved-badge');
    if (!badge) {
      const marker = document.createElement('em');
      marker.className = 'unsaved-badge';
      marker.textContent = 'Не сохранено';
      e.target.closest('.product-row').querySelector('strong').append(marker);
    }
    const saveButton = e.target.closest('.product-row').querySelector('[data-save-product]');
    if (saveButton) saveButton.textContent = 'Сохранить изменения';
    renderStage();
    recordHistory();
  });
  $('product-list').addEventListener('change', (e) => {
    if (state.isAdmin && e.target.dataset.edit) {
      state.products[state.selectedProduct][e.target.dataset.edit] = e.target.value;
      dirtyProductIds.add(product().id);
      renderProducts();
      renderStage();
    }
  });
  $('add-product').addEventListener('click', () => {
    if (!state.isAdmin) return;
    state.products.unshift({
      id: crypto.randomUUID(),
      name: 'Новый товар',
      composition: 'Құрамы: . Состав: .',
      price: '0',
      expiry: '1',
      expiryUnit: 'days',
      barcode: '',
      archived: false,
    });
    dirtyProductIds.add(state.products[0].id);
    selectProduct(0);
    recordHistory();
    notice('Новый товар добавлен. Заполните поля и нажмите «Сохранить товар».');
  });
  async function persistProducts(successMessage, action = { type: 'save' }) {
    const response = await fetch(`/admin/api/pricegenerator/products${cityQuery()}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: state.products, action }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Ошибка сохранения');
    notice(successMessage);
  }
  async function saveProducts() {
    if (!state.isAdmin) return;
    const item = product();
    if (!item.name.trim()) return notice('Введите название товара.', true);
    if (!/^\d+(?:[.,]\d+)?$/.test(item.price) || Number(item.price.replace(',', '.')) < 0)
      return notice('Введите корректную цену, например 535.', true);
    const expiryLimit = item.expiryUnit === 'hours' ? 87600 : 3650;
    if (!/^\d+$/.test(item.expiry) || Number(item.expiry) < 0 || Number(item.expiry) > expiryLimit)
      return notice(
        `Срок годности должен быть целым количеством ${item.expiryUnit === 'hours' ? 'часов' : 'дней'}.`,
        true,
      );
    if (item.barcode && !validEan(item.barcode))
      return notice('Штрихкод должен содержать 13 цифр.', true);
    const duplicate = state.products.find(
      (candidate) =>
        candidate.id !== item.id &&
        item.barcode &&
        String(candidate.barcode) === String(item.barcode),
    );
    if (duplicate)
      return notice(`Этот штрихкод уже используется товаром «${duplicate.name}».`, true);
    try {
      await persistProducts(`Товар «${item.name}» сохранён для всех устройств.`, {
        type: 'save',
        productId: item.id,
        productName: item.name,
      });
      dirtyProductIds.clear();
      renderProducts();
      loadHistory();
    } catch (error) {
      notice(error.message, true);
    }
  }
  async function duplicateSelectedProduct() {
    if (!state.isAdmin) return;
    const source = product();
    const copy = {
      ...structuredClone(source),
      id: crypto.randomUUID(),
      name: `${source.name} — копия`,
      barcode: '',
      archived: false,
    };
    state.products.unshift(copy);
    state.selectedProduct = 0;
    dirtyProductIds.add(copy.id);
    renderProducts();
    renderStage();
    notice('Копия создана. Укажите новый штрихкод и сохраните товар.');
  }
  async function toggleArchiveSelectedProduct() {
    if (!state.isAdmin || !state.products.length) return;
    const item = product();
    const restoring = Boolean(item.archived);
    if (
      !window.confirm(
        `${restoring ? 'Восстановить' : 'Переместить в архив'} товар «${item.name || 'Без названия'}»?`,
      )
    )
      return;
    const previous = structuredClone(state.products);
    item.archived = !restoring;
    try {
      await persistProducts(
        `Товар «${item.name || 'Без названия'}» ${restoring ? 'восстановлен' : 'перемещён в архив'}.`,
        { type: restoring ? 'restore' : 'archive', productId: item.id, productName: item.name },
      );
      dirtyProductIds.delete(item.id);
      const nextActive = state.products.findIndex((candidate) => !candidate.archived);
      if (!restoring && nextActive >= 0) state.selectedProduct = nextActive;
      renderProducts();
      renderStage();
      recordHistory();
      loadHistory();
    } catch (error) {
      state.products = previous;
      renderProducts();
      renderStage();
      notice(error.message, true);
    }
  }
  const liveSettingIds = [
    'label-width',
    'label-height',
    'label-radius',
    'background',
    'foreground',
    'paper-width',
    'paper-height',
    'gap-x',
    'gap-y',
    'page-margin',
    'offset-x',
    'offset-y',
    'made-date',
    'made-time',
    'date-format',
  ];
  for (const id of liveSettingIds) {
    $(id).addEventListener('input', () => {
      syncSettings();
      recordHistory();
    });
    $(id).addEventListener('change', () => {
      syncSettings();
      recordHistory();
    });
  }
  window.setInterval(() => {
    const currentDate = $('made-date').value;
    if (currentDate === renderedDate) return;
    renderedDate = currentDate;
    renderStage();
    recordHistory();
  }, 100);
  $('print-mode').addEventListener('change', () => {
    $('paper-settings').hidden = $('print-mode').value !== 'sheet';
  });
  $('paper-preset').addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    const [w, h] = e.target.value.split('x');
    $('paper-width').value = w;
    $('paper-height').value = h;
    syncSettings();
    recordHistory();
  });
  $('show-archived').addEventListener('change', renderProducts);
  for (const [id, key] of [
    ['field-x', 'x'],
    ['field-y', 'y'],
    ['field-w', 'w'],
    ['field-h', 'h'],
    ['font-size', 'font'],
  ])
    $(id).addEventListener('input', () => {
      state.layout[state.selected][key] = number(id, state.layout[state.selected][key]);
      renderStage();
      recordHistory();
    });
  $('text-align').addEventListener('change', (e) => {
    state.layout[state.selected].align = e.target.value;
    renderStage();
    recordHistory();
  });
  $('font-weight').addEventListener('change', (e) => {
    state.layout[state.selected].weight = Number(e.target.value);
    renderStage();
    recordHistory();
  });
  $('line-height').addEventListener('change', (e) => {
    state.layout[state.selected].lineHeight = Number(e.target.value);
    renderStage();
    recordHistory();
  });
  $('language-break').addEventListener('change', (e) => {
    state.layout.composition.breakLanguages = e.target.checked;
    renderStage();
    recordHistory();
  });
  $('field-visible').addEventListener('change', (e) => {
    state.layout[state.selected].visible = e.target.checked;
    renderStage();
    recordHistory();
  });
  $('reset-field').addEventListener('click', () => {
    if (!state.isAdmin) return;
    state.layout[state.selected] = structuredClone(defaults[state.selected]);
    renderStage();
    recordHistory();
    notice(`Оформление блока «${names[state.selected]}» сброшено.`);
  });
  $('zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(1.8, state.zoom + 0.1);
    renderStage();
    recordHistory();
  });
  $('zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(0.5, state.zoom - 0.1);
    renderStage();
    recordHistory();
  });
  $('zoom-actual').addEventListener('click', () => {
    state.zoom = 96 / 25.4 / 6;
    renderStage();
    notice('Предпросмотр установлен в физический масштаб 1:1 для экрана 96 DPI.');
  });
  document.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'z' && !event.shiftKey) {
      event.preventDefault();
      restoreHistory(historyIndex - 1);
    } else if (key === 'y' || (key === 'z' && event.shiftKey)) {
      event.preventDefault();
      restoreHistory(historyIndex + 1);
    }
  });
  $('save-template').addEventListener('click', async () => {
    if (!state.isAdmin) return;
    syncSettings();
    const button = $('save-template');
    const template = { layout: state.layout, label: state.label, paper: state.paper };
    localStorage.setItem(templateStorageKey(), JSON.stringify(template));
    button.disabled = true;
    button.textContent = 'Сохранение...';
    try {
      const response = await fetch(`/admin/api/pricegenerator/template${cityQuery()}`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка сохранения');
      notice(
        `Шаблон города ${state.city === 'astana' ? 'Астана' : 'Актау'} сохранён для всех сотрудников и устройств.`,
      );
    } catch (error) {
      notice(`${error.message}. Локальная резервная копия сохранена.`, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Сохранить шаблон';
    }
  });
  $('print-sheet').addEventListener('click', () => preparePrint('sheet'));
  $('print-xprinter').addEventListener('click', () => preparePrint('roll'));
  $('test-print').addEventListener('click', () => preparePrint('test'));
  window.addEventListener('beforeunload', (event) => {
    if (!dirtyProductIds.size) return;
    event.preventDefault();
    event.returnValue = '';
  });
  $('center-horizontal').addEventListener('click', () => {
    const cfg = state.layout[state.selected];
    cfg.x = Math.max(0, (state.label.width - cfg.w) / 2);
    renderStage();
    recordHistory();
    notice(`Блок «${names[state.selected]}» выровнен по центру по ширине.`);
  });
  $('center-vertical').addEventListener('click', () => {
    const cfg = state.layout[state.selected];
    cfg.y = Math.max(0, (state.label.height - cfg.h) / 2);
    renderStage();
    recordHistory();
    notice(`Блок «${names[state.selected]}» выровнен по центру по высоте.`);
  });
  loadAccess().finally(() => loadSharedTemplate().finally(loadDefaults));
})();

(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
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
    saved = JSON.parse(localStorage.getItem('bulka-label-designer-v1') || 'null');
  } catch {
    localStorage.removeItem('bulka-label-designer-v1');
  }
  const state = {
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
    },
    paper: saved?.paper || { width: 210, height: 297, gapX: 3, gapY: 3, margin: 5 },
  };
  const history = [];
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
    $('date-format').value = snapshot.dateFormat;
    renderedDate = snapshot.madeDate;
    for (const [id, value] of [
      ['label-width', state.label.width],
      ['label-height', state.label.height],
      ['label-radius', state.label.radius],
      ['background', state.label.background],
      ['foreground', state.label.foreground],
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
  function expiryDate(days) {
    const date = new Date(`${$('made-date').value}T12:00:00`);
    date.setDate(date.getDate() + Math.max(0, Number(days) || 0));
    return formatDate(date);
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
      return `ИЗГОТОВЛЕНО: ${formatDate(new Date(`${$('made-date').value}T12:00:00`))}<br>ГОДЕН ДО: ${expiryDate(item.expiry)}`;
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
        elementContent(key, item) + (!print ? '<i class="resize" aria-hidden="true"></i>' : '');
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
  function renderStage() {
    const fresh = buildLabel(product());
    stage.replaceWith(fresh);
    fresh.id = 'label-stage';
    stage = fresh;
    bindStage(fresh);
    fitLabel(fresh, true);
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
    $('product-select').innerHTML = state.products
      .map(
        (p, i) =>
          `<option value="${i}"${i === state.selectedProduct ? ' selected' : ''}>${esc(p.name)}</option>`,
      )
      .join('');
    const filtered = state.products
      .map((p, i) => ({ p, i }))
      .filter(({ p }) => `${p.name} ${p.barcode}`.toLowerCase().includes(q));
    $('product-count').textContent = `${state.products.length} позиций`;
    $('upload-status').textContent = `Загружено товаров: ${state.products.length}`;
    $('product-list').innerHTML = filtered
      .map(
        ({ p, i }) =>
          `<article class="product-row ${i === state.selectedProduct ? 'active' : ''}" data-index="${i}"><strong>${esc(p.name || 'Без названия')}</strong><small><span>${esc(p.barcode)}</span><span>${esc(p.price)} ₸</span></small>${i === state.selectedProduct ? `<input data-edit="name" value="${esc(p.name)}" aria-label="Название"><input data-edit="price" value="${esc(p.price)}" aria-label="Цена"><input data-edit="barcode" value="${esc(p.barcode)}" aria-label="Штрихкод"><textarea data-edit="composition" rows="5" aria-label="Состав" placeholder="Введите состав. Enter начинает новую строку.">${esc(p.composition)}</textarea>` : ''}</article>`,
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
    state.paper = structuredClone(template.paper);
    for (const [id, value] of [
      ['label-width', state.label.width],
      ['label-height', state.label.height],
      ['label-radius', state.label.radius],
      ['background', state.label.background],
      ['foreground', state.label.foreground],
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
      const response = await fetch('/api/pricegenerator/template');
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка загрузки');
      if (data.template) {
        applyTemplate(data.template);
        localStorage.setItem('bulka-label-designer-v1', JSON.stringify(data.template));
        notice('Общий шаблон загружен.');
      }
    } catch {
      notice('Сервер недоступен. Используется сохранённая копия этого браузера.', true);
    }
  }
  function preparePrint(mode) {
    syncSettings();
    const sourceProducts = mode === 'roll' ? [product()] : state.products;
    const products = sourceProducts.flatMap((p) =>
      Array.from({ length: Math.max(1, number('copies', 1)) }, () => p),
    );
    if (!products.length) return notice('Нет товаров для печати.', true);
    printRoot.replaceChildren();
    const printSettings = $('print-page-settings');
    if (mode === 'roll') {
      printSettings.textContent = `@media print{@page{size:${state.label.width}mm ${state.label.height}mm;margin:0!important}html,body{width:${state.label.width}mm!important;height:${state.label.height}mm!important;min-width:0!important;margin:0!important;padding:0!important;overflow:hidden!important}#print-root{width:${state.label.width}mm!important;height:auto!important;margin:0!important;padding:0!important}.print-page{width:${state.label.width}mm!important;height:${state.label.height}mm!important;margin:0!important;padding:0!important;overflow:hidden!important}.print-label{width:${state.label.width}mm!important;height:${state.label.height}mm!important;margin:0!important}}`;
      for (const item of products) {
        const page = document.createElement('section');
        page.className = 'print-page';
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
      mode === 'roll'
        ? `Выбранный товар подготовлен: ${products.length} этикеток, размер ${state.label.width} × ${state.label.height} мм.`
        : `Подготовлено этикеток: ${products.length}. В окне печати выберите масштаб 100%.`,
    );
    setTimeout(() => window.print(), 80);
  }
  async function loadDefaults() {
    try {
      const response = await fetch('/pricegenerator/products.json');
      state.products = await response.json();
      selectProduct(0);
      history.length = 0;
      historyIndex = -1;
      recordHistory();
    } catch {
      notice('Не удалось загрузить исходный список.', true);
    }
  }
  $('made-date').value = new Date().toISOString().slice(0, 10);
  let renderedDate = $('made-date').value;
  for (const [id, value] of [
    ['label-width', state.label.width],
    ['label-height', state.label.height],
    ['label-radius', state.label.radius],
    ['background', state.label.background],
    ['foreground', state.label.foreground],
    ['paper-width', state.paper.width],
    ['paper-height', state.paper.height],
    ['gap-x', state.paper.gapX],
    ['gap-y', state.paper.gapY],
    ['page-margin', state.paper.margin],
  ])
    $(id).value = String(value);
  $('excel-file').addEventListener('change', async (event) => {
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
    const row = e.target.closest('.product-row');
    if (row && !e.target.matches('input, textarea')) selectProduct(row.dataset.index);
  });
  $('product-list').addEventListener('input', (e) => {
    if (!e.target.dataset.edit) return;
    state.products[state.selectedProduct][e.target.dataset.edit] = e.target.value;
    renderStage();
    recordHistory();
  });
  $('product-list').addEventListener('change', (e) => {
    if (e.target.dataset.edit) renderProducts();
  });
  $('add-product').addEventListener('click', () => {
    state.products.unshift({
      id: crypto.randomUUID(),
      name: 'Новый товар',
      composition: 'Құрамы: . Состав: .',
      price: '0',
      expiry: '1',
      barcode: '',
    });
    selectProduct(0);
    recordHistory();
  });
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
    'made-date',
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
    syncSettings();
    const button = $('save-template');
    const template = { layout: state.layout, label: state.label, paper: state.paper };
    localStorage.setItem('bulka-label-designer-v1', JSON.stringify(template));
    button.disabled = true;
    button.textContent = 'Сохранение...';
    try {
      const response = await fetch('/admin/api/pricegenerator/template', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Ошибка сохранения');
      notice('Общий шаблон сохранён для всех сотрудников и устройств.');
    } catch (error) {
      notice(`${error.message}. Локальная резервная копия сохранена.`, true);
    } finally {
      button.disabled = false;
      button.textContent = 'Сохранить шаблон';
    }
  });
  $('print-sheet').addEventListener('click', () => preparePrint('sheet'));
  $('print-xprinter').addEventListener('click', () => preparePrint('roll'));
  loadSharedTemplate().finally(loadDefaults);
})();

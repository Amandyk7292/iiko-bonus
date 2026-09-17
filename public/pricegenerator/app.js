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
    name: { x: 6, y: 3, w: 58, h: 7, font: 12, align: 'center', visible: true },
    composition: { x: 7, y: 11, w: 56, h: 12, font: 5.3, align: 'left', visible: true },
    barcode: { x: 10, y: 24, w: 50, h: 12, font: 5, align: 'center', visible: true },
    dates: { x: 7, y: 39, w: 38, h: 8, font: 5.2, align: 'left', visible: true },
    price: { x: 47, y: 39, w: 17, h: 8, font: 8, align: 'right', visible: true },
  };
  const saved = JSON.parse(localStorage.getItem('bulka-label-designer-v1') || 'null');
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
  const stage = $('label-stage');
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
    if (key === 'composition') return esc(item.composition);
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
  function renderStage() {
    const fresh = buildLabel(product());
    stage.replaceWith(fresh);
    fresh.id = 'label-stage';
    bindStage(fresh);
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
      };
    });
  }
  function updateControls() {
    const cfg = state.layout[state.selected];
    $('selected-name').value = names[state.selected];
    for (const [id, key] of [
      ['field-x', 'x'],
      ['field-y', 'y'],
      ['field-w', 'w'],
      ['field-h', 'h'],
      ['font-size', 'font'],
    ])
      $(id).value = String(Math.round(cfg[key] * 10) / 10);
    $('text-align').value = cfg.align;
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
          `<article class="product-row ${i === state.selectedProduct ? 'active' : ''}" data-index="${i}"><strong>${esc(p.name || 'Без названия')}</strong><small><span>${esc(p.barcode)}</span><span>${esc(p.price)} ₸</span></small>${i === state.selectedProduct ? `<input data-edit="name" value="${esc(p.name)}" aria-label="Название"><input data-edit="price" value="${esc(p.price)}" aria-label="Цена"><input data-edit="barcode" value="${esc(p.barcode)}" aria-label="Штрихкод"><input data-edit="composition" value="${esc(p.composition)}" aria-label="Состав">` : ''}</article>`,
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
  function preparePrint(mode) {
    syncSettings();
    const products = state.products.flatMap((p) =>
      Array.from({ length: Math.max(1, number('copies', 1)) }, () => p),
    );
    if (!products.length) return notice('Нет товаров для печати.', true);
    printRoot.replaceChildren();
    const style = document.createElement('style');
    if (mode === 'roll') {
      style.textContent = `@page{size:${state.label.width}mm ${state.label.height}mm;margin:0}.print-page{width:${state.label.width}mm;height:${state.label.height}mm}.print-label{width:${state.label.width}mm!important;height:${state.label.height}mm!important}`;
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
      style.textContent = `@page{size:${state.paper.width}mm ${state.paper.height}mm;margin:${state.paper.margin}mm}.print-page{width:${usableW}mm;height:${usableH}mm;grid-template-columns:repeat(${cols},${state.label.width}mm);grid-auto-rows:${state.label.height}mm;gap:${state.paper.gapY}mm ${state.paper.gapX}mm}.print-label{width:${state.label.width}mm!important;height:${state.label.height}mm!important}`;
      products.forEach((item, i) => {
        if (i % per === 0) {
          const page = document.createElement('section');
          page.className = 'print-page';
          printRoot.append(page);
        }
        printRoot.lastElementChild.append(buildLabel(item, true));
      });
    }
    printRoot.prepend(style);
    notice(`Подготовлено этикеток: ${products.length}. В окне печати выберите масштаб 100%.`);
    setTimeout(() => window.print(), 80);
  }
  async function loadDefaults() {
    try {
      const response = await fetch('/pricegenerator/products.json');
      state.products = await response.json();
      selectProduct(0);
    } catch {
      notice('Не удалось загрузить исходный список.', true);
    }
  }
  $('made-date').value = new Date().toISOString().slice(0, 10);
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
    if (row && !e.target.matches('input')) selectProduct(row.dataset.index);
  });
  $('product-list').addEventListener('input', (e) => {
    if (!e.target.dataset.edit) return;
    state.products[state.selectedProduct][e.target.dataset.edit] = e.target.value;
    renderStage();
    renderProducts();
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
  });
  for (const id of [
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
  ])
    $(id).addEventListener('input', syncSettings);
  $('print-mode').addEventListener('change', () => {
    $('paper-settings').hidden = $('print-mode').value !== 'sheet';
  });
  $('paper-preset').addEventListener('change', (e) => {
    if (e.target.value === 'custom') return;
    const [w, h] = e.target.value.split('x');
    $('paper-width').value = w;
    $('paper-height').value = h;
    syncSettings();
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
    });
  $('text-align').addEventListener('change', (e) => {
    state.layout[state.selected].align = e.target.value;
    renderStage();
  });
  $('field-visible').addEventListener('change', (e) => {
    state.layout[state.selected].visible = e.target.checked;
    renderStage();
  });
  $('zoom-in').addEventListener('click', () => {
    state.zoom = Math.min(1.8, state.zoom + 0.1);
    renderStage();
  });
  $('zoom-out').addEventListener('click', () => {
    state.zoom = Math.max(0.5, state.zoom - 0.1);
    renderStage();
  });
  $('save-template').addEventListener('click', () => {
    syncSettings();
    localStorage.setItem(
      'bulka-label-designer-v1',
      JSON.stringify({ layout: state.layout, label: state.label, paper: state.paper }),
    );
    notice('Шаблон сохранён в этом браузере.');
  });
  $('print-sheet').addEventListener('click', () => preparePrint('sheet'));
  $('print-xprinter').addEventListener('click', () => preparePrint('roll'));
  loadDefaults();
})();

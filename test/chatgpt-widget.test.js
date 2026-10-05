const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// Exercise the shipped widget script and its actual RPC messages in a small DOM.
// No checkout, browser credentials, real customer or network calls are involved.
function widgetHarness() {
  let document;
  class Element {
    constructor(tag) {
      this.tagName = tag.toUpperCase();
      this.children = [];
      this.attributes = {};
      this._text = '';
      this.value = '';
      this.disabled = false;
      this.className = '';
      this.classList = {
        add: (value) => {
          this.className += ' ' + value;
        },
      };
    }
    set textContent(value) {
      this._text = String(value);
      this.children = [];
    }
    get textContent() {
      return this._text + this.children.map((child) => child.textContent).join('');
    }
    append(...children) {
      this.children.push(...children);
      for (const child of children) child.parentElement = this;
      if (this.tagName === 'SELECT' && this.children.length === children.length)
        this.value = children[0]?.value || '';
    }
    prepend(...children) {
      this.children.unshift(...children);
    }
    replaceChildren(...children) {
      this.children = [];
      this._text = '';
      this.append(...children);
    }
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    }
    querySelectorAll(selectors) {
      const tags = selectors.split(',').map((tag) => tag.trim().toUpperCase());
      const result = [];
      const visit = (element) => {
        for (const child of element.children) {
          if (tags.includes(child.tagName)) result.push(child);
          visit(child);
        }
      };
      visit(this);
      return result;
    }
    focus() {
      document.activeElement = this;
    }
    get firstChild() {
      return this.children[0];
    }
    get lastChild() {
      return this.children.at(-1);
    }
    get childElementCount() {
      return this.children.length;
    }
  }
  const roots = Object.fromEntries(
    ['content', 'basket', 'status', 'overlay'].map((id) => [id, new Element('section')]),
  );
  document = {
    getElementById: (id) => roots[id],
    createElement: (tag) => new Element(tag),
    documentElement: { scrollHeight: 600, clientWidth: 500 },
    activeElement: null,
  };
  const messages = [],
    timers = new Map(),
    requestTimers = new Map();
  let listener,
    timerId = 0;
  const parent = {
    postMessage: (message) => {
      messages.push(message);
      if (message.id) requestTimers.set(message.id, timerId);
    },
  };
  const window = {
    parent,
    addEventListener: (_name, fn) => {
      listener = fn;
    },
  };
  const html = fs.readFileSync(path.join(__dirname, '../public/chatgpt/widget.html'), 'utf8');
  const script = html.match(/<script>\s*([\s\S]*?)<\/script>/)[1];
  const context = vm.createContext({
    window,
    document,
    URL,
    Intl,
    console,
    Option: function Option(label, value) {
      const option = new Element('option');
      option.textContent = label;
      option.value = value;
      return option;
    },
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    clearTimeout: (id) => timers.delete(id),
  });
  vm.runInContext(script, context, { filename: 'public/chatgpt/widget.html' });
  const send = (message, source = parent) => listener({ source, data: message });
  const reply = (request, result) => send({ jsonrpc: '2.0', id: request.id, result });
  const reject = (request, message) =>
    send({ jsonrpc: '2.0', id: request.id, error: { code: -32602, message } });
  const timeout = (request) => {
    const id = requestTimers.get(request.id),
      timer = timers.get(id);
    assert.ok(timer, 'Missing RPC timeout');
    timers.delete(id);
    timer();
  };
  const result = (data) =>
    send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { structuredContent: data },
    });
  const buttons = (root = roots.content) => root.querySelectorAll('button');
  const findButton = (label, root = roots.content) => {
    const found = buttons(root).find(
      (button) => button.textContent === label || button.attributes['aria-label'] === label,
    );
    assert.ok(found, `Missing widget button: ${label}`);
    return found;
  };
  const click = (button) => {
    assert.equal(button.disabled, false);
    return button.onclick({ preventDefault() {} });
  };
  const flush = async () => {
    await new Promise(setImmediate);
  };
  const ready = async () => {
    reply(
      messages.find((message) => message.method === 'ui/initialize'),
      { protocolVersion: '2026-01-26' },
    );
    await flush();
  };
  const toolRequest = (name) =>
    messages.findLast((message) => message.method === 'tools/call' && message.params.name === name);
  return {
    roots,
    messages,
    send,
    reply,
    reject,
    timeout,
    result,
    buttons,
    findButton,
    click,
    flush,
    ready,
    toolRequest,
  };
}

const branch = {
  id: '89f46387-37aa-4916-b3bb-9d453028cb51',
  name: '19-й микрорайон',
  city: 'Актау',
  address: '19/33',
  pickupEnabled: true,
  preorderEnabled: true,
  deliveryEnabled: false,
};
const product = {
  id: 'bun',
  name: 'Булочка',
  price: 500,
  unit: 'шт.',
  quantityStep: 1,
  availableQuantity: 99,
  isAvailable: true,
  onlineOrderable: true,
  categoryId: 'bread',
};
const menu = {
  view: 'menu',
  branch,
  orderType: 'pickup',
  products: [product],
  categories: [{ id: 'bread', name: 'Выпечка' }],
  query: '',
  categoryId: '',
  limit: 24,
  offset: 0,
  hasMore: false,
};
const cart = (items, extra = {}) => ({
  view: 'cart',
  branch,
  orderType: 'pickup',
  items,
  itemSubtotal: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
  requiresSelection: false,
  checkoutUrl: 'https://bulka.com.kz/?chatgptCart=temporary-draft',
  ...extra,
});
const cartItem = (quantity = 1, p = product) => ({
  id: p.id,
  quantity,
  price: p.price,
  unit: p.unit,
  quantityStep: p.quantityStep,
  product: p,
  modifiers: [],
});

test('widget adds products with a public no-options flag immediately and still checks basket on the server', async () => {
  const app = widgetHarness();
  await app.ready();
  app.result({ ...menu, products: [{ ...product, hasOptions: false }] });
  app.click(app.findButton('Добавить'));
  assert.match(app.roots.basket.textContent, /Булочка/);
  assert.equal(app.toolRequest('get_bulka_product_options'), undefined);
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  const request = app.toolRequest('prepare_bulka_cart');
  assert.equal(request.params.arguments.items[0].quantity, 1);
  app.reply(request, { structuredContent: cart([cartItem()]) });
  await checking;
});

test('widget keeps existing basket until a different incoming cart is explicitly accepted', async () => {
  const app = widgetHarness();
  await app.ready();
  app.result(cart([cartItem()]));
  assert.match(app.roots.basket.textContent, /Булочка/);
  const second = { ...product, id: 'cake', name: 'Торт', price: 4000 };
  app.result(cart([cartItem(1, second)]));
  assert.match(app.roots.basket.textContent, /Булочка/);
  assert.doesNotMatch(app.roots.basket.textContent, /Торт/);
  app.click(app.findButton('Оставить мою корзину', app.roots.overlay));
  assert.match(app.roots.basket.textContent, /Булочка/);
  app.result(cart([cartItem(1, second)]));
  app.click(app.findButton('Заменить корзину', app.roots.overlay));
  assert.match(app.roots.basket.textContent, /Торт/);
  assert.doesNotMatch(app.roots.basket.textContent, /Булочка/);
});

test('widget reprices the same basket without losing names or selections and sends context requests', async () => {
  const app = widgetHarness();
  await app.ready();
  app.result(cart([cartItem()]));
  app.result(cart([{ ...cartItem(), price: 550 }], { itemSubtotal: 550 }));
  assert.equal(app.roots.overlay.childElementCount, 0);
  assert.match(app.roots.basket.textContent, /550/);
  app.click(app.findButton('Увеличить количество Булочка', app.roots.basket));
  const context = app.messages.findLast((message) => message.method === 'ui/update-model-context');
  assert.ok(context.id);
  assert.equal(JSON.parse(context.params.content[0].text).items[0].quantity, 2);
  assert.doesNotMatch(app.roots.basket.textContent, /Оформить на Bulka/);
  assert.match(app.roots.basket.textContent, /Предварительно/);
});

test('widget obeys quantity 99 and aggregate stock limits and never prepares quantity 100', async () => {
  const app = widgetHarness();
  await app.ready();
  app.result(cart([cartItem(99)]));
  app.click(app.findButton('Увеличить количество Булочка', app.roots.basket));
  assert.match(app.roots.status.textContent, /недоступно/);
  assert.match(app.roots.basket.textContent, /99 шт/);
  assert.equal(
    app.messages.filter((message) => message.method === 'ui/update-model-context').length,
    0,
  );
  app.click(app.findButton('Уменьшить количество Булочка', app.roots.basket));
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  const request = app.toolRequest('prepare_bulka_cart');
  assert.equal(request.params.arguments.items[0].quantity, 98);
  app.reply(request, { structuredContent: cart([cartItem(98)]) });
  await checking;
});

test('widget omits empty optional modifiers and keeps required variants with their current deltas', async () => {
  const app = widgetHarness();
  await app.ready();
  app.result(menu);
  const configuring = app.click(app.findButton('Добавить'));
  const options = {
    configuration: null,
    modifierGroups: [
      {
        id: 'optional',
        title: { ru: 'Добавки' },
        selectionType: 'multiple',
        minSelected: 0,
        maxSelected: 2,
        options: [{ id: 'cream', title: { ru: 'Крем' }, priceDelta: 50 }],
      },
      {
        id: 'size',
        title: { ru: 'Размер' },
        selectionType: 'single',
        required: true,
        minSelected: 1,
        maxSelected: 1,
        options: [{ id: 'large', title: { ru: 'Большой' }, priceDelta: 100, isDefault: true }],
      },
    ],
  };
  app.reply(app.toolRequest('get_bulka_product_options'), {
    structuredContent: { view: 'options', options },
  });
  await configuring;
  app.click(app.findButton('Добавить', app.roots.overlay));
  assert.match(app.roots.basket.textContent, /600/);
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  const request = app.toolRequest('prepare_bulka_cart');
  assert.deepEqual(JSON.parse(JSON.stringify(request.params.arguments.items[0].modifiers)), [
    { groupId: 'size', optionIds: ['large'] },
  ]);
  app.reply(request, {
    structuredContent: cart([
      { ...cartItem(), price: 600, modifiers: [{ groupId: 'size', optionIds: ['large'] }] },
    ]),
  });
  await checking;
  assert.equal(app.roots.overlay.childElementCount, 0);
});

test('widget retains search and category across pagination and renders standalone options results', async () => {
  const app = widgetHarness();
  await app.ready();
  app.result({ ...menu, query: 'булоч', categoryId: 'bread', limit: 10, hasMore: true });
  const paging = app.click(app.findButton('Ещё товары'));
  const request = app.toolRequest('get_bulka_menu');
  assert.equal(request.params.arguments.query, 'булоч');
  assert.equal(request.params.arguments.categoryId, 'bread');
  assert.equal(request.params.arguments.limit, 10);
  app.reply(request, { structuredContent: menu });
  await paging;
  app.result({
    view: 'options',
    branch,
    orderType: 'pickup',
    productId: product.id,
    product,
    options: { configuration: null, modifierGroups: [] },
  });
  assert.match(app.roots.content.textContent, /Булочка/);
  assert.ok(app.findButton('Добавить'));
  assert.doesNotMatch(app.roots.content.textContent, /Выберите варианты|Выбрать варианты/);
});

test('standalone options without active variants show the real price and add directly without a second options fetch', async () => {
  const app = widgetHarness();
  await app.ready();
  const pretzel = { ...product, id: 'pretzel', name: 'Брецель', price: 350 };
  app.result({
    view: 'options',
    branch,
    orderType: 'preorder',
    productId: pretzel.id,
    product: pretzel,
    options: {
      configuration: {
        enabled: false,
        productKind: 'cake',
        weightOptions: [{ code: 'disabled', priceDelta: 100 }],
      },
      modifierGroups: [],
    },
  });
  assert.match(app.roots.content.textContent, /350 ₸ \/ шт\./);
  assert.match(app.roots.content.textContent, /Вариантов нет/);
  assert.doesNotMatch(app.roots.content.textContent, /Выберите варианты|Выбрать варианты/);
  app.click(app.findButton('Добавить'));
  assert.match(app.roots.basket.textContent, /Брецель/);
  assert.match(app.roots.basket.textContent, /350/);
  assert.equal(app.roots.overlay.childElementCount, 0);
  assert.equal(app.toolRequest('get_bulka_product_options'), undefined);
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  const request = app.toolRequest('prepare_bulka_cart');
  assert.equal(request.params.arguments.orderType, 'preorder');
  assert.deepEqual(JSON.parse(JSON.stringify(request.params.arguments.items)), [
    { id: 'pretzel', quantity: 1 },
  ]);
  app.reply(request, {
    structuredContent: cart([cartItem(1, pretzel)], { orderType: 'preorder' }),
  });
  await checking;
});

test('standalone options keep actual available variants and block unavailable products', async () => {
  const app = widgetHarness();
  await app.ready();
  const options = {
    configuration: null,
    modifierGroups: [
      {
        id: 'size',
        title: { ru: 'Размер' },
        selectionType: 'single',
        required: true,
        minSelected: 1,
        maxSelected: 1,
        options: [{ id: 'large', title: { ru: 'Большой' }, priceDelta: 100, isDefault: true }],
      },
    ],
  };
  app.result({
    view: 'options',
    branch,
    orderType: 'pickup',
    productId: product.id,
    product: { ...product, hasOptions: false },
    options,
  });
  await app.click(app.findButton('Выбрать варианты'));
  app.click(app.findButton('Добавить', app.roots.overlay));
  assert.match(app.roots.basket.textContent, /600/);
  const unavailable = widgetHarness();
  await unavailable.ready();
  unavailable.result({
    view: 'options',
    branch,
    orderType: 'pickup',
    productId: product.id,
    product: { ...product, isAvailable: false, onlineOrderable: false, inStopList: true },
    options: { configuration: null, modifierGroups: [] },
  });
  assert.match(unavailable.roots.content.textContent, /Нет в наличии/);
  assert.equal(unavailable.findButton('Добавить').disabled, true);
  assert.equal(unavailable.roots.basket.childElementCount, 0);
});

test('widget single-choice options preserve the chosen checkbox and allow incomplete cart editing', async () => {
  const app = widgetHarness();
  await app.ready();
  const options = {
    configuration: null,
    modifierGroups: [
      {
        id: 'size',
        title: { ru: 'Размер' },
        selectionType: 'single',
        required: true,
        minSelected: 1,
        maxSelected: 1,
        options: [
          { id: 'small', title: { ru: 'Маленький' }, priceDelta: 50 },
          { id: 'large', title: { ru: 'Большой' }, priceDelta: 100 },
        ],
      },
    ],
  };
  app.result(
    cart([{ ...cartItem(), requiresSelection: true, options }], {
      requiresSelection: true,
      itemSubtotal: null,
    }),
  );
  await app.click(app.findButton('Выбрать варианты', app.roots.basket));
  const [first, second] = app.roots.overlay.querySelectorAll('input');
  first.checked = true;
  first.onchange();
  assert.equal(first.checked, true);
  second.checked = true;
  second.onchange();
  assert.equal(first.checked, false);
  assert.equal(second.checked, true);
  app.click(app.findButton('Сохранить варианты', app.roots.overlay));
  assert.match(app.roots.basket.textContent, /600/);
  assert.doesNotMatch(app.roots.basket.textContent, /Нужно выбрать варианты/);
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  const request = app.toolRequest('prepare_bulka_cart');
  assert.equal(request.params.arguments.items[0].quantity, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(request.params.arguments.items[0].modifiers)), [
    { groupId: 'size', optionIds: ['large'] },
  ]);
  app.reply(request, {
    structuredContent: cart([
      { ...cartItem(), price: 600, modifiers: [{ groupId: 'size', optionIds: ['large'] }] },
    ]),
  });
  await checking;
});

test('widget does not present incomplete pricing as final and rejects foreign iframe messages and links', async () => {
  const app = widgetHarness();
  await app.ready();
  app.send(
    {
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { structuredContent: cart([cartItem()]) },
    },
    {},
  );
  assert.equal(app.roots.basket.childElementCount, 0);
  app.result(
    cart([{ ...cartItem(), requiresSelection: true }], {
      requiresSelection: true,
      itemSubtotal: null,
      knownItemSubtotal: 500,
      checkoutUrl: 'https://bulka.com.kz:8443/?chatgptCart=invalid-origin',
    }),
  );
  assert.match(app.roots.basket.textContent, /Нужно выбрать варианты/);
  assert.doesNotMatch(app.roots.basket.textContent, /500/);
  assert.equal(app.roots.basket.querySelectorAll('a').length, 0);
});

async function basketHarness() {
  const app = widgetHarness();
  await app.ready();
  app.result({ ...menu, products: [{ ...product, hasOptions: false }] });
  app.click(app.findButton('Добавить'));
  return app;
}

function assertBasketRetainedAndEnabled(app) {
  assert.match(app.roots.basket.textContent, /Булочка/);
  assert.match(app.roots.basket.textContent, /1 шт\./);
  assert.equal(app.findButton('Проверить корзину', app.roots.basket).disabled, false);
  assert.equal(app.findButton('Увеличить количество Булочка', app.roots.basket).disabled, false);
  assert.equal(app.findButton('Добавить').disabled, false);
}

const wrappedOrderingPause = JSON.stringify({
  detail:
    "Error code: INVALID_ARGUMENT; Error: RuntimeException: Error calling MCP tool: [TextContent(type='text', text='Онлайн-заказы временно отключены', annotations=None, meta=None)]",
});

test('widget shows only the public ordering pause from the actual host RPC wrapper and keeps the basket usable', async () => {
  const app = await basketHarness();
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  assert.equal(app.findButton('Проверить корзину', app.roots.basket).disabled, true);
  assert.equal(app.findButton('Добавить').disabled, true);
  app.reject(app.toolRequest('prepare_bulka_cart'), wrappedOrderingPause);
  await checking;
  assert.equal(app.roots.status.textContent, 'Онлайн-заказы временно отключены');
  assertBasketRetainedAndEnabled(app);
  assert.equal(app.roots.basket.querySelectorAll('a').length, 0);
});

test('widget suppresses unknown host errors including internal JSON, trace content and non-string messages', async () => {
  const app = await basketHarness();
  for (const error of [
    JSON.stringify({
      detail:
        "Error code: INVALID_ARGUMENT; Error: RuntimeException: Error calling MCP tool: [TextContent(type='text', text='password=fixture-private-value', annotations=None, meta=None)]",
    }),
    'Internal backend failure: password=fixture-private-value at postgres://internal/db',
    { detail: 'fixture-private-value' },
  ]) {
    const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
    app.reject(app.toolRequest('prepare_bulka_cart'), error);
    await checking;
    assert.equal(app.roots.status.textContent, 'Не удалось выполнить запрос. Попробуйте ещё раз.');
    assert.doesNotMatch(
      app.roots.status.textContent,
      /fixture-private-value|RuntimeException|detail/,
    );
    assertBasketRetainedAndEnabled(app);
  }
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  // A malformed transport reply must not expose a browser TypeError either.
  app.reply(app.toolRequest('prepare_bulka_cart'), null);
  await checking;
  assert.equal(app.roots.status.textContent, 'Не удалось выполнить запрос. Попробуйте ещё раз.');
  assertBasketRetainedAndEnabled(app);
});

test('widget preserves plain public stock and option validation errors returned by MCP', async () => {
  const app = await basketHarness();
  for (const text of [
    'Недостаточно товара «Булочка». Обновите корзину.',
    'Проверьте количество вариантов «Размер»',
  ]) {
    const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
    app.reply(app.toolRequest('prepare_bulka_cart'), {
      isError: true,
      content: [{ type: 'text', text }],
    });
    await checking;
    assert.equal(app.roots.status.textContent, text);
    assertBasketRetainedAndEnabled(app);
  }
});

test('widget sanitizes tool-result notification errors through the same public messages without replacing a basket', async () => {
  const app = await basketHarness();
  for (const [text, expected] of [
    [wrappedOrderingPause, 'Онлайн-заказы временно отключены'],
    [
      JSON.stringify({ detail: 'fixture-private-value' }),
      'Не удалось выполнить запрос. Попробуйте ещё раз.',
    ],
    [
      "RuntimeException: [TextContent(text='password=fixture-private-value')]",
      'Не удалось выполнить запрос. Попробуйте ещё раз.',
    ],
    ['Выбранный вариант товара больше недоступен', 'Выбранный вариант товара больше недоступен'],
  ]) {
    app.send({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: {
        isError: true,
        content: [{ type: 'text', text }],
        structuredContent: cart([cartItem(1, { ...product, id: 'cake', name: 'Торт' })]),
      },
    });
    assert.equal(app.roots.status.textContent, expected);
    assert.doesNotMatch(app.roots.basket.textContent, /Торт/);
    assertBasketRetainedAndEnabled(app);
  }
});

test('widget keeps its local timeout message and releases controls while retaining the basket', async () => {
  const app = await basketHarness();
  const checking = app.click(app.findButton('Проверить корзину', app.roots.basket));
  app.timeout(app.toolRequest('prepare_bulka_cart'));
  await checking;
  assert.equal(app.roots.status.textContent, 'Нет ответа. Попробуйте ещё раз.');
  assertBasketRetainedAndEnabled(app);
});

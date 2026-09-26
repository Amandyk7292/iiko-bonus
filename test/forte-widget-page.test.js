const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../public/forte-widget.js'), 'utf8');
const id = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
const token = 'fixture-checkout-token-not-a-real-bank-token';
const base = 'https://bulka.com.kz/payments/forte-widget';
const launch = `${base}#token=${token}&order=${id}&purpose=card-setup&language=kk`;

async function page(
  url,
  storage = new Map(),
  fetchImpl = async () => {
    throw Error('Unexpected network');
  },
) {
  const elements = new Map();
  let widgetToken;
  let navigated;
  let address = new URL(url);
  const element = (name) => {
    if (!elements.has(name))
      elements.set(name, {
        hidden: false,
        textContent: '',
        listeners: {},
        classList: { add() {} },
        setAttribute() {},
        addEventListener(type, cb) {
          this.listeners[type] = cb;
        },
      });
    return elements.get(name);
  };
  const context = {
    URL,
    URLSearchParams,
    AbortSignal,
    Date,
    sessionStorage: {
      getItem: (key) => storage.get(key) || null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: (key) => storage.delete(key),
    },
    document: {
      documentElement: { classList: { add() {} } },
      body: {},
      getElementById: element,
      querySelectorAll: () => [],
    },
    MutationObserver: class {
      observe() {}
      disconnect() {}
    },
    fetch: fetchImpl,
    window: {
      location: {
        ...Object.fromEntries(['search', 'hash', 'pathname', 'origin'].map((k) => [k, address[k]])),
        replace: (url) => {
          navigated = url;
        },
      },
      history: {
        replaceState(_a, _b, url) {
          address = new URL(url, base);
        },
      },
      setTimeout: () => 1,
      clearTimeout() {},
      BeGateway: function (options) {
        widgetToken = options.token;
        this.createWidget = () => {};
      },
    },
  };
  vm.runInNewContext(source, context);
  await new Promise((resolve) => setImmediate(resolve));
  return {
    elements,
    storage,
    token: widgetToken,
    url: address.href,
    click: (name) => {
      element(name).listeners.click();
      return navigated;
    },
  };
}

test('reload preserves the same checkout without exposing its token in the address', async () => {
  const first = await page(launch);
  assert.equal(first.token, token);
  assert(!first.url.includes(token));
  const second = await page(first.url, first.storage);
  assert.equal(second.token, token);
  assert.equal(second.elements.get('page-title').textContent, 'Карта қосу');
  assert(second.click('close-payment').startsWith(`/profile?payment=forte&setup=${id}`));
  assert.equal(first.storage.size, 0);
});

test('expired tab storage is recovered through the owned server operation', async () => {
  const storage = new Map([
    [
      `bulka-forte-checkout:${id}`,
      JSON.stringify({ token: 'old-fixture-token', purpose: 'card-setup', expiresAt: 1 }),
    ],
  ]);
  const result = await page(
    `${base}?operation=${id}&purpose=card-setup&language=kk`,
    storage,
    async (url, options) => {
      assert.equal(options.credentials, 'include');
      assert(url.includes(`/card-setup/${id}?resume=1`));
      return { ok: true, json: async () => ({ paymentStatus: 'pending', redirectUrl: launch }) };
    },
  );
  assert.equal(result.token, token);
});

test('a recovery error returns to the same card operation for verification', async () => {
  const result = await page(
    `${base}?operation=${id}&purpose=card-setup&language=ru`,
    new Map(),
    async () => ({ ok: false }),
  );
  assert.equal(result.token, undefined);
  assert.equal(result.elements.get('back-to-orders').textContent, 'Вернуться к картам');
  assert.equal(
    result.click('back-to-orders'),
    `/profile?payment=forte&setup=${id}&status=returned`,
  );
});

test('recovery never opens a checkout belonging to a different operation', async () => {
  const result = await page(`${base}?operation=${id}&purpose=card-setup`, new Map(), async () => ({
    ok: true,
    json: async () => ({
      paymentStatus: 'pending',
      redirectUrl: launch.replace(id, '217615f9-b35f-4eb4-9f6d-777f2236bb25'),
    }),
  }));
  assert.equal(result.token, undefined);
  assert.equal(result.elements.get('back-to-orders').hidden, false);
});

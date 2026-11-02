const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const bootstrapSource = fs.readFileSync(
  path.join(__dirname, '..', 'BulkaAndroid', 'web', 'app_bootstrap.js'),
  'utf8',
);

class FakeElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.attributes = {};
    this.listeners = {};
    this.style = {};
    this.parentNode = null;
    this.textContent = '';
  }

  setAttribute(name, value) {
    this.attributes[name] = value;
  }

  addEventListener(name, listener) {
    this.listeners[name] = listener;
  }

  append(...elements) {
    for (const element of elements) {
      element.parentNode = this;
      this.children.push(element);
    }
  }

  appendChild(element) {
    this.append(element);
    return element;
  }

  removeChild(element) {
    this.children = this.children.filter((child) => child !== element);
    element.parentNode = null;
    return element;
  }

  click() {
    this.listeners.click?.({ target: this });
  }

  get textContentDeep() {
    return this.textContent + this.children.map((child) => child.textContentDeep).join('');
  }
}

function createPage({
  desktop = false,
  installedVersion = '',
  installerUrl = 'https://bulka.test/downloads/Bulka-Staff-Setup-1.0.2-Universal.exe',
} = {}) {
  const head = new FakeElement('head');
  const body = new FakeElement('body');
  const intervalCallbacks = [];
  const location = {
    href: `https://bulka.test/${desktop ? '?desktop=1' : ''}${desktop && installedVersion ? `&desktopVersion=${installedVersion}` : ''}`,
    origin: 'https://bulka.test',
    replaced: null,
    replace(value) { this.replaced = value; },
  };
  const downloaded = [];
  let confirmResult = false;
  const document = {
    baseURI: 'https://bulka.test/app/',
    currentScript: { src: 'https://bulka.test/app/app_bootstrap.js?v=release-current-123' },
    head,
    body,
    visibilityState: 'visible',
    createElement: (tagName) => {
      const element = new FakeElement(tagName);
      if (tagName === 'a') {
        const originalClick = element.click.bind(element);
        element.click = () => {
          downloaded.push(element.href);
          originalClick();
        };
      }
      return element;
    },
    addEventListener() {},
  };
  const window = {
    location,
    history: { state: null, replaceState() {} },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout,
    clearTimeout,
    setInterval(callback) { intervalCallbacks.push(callback); return intervalCallbacks.length; },
    addEventListener() {},
    dispatchEvent() {},
    confirm: () => confirmResult,
    setConfirmResult(value) { confirmResult = value; },
  };
  const fetch = async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/release-version.json')) {
      return { ok: true, json: async () => ({ version: 'release-next-456' }) };
    }
    if (url.pathname.endsWith('/staff-release.json')) {
      return {
        ok: true,
        json: async () => ({
          version: '1.0.2',
          installerUrl,
        }),
      };
    }
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(0) };
  };
  const context = vm.createContext({
    AbortController,
    Date,
    Event,
    URL,
    console,
    document,
    fetch,
    navigator: {},
    setTimeout,
    clearTimeout,
    window,
  });
  vm.runInContext(bootstrapSource, context, { filename: 'app_bootstrap.js' });
  return { body, downloaded, intervalCallbacks, location, window };
}

const waitForBootstrap = () => new Promise((resolve) => setTimeout(resolve, 20));
const findByText = (root, text) => {
  const visit = (element) => {
    if (element.textContent === text) return element;
    for (const child of element.children) {
      const match = visit(child);
      if (match) return match;
    }
    return null;
  };
  return visit(root);
};

test('site release waits for staff and requires confirmation before reload', async () => {
  const page = createPage({ desktop: true, installedVersion: '1.0.2' });
  await waitForBootstrap();

  assert.match(page.body.textContentDeep, /Доступна новая версия Bulka/);
  assert.equal(page.location.replaced, null);

  findByText(page.body, 'Позже').click();
  for (const check of page.intervalCallbacks) check();
  await waitForBootstrap();
  assert.doesNotMatch(page.body.textContentDeep, /Доступна новая версия Bulka/);
  assert.equal(page.location.replaced, null);

  const confirmationPage = createPage({ desktop: true, installedVersion: '1.0.2' });
  await waitForBootstrap();
  confirmationPage.window.setConfirmResult(false);
  findByText(confirmationPage.body, 'Обновить страницу').click();
  await waitForBootstrap();
  assert.equal(confirmationPage.location.replaced, null);

  confirmationPage.window.setConfirmResult(true);
  findByText(confirmationPage.body, 'Обновить страницу').click();
  await waitForBootstrap();
  const updateUrl = new URL(confirmationPage.location.replaced);
  assert.equal(updateUrl.searchParams.get('desktop'), '1');
  assert.equal(updateUrl.searchParams.get('__bulka_release'), 'release-next-456');
});

test('legacy desktop installer exposes only a same-origin Bulka installer download', async () => {
  const page = createPage({ desktop: true, installedVersion: '1.0.1' });
  await waitForBootstrap();

  assert.match(page.body.textContentDeep, /Доступно обновление кассового приложения/);
  findByText(page.body, 'Скачать установщик').click();
  assert.deepEqual(page.downloaded, [
    'https://bulka.test/downloads/Bulka-Staff-Setup-1.0.2-Universal.exe',
  ]);
});

test('current desktop installer does not show an upgrade prompt', async () => {
  const page = createPage({ desktop: true, installedVersion: '1.0.2' });
  await waitForBootstrap();

  assert.doesNotMatch(page.body.textContentDeep, /Доступно обновление кассового приложения/);
});

test('desktop installer update rejects URLs outside the Bulka download path', async () => {
  const page = createPage({
    desktop: true,
    installedVersion: '1.0.1',
    installerUrl: 'https://download-attacker.test/Bulka-Staff-Setup.exe',
  });
  await waitForBootstrap();

  assert.doesNotMatch(page.body.textContentDeep, /Доступно обновление кассового приложения/);
  assert.deepEqual(page.downloaded, []);
});

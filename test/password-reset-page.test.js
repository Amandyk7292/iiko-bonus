const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const test = require('node:test');
const vm = require('node:vm');
const express = require('express');
const {
  contentSecurityPolicyMiddleware,
} = require('../src/middlewares/content-security-policy.middleware');

const source = fs.readFileSync('public/reset-password/app.js', 'utf8');
const fixtureToken = 'a'.repeat(64);
const settle = () => new Promise((resolve) => setImmediate(resolve));

function browserHarness(fragment, send = async () => ({ success: true })) {
  const elements = new Map();
  const posts = [];
  let scrubbed = '';
  const element = (id) => {
    if (!elements.has(id)) {
      elements.set(id, {
        hidden: true,
        value: '',
        type: 'password',
        listeners: {},
        attributes: {},
        addEventListener(event, listener) {
          this.listeners[event] = listener;
        },
        removeAttribute(name) {
          delete this.attributes[name];
        },
        setAttribute(name, value) {
          this.attributes[name] = value;
        },
        focus() {},
        reset() {
          element('password').value = '';
          element('confirmation').value = '';
        },
      });
    }
    return elements.get(id);
  };
  const context = vm.createContext({
    AbortController,
    TextEncoder,
    window: {
      location: { hash: fragment, pathname: '/reset-password' },
      history: {
        replaceState(_state, _title, path) {
          scrubbed = path;
        },
      },
      setTimeout,
      clearTimeout,
    },
    document: { getElementById: element, querySelectorAll: () => [] },
    fetch: async (url, options) => {
      const call = { url, ...options, body: JSON.parse(options.body) };
      posts.push(call);
      const data = await send(call);
      return { ok: data.success === true, json: async () => data };
    },
  });
  vm.runInContext(source, context);
  return {
    element,
    posts,
    scrubbed: () => scrubbed,
    submit: () => element('reset-form').listeners.submit({ preventDefault() {} }),
  };
}

test('reset page removes the fragment before any request and never accepts malformed credentials', async () => {
  for (const fragment of [
    '',
    '#reset=x',
    `#reset=${fixtureToken}&other=1`,
    `#reset=${fixtureToken.toUpperCase()}`,
  ]) {
    const harness = browserHarness(fragment);
    await settle();
    assert.equal(harness.scrubbed(), '/reset-password');
    assert.equal(harness.posts.length, 0);
    assert.equal(harness.element('retry').hidden, false);
    assert.equal(harness.element('reset-form').hidden, true);
  }
});

test('opening a valid reset link validates using a private POST without consuming it', async () => {
  const harness = browserHarness(`#reset=${fixtureToken}`);
  await settle();
  assert.equal(harness.scrubbed(), '/reset-password');
  assert.equal(harness.posts.length, 1);
  const request = harness.posts[0];
  assert.equal(request.url, '/api/auth/password-reset/validate-link');
  assert.deepEqual(request.body, { resetToken: fixtureToken });
  assert.equal(request.method, 'POST');
  assert.equal(request.credentials, 'omit');
  assert.equal(request.referrerPolicy, 'no-referrer');
  assert.equal(request.cache, 'no-store');
  assert.equal(harness.element('reset-form').hidden, false);
});

test('invalid password bytes and mismatched confirmation cannot submit a reset', async () => {
  const harness = browserHarness(`#reset=${fixtureToken}`);
  await settle();
  for (const [password, confirmation] of [
    ['short1', 'short1'],
    ['а'.repeat(36) + '1', 'а'.repeat(36) + '1'],
    ['Password123', 'Different123'],
    ['abcdefgh', 'abcdefgh'],
  ]) {
    harness.element('password').value = password;
    harness.element('confirmation').value = confirmation;
    await harness.submit();
    assert.equal(harness.element('error').hidden, false);
    assert.equal(harness.posts.length, 1);
  }
});

test('reset completion prevents duplicate submissions and clears passwords without authenticating', async () => {
  let resolveCompletion;
  const harness = browserHarness(`#reset=${fixtureToken}`, async (call) => {
    if (call.url.endsWith('validate-link')) return { success: true };
    return new Promise((resolve) => {
      resolveCompletion = resolve;
    });
  });
  await settle();
  harness.element('password').value = harness.element('confirmation').value = 'Password123';
  const first = harness.submit();
  assert.equal(harness.element('password').disabled, true);
  assert.equal(harness.element('confirmation').disabled, true);
  await harness.submit();
  assert.equal(harness.posts.length, 2);
  assert.deepEqual(harness.posts[1].body, { resetToken: fixtureToken, password: 'Password123' });
  resolveCompletion({ success: true });
  await first;
  assert.equal(harness.element('password').disabled, false);
  assert.equal(harness.element('confirmation').disabled, false);
  assert.equal(harness.element('password').value, '');
  assert.equal(harness.element('confirmation').value, '');
  assert.equal(harness.element('login').hidden, false);
  assert.equal(harness.element('reset-form').hidden, true);
});

test('expired or consumed reset links hide password entry', async () => {
  const harness = browserHarness(`#reset=${fixtureToken}`, async () => ({
    success: false,
    code: 'PASSWORD_RESET_LINK_INVALID',
  }));
  await settle();
  assert.equal(harness.element('reset-form').hidden, true);
  assert.equal(harness.element('retry').hidden, false);
});

test('reset document and assets are isolated, uncached and excluded from referrers', async (t) => {
  const app = express();
  app.use(contentSecurityPolicyMiddleware);
  app.use(require('../src/routes/password-reset-page.routes'));
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const route of [
    '/reset-password',
    '/reset-password/',
    '/reset-password/index.html',
    '/reset-password/app.js',
    '/reset-password/style.css',
  ]) {
    const response = await fetch(`${origin}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(response.headers.get('cache-control'), /no-store/, route);
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer', route);
    assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow', route);
    if (!route.endsWith('.js') && !route.endsWith('.css')) {
      const csp = response.headers.get('content-security-policy');
      assert.match(csp, /frame-ancestors 'none'/);
      assert.match(csp, /script-src 'self'/);
      assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval|https:/);
    }
  }
});

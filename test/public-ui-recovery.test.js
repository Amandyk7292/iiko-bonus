const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const priceSource = fs.readFileSync('public/pricegenerator/app.js', 'utf8');
const courierSource = fs.readFileSync('public/courier.html', 'utf8');
const extract = (source, start, end) => source.slice(source.indexOf(start), source.indexOf(end));

test('default manufacturing date follows the Asia/Oral calendar across midnight', () => {
  const context = vm.createContext({ Date, Intl });
  vm.runInContext(
    extract(priceSource, '  function localCalendarDate(', '  function formatDate('),
    context,
  );
  for (const [instant, expected] of [
    ['2026-10-03T18:59:59Z', '2026-10-03'],
    ['2026-10-03T19:00:00Z', '2026-10-04'],
    ['2026-10-03T20:30:00Z', '2026-10-04'],
    ['2026-10-04T19:00:00Z', '2026-10-05'],
  ])
    assert.equal(context.localCalendarDate(new Date(instant)), expected);
});

function printHarness(copies, products = [{ name: 'Fixture', archived: false }], ready = true) {
  let created = 0;
  let message = '';
  const elements = {
    copies: { value: copies, setAttribute() {}, focus() {} },
    'copies-error': { hidden: true },
  };
  const context = vm.createContext({
    state: { products, selectedProduct: 0, productsReady: ready },
    printRoot: { replaceChildren() {} },
    $: (id) => elements[id],
    notice: (value) => {
      message = value;
    },
    syncSettings() {},
    product: () => products[0],
    document: {
      createElement() {
        created += 1;
        throw new Error('Unexpected print-page allocation');
      },
    },
  });
  vm.runInContext(
    extract(priceSource, '  async function preparePrint(', '  async function loadDefaults('),
    context,
  );
  return { context, elements, created: () => created, message: () => message };
}

test('ordinary label printing rejects unavailable or archived products before allocating pages', async () => {
  for (const [products, ready] of [
    [[], false],
    [[{ archived: true }], true],
  ]) {
    const harness = printHarness('1', products, ready);
    await harness.context.preparePrint('roll');
    assert.match(harness.message(), /Сначала загрузите/);
    assert.equal(harness.created(), 0);
  }
});

test('copy and total-print limits reject invalid input before allocating any print pages', async () => {
  for (const copies of ['', '0', '-1', '1.5', '1000', '1000000']) {
    const harness = printHarness(copies);
    await harness.context.preparePrint('roll');
    assert.equal(harness.elements['copies-error'].hidden, false);
    assert.match(harness.elements['copies-error'].textContent, /от 1 до 999/);
    assert.equal(harness.created(), 0);
  }
  const harness = printHarness('500', [{ archived: false }, { archived: false }]);
  await harness.context.preparePrint('sheet');
  assert.match(harness.message(), /Общий тираж/);
  assert.equal(harness.created(), 0);
});

function courierHarness(fetch) {
  let deadline;
  let cleared = false;
  const context = vm.createContext({
    AbortController,
    FormData,
    TypeError,
    SyntaxError,
    fetch,
    setTimeout(callback, ms) {
      assert.equal(ms, 20000);
      deadline = callback;
      return 1;
    },
    clearTimeout(id) {
      assert.equal(id, 1);
      cleared = true;
    },
  });
  vm.runInContext(
    extract(courierSource, '        async function request(path,', '        function showLogin('),
    context,
  );
  return { request: context.request, expire: () => deadline(), cleared: () => cleared };
}

test('courier requests translate network errors and clear their deadline', async () => {
  const harness = courierHarness(async () => {
    throw new TypeError('Failed to fetch');
  });
  await assert.rejects(harness.request('/fixture'), /Нет связи\. Проверьте интернет и повторите\./);
  assert.equal(harness.cleared(), true);
});

test('courier deadline aborts an unanswered request and clears its timer', async () => {
  let signal;
  const harness = courierHarness(
    (_path, options) =>
      new Promise((_resolve, reject) => {
        signal = options.signal;
        signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      }),
  );
  const pending = harness.request('/fixture');
  harness.expire();
  await assert.rejects(pending, /Нет связи/);
  assert.equal(signal.aborted, true);
  assert.equal(harness.cleared(), true);
});

test('courier HTTP errors retain status and code, including non-JSON expired sessions', async () => {
  for (const json of [
    async () => ({ error: 'Сессия завершена', code: 'EXPIRED' }),
    async () => {
      throw new SyntaxError('not json');
    },
  ]) {
    const harness = courierHarness(async () => ({ ok: false, status: 401, json }));
    await assert.rejects(harness.request('/fixture'), (error) => error.status === 401);
    assert.equal(harness.cleared(), true);
  }
});

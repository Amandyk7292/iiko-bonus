const test = require('node:test');
const assert = require('node:assert/strict');
const { createTelegramApi } = require('../src/services/branch-photo-telegram-api.service');
const token = ['synthetic', 'token'].join('-');
const response = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});

test('photo Telegram transport uses POST plain text and never reuses the loyalty token', async () => {
  let request;
  const api = createTelegramApi({
    token,
    fetchImpl: async (url, options) => {
      request = { url, options, payload: JSON.parse(options.body) };
      return response(200, { ok: true, result: { message_id: 91 } });
    },
  });
  assert.deepEqual(await api.sendMessage('101', '<Зал> & _пекарь_'), {
    status: 'sent',
    messageId: 91,
  });
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.redirect, 'error');
  assert.equal(request.payload.chat_id, '101');
  assert.equal(request.payload.text, '<Зал> & _пекарь_');
  assert.equal('parse_mode' in request.payload, false);
  assert.equal(request.url, `https://api.telegram.org/bot${token}/sendMessage`);
});

test('photo Telegram polling preserves the queue and applies durable nonnegative offset', async () => {
  const calls = [];
  const api = createTelegramApi({
    token,
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return response(200, { ok: true, result: calls.length === 1 ? true : [{ update_id: 27 }] });
    },
  });
  assert.deepEqual(await api.deleteWebhook(), { status: 'ok' });
  assert.equal(calls[0].drop_pending_updates, false);
  assert.deepEqual(await api.getUpdates({ offset: 27, timeoutSeconds: 25 }), {
    status: 'ok',
    updates: [{ update_id: 27 }],
  });
  assert.deepEqual(calls[1], { offset: 27, timeout: 25, limit: 100, allowed_updates: ['message'] });
  assert.deepEqual(await api.getUpdates({ offset: -1 }), { status: 'failed' });
  assert.equal(calls.length, 2);
});

test('photo Telegram reports rate limits without retaining provider descriptions', async () => {
  const api = createTelegramApi({
    token,
    fetchImpl: async () =>
      response(429, {
        ok: false,
        error_code: 429,
        description: `sensitive https://api.telegram.org/bot${token}`,
        parameters: { retry_after: 43 },
      }),
  });
  assert.deepEqual(await api.sendMessage('101', 'Отчёт'), {
    status: 'retryable',
    retryAfterSeconds: 43,
  });
});

test('photo Telegram classifies forbidden, auth and provider failures safely', async () => {
  for (const [code, expected] of [
    [403, { status: 'forbidden' }],
    [401, { status: 'failed', errorCode: 401 }],
    [400, { status: 'failed', errorCode: 400 }],
  ]) {
    const api = createTelegramApi({
      token,
      fetchImpl: async () => response(code, { ok: false, error_code: code, description: token }),
    });
    assert.deepEqual(await api.sendMessage('101', 'Отчёт'), expected);
  }
  const api = createTelegramApi({
    token,
    fetchImpl: async () => response(503, { ok: false, error_code: 503 }),
  });
  assert.deepEqual(await api.sendMessage('101', 'Отчёт'), { status: 'uncertain' });
  assert.deepEqual(await api.getUpdates(), { status: 'retryable', retryAfterSeconds: 5 });
});

test('photo Telegram never exposes or logs a token-bearing network exception', async (t) => {
  const log = t.mock.method(console, 'error');
  const warn = t.mock.method(console, 'warn');
  const api = createTelegramApi({
    token,
    fetchImpl: async (url) => {
      throw new Error(`failed at ${url}`);
    },
  });
  const result = await api.sendMessage('101', 'Отчёт');
  assert.deepEqual(result, { status: 'uncertain' });
  assert.equal(JSON.stringify(result).includes(token), false);
  assert.equal(log.mock.callCount(), 0);
  assert.equal(warn.mock.callCount(), 0);
});

test('photo Telegram deadlines and caller cancellation terminate an in-flight request', async () => {
  const fetchImpl = (_url, options) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new Error(`private ${token}`)), {
        once: true,
      });
    });
  const timeout = createTelegramApi({ token, fetchImpl, timeoutMs: 5 });
  assert.deepEqual(await timeout.sendMessage('101', 'Отчёт'), { status: 'uncertain' });
  const controller = new AbortController();
  const api = createTelegramApi({ token, fetchImpl });
  const pending = api.sendMessage('101', 'Отчёт', { signal: controller.signal });
  controller.abort();
  assert.deepEqual(await pending, { status: 'cancelled' });
});

test('photo Telegram bounds plain text and avoids sending to groups or invalid chat IDs', async () => {
  let calls = 0;
  const api = createTelegramApi({
    token,
    fetchImpl: async () => {
      calls++;
      return response(200, { ok: true, result: { message_id: 1 } });
    },
  });
  for (const [chatId, text] of [
    ['-500', 'x'],
    ['101', ''],
    ['101', 'x'.repeat(4097)],
  ])
    assert.deepEqual(await api.sendMessage(chatId, text), { status: 'failed' });
  assert.equal(calls, 0);
  assert.equal((await api.sendMessage('101', 'x'.repeat(4096))).status, 'sent');
});

test('photo Telegram treats malformed provider successes as uncertain rather than delivered', async () => {
  const api = createTelegramApi({
    token,
    fetchImpl: async () => response(200, { ok: true, result: {} }),
  });
  assert.deepEqual(await api.sendMessage('101', 'Отчёт'), { status: 'uncertain' });
  assert.deepEqual(await api.getUpdates(), { status: 'uncertain' });
  assert.deepEqual(await api.deleteWebhook(), { status: 'failed' });
  const invalidJson = createTelegramApi({
    token,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error(token);
      },
    }),
  });
  assert.deepEqual(await invalidJson.sendMessage('101', 'Отчёт'), { status: 'uncertain' });
});

test('photo Telegram does not call a provider when dedicated configuration is absent or malformed', async () => {
  let calls = 0;
  for (const value of ['', '../secret', 'secret\n']) {
    const api = createTelegramApi({
      token: value,
      fetchImpl: async () => {
        calls++;
      },
    });
    assert.equal(api.configured, false);
    assert.deepEqual(await api.sendMessage('101', 'Отчёт'), { status: 'failed' });
  }
  assert.equal(calls, 0);
});

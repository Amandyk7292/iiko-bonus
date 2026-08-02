import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'bulka-kaspi-webhook-'));
const retryFile = path.join(temporaryDirectory, 'webhook-retries.json');
const trackedFile = path.join(temporaryDirectory, 'tracked-payments.json');
process.env.KASPI_WEBHOOK_RETRIES_FILE = retryFile;
process.env.KASPI_TRACKED_PAYMENTS_FILE = trackedFile;
process.env.TOKEN_SECRET_KEY = process.env.TOKEN_SECRET_KEY || 'kaspi-webhook-test-encryption-key-2026';

const { __test: polling } = await import('../src/polling.js');

const configureHook = (hook) => {
  polling.setWebhookResolver(() => [hook]);
};

const terminalEntry = (paymentId, hook, payload) => ({
  paymentId,
  type: 'invoice',
  status: 'Processed',
  meta: {},
  createdAt: Date.now(),
  retryCount: 0,
  terminalEvent: payload.event,
  terminalPayload: payload,
  terminalWebhookUrls: [hook.url],
  deliveredWebhookUrls: [],
});

test.after(() => {
  fs.rmSync(temporaryDirectory, { recursive: true, force: true });
});

test('webhook delivery persists HTTP 500/429 across restart and removes it only after 200', async () => {
  polling.reset();
  let status = 500;
  const server = http.createServer((_request, response) => {
    response.statusCode = status;
    if (status === 429) response.setHeader('Retry-After', '1');
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  test.after(() => server.close());
  const address = server.address();
  const hook = {
    url: `http://127.0.0.1:${address.port}/webhook`,
    secret: 'test-webhook-secret',
  };
  const payload = {
    event: 'payment.success',
    paymentId: 'payment-1',
  };
  configureHook(hook);

  assert.equal(await polling.sendWebhook(hook, payload), false);
  assert.equal(polling.pendingRetries().length, 1);
  assert.equal(JSON.parse(fs.readFileSync(retryFile, 'utf8')).length, 1);
  assert.equal(fs.readFileSync(retryFile, 'utf8').includes(hook.secret), false);
  if (process.platform !== 'win32') {
    assert.equal(fs.statSync(retryFile).mode & 0o777, 0o600);
  }

  // Simulate a process restart: memory is empty and the durable queue is read.
  polling.reset();
  configureHook(hook);
  polling.loadRetries();
  assert.equal(polling.pendingRetries().length, 1);

  status = 429;
  const retry429 = polling.pendingRetries()[0];
  retry429.executeAfter = 0;
  fs.writeFileSync(retryFile, JSON.stringify([retry429]));
  polling.reset();
  configureHook(hook);
  polling.loadRetries();
  await polling.processRetries();
  assert.equal(polling.pendingRetries().length, 1);

  status = 200;
  const retry200 = polling.pendingRetries()[0];
  retry200.executeAfter = 0;
  fs.writeFileSync(retryFile, JSON.stringify([retry200]));
  polling.reset();
  configureHook(hook);
  polling.loadRetries();
  await polling.processRetries();
  assert.equal(polling.pendingRetries().length, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(retryFile, 'utf8')), []);
  assert.equal(polling.safeWebhookLabel({ url: `${hook.url}?token=must-not-be-logged` }), hook.url);
});

test('a corrupt retry file is rebuilt from the tracked terminal payment', async () => {
  polling.reset();
  let deliveries = 0;
  const server = http.createServer((_request, response) => {
    deliveries += 1;
    response.statusCode = 200;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  test.after(() => server.close());
  const address = server.address();
  const hook = {
    url: `http://127.0.0.1:${address.port}/webhook`,
    secret: 'test-webhook-secret-recovery',
  };
  const payload = { event: 'payment.success', paymentId: 'payment-recovery' };
  fs.writeFileSync(
    trackedFile,
    JSON.stringify({ [payload.paymentId]: terminalEntry(payload.paymentId, hook, payload) }),
  );
  fs.writeFileSync(retryFile, '{corrupt retry file');

  configureHook(hook);
  polling.loadTracked();
  polling.loadRetries();
  assert.equal(polling.rebuildTerminalRetries(), true);
  assert.equal(polling.pendingRetries().length, 1);
  await polling.processRetries();

  assert.equal(deliveries, 1);
  assert.equal(polling.pendingRetries().length, 0);
});

test('a retry write failure remains recoverable from tracked terminal state', async () => {
  polling.reset();
  let status = 500;
  const server = http.createServer((_request, response) => {
    response.statusCode = status;
    response.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  test.after(() => server.close());
  const address = server.address();
  const hook = {
    url: `http://127.0.0.1:${address.port}/webhook`,
    secret: 'test-webhook-secret-write-failure',
  };
  const payload = { event: 'payment.success', paymentId: 'payment-write-failure' };
  fs.writeFileSync(
    trackedFile,
    JSON.stringify({ [payload.paymentId]: terminalEntry(payload.paymentId, hook, payload) }),
  );
  fs.writeFileSync(retryFile, '[]');

  configureHook(hook);
  const originalWriteFileSync = fs.writeFileSync;
  fs.writeFileSync = (file, ...args) => {
    if (String(file).startsWith(retryFile)) throw new Error('simulated retry disk failure');
    return originalWriteFileSync(file, ...args);
  };
  try {
    assert.equal(await polling.sendWebhook(hook, payload), false);
    assert.equal(polling.pendingRetries().length, 1);
  } finally {
    fs.writeFileSync = originalWriteFileSync;
  }

  // Restart from the independently persisted terminal state, not the failed
  // retry queue write.
  polling.reset();
  configureHook(hook);
  polling.loadTracked();
  polling.loadRetries();
  polling.rebuildTerminalRetries();
  assert.equal(polling.pendingRetries().length, 1);
  status = 200;
  await polling.processRetries();
  assert.equal(polling.pendingRetries().length, 0);
});

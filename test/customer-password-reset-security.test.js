const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const { requestLoggingMiddleware } = require('../src/middlewares/observability.middleware');

test('production logging redacts reset secrets in nested bodies, arrays, errors, child bindings and console', () => {
  const result = spawnSync(
    process.execPath,
    [
      '-e',
      `
    const { logger, installConsoleBridge } = require('./src/config/logger');
    const token = 'b'.repeat(64);
    const url = 'https://bulka.com.kz/reset-password#reset=' + token;
    const data = { req: { body: { resetToken: token } }, nested: { deeper: [{ resetToken: token, reset_url: url }] }, sentinel: 'visible' };
    logger.info(data, 'Recovery request');
    if (data.req.body.resetToken !== token) throw new Error('Logger mutated the input');
    logger.child({ context: { details: { resetToken: token } } }).info({ okay: true }, 'Child log');
    const err = new Error('Delivery failed for ' + url);
    err.context = { body: { reset_token: token } };
    logger.error({ err }, 'Recovery failed');
    installConsoleBridge();
    console.warn({ deeply: [{ resetToken: token, url }] });
  `,
    ],
    {
      cwd: process.cwd(),
      env: { ...process.env, NODE_ENV: 'production', LOG_LEVEL: 'info' },
      encoding: 'utf8',
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.includes('b'.repeat(64)), false);
  const logs = result.stdout
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(logs.length, 4);
  assert.equal(logs[0].req.body.resetToken, '[REDACTED]');
  assert.equal(logs[0].nested.deeper[0].reset_url, '[REDACTED]');
  assert.equal(logs[0].sentinel, 'visible');
  assert.equal(logs[1].context.details.resetToken, '[REDACTED]');
  assert.equal(logs[2].err.context.body.reset_token, '[REDACTED]');
  assert.match(logs[2].err.message, /\[REDACTED\]/);
  assert.equal(logs[3].arguments[0].deeply[0].resetToken, '[REDACTED]');
});

test('request observability records only bounded metadata and never body, query or full URL', () => {
  const records = [];
  const secret = 'c'.repeat(64);
  const req = {
    method: 'POST',
    path: '/api/auth/password-reset/complete-link',
    ip: '127.0.0.1',
    body: { resetToken: secret, password: 'SecretPassword123' },
    query: { resetToken: secret },
    originalUrl: '/complete-link?resetToken=' + secret,
    log: { info: (data) => records.push(data) },
  };
  const res = Object.assign(new EventEmitter(), { statusCode: 200 });
  let continued = false;
  requestLoggingMiddleware(req, res, () => {
    continued = true;
  });
  res.emit('finish');
  res.emit('close');
  assert.equal(continued, true);
  assert.equal(records.length, 1);
  assert.equal(JSON.stringify(records).includes(secret), false);
  assert.equal(JSON.stringify(records).includes('SecretPassword123'), false);
  assert.deepEqual(Object.keys(records[0]).sort(), [
    'durationMs',
    'event',
    'method',
    'path',
    'remoteAddress',
    'statusCode',
  ]);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { createAdminSessionRateLimit } = require('../src/middlewares/rate-limit.middleware');
test('read quota is isolated between authenticated sessions and from mutations', async () => {
  const app = express();
  app.use((req, res, next) => {
    req.admin = { jti: req.headers['test-session'] || 'one' };
    next();
  });
  app.use(createAdminSessionRateLimit({ max: 2 }));
  app.use(createAdminSessionRateLimit({ max: 2, mutations: true }));
  app.use((req, res) => res.sendStatus(204));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.on('listening', resolve));
  const url = `http://127.0.0.1:${server.address().port}/staff/catalog`;
  try {
    assert.equal((await fetch(url)).status, 204);
    assert.equal((await fetch(url)).status, 204);
    assert.equal((await fetch(url)).status, 429);
    assert.equal((await fetch(url, { headers: { 'test-session': 'two' } })).status, 204);
    assert.equal((await fetch(url, { method: 'PATCH' })).status, 204);
    assert.equal((await fetch(url, { method: 'PATCH' })).status, 204);
    assert.equal((await fetch(url, { method: 'PATCH' })).status, 429);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

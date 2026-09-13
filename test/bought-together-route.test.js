const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

test('public bought-together route validates product IDs and exposes only recommendations', async (t) => {
  const servicePath = require.resolve('../src/services/bought-together.service');
  const previous = require.cache[servicePath];
  const requested = [];
  require.cache[servicePath] = {
    id: servicePath,
    filename: servicePath,
    loaded: true,
    exports: {
      recommendations: async (id) => {
        requested.push(id);
        return { productIds: ['coffee'], days: 30, ready: true };
      },
    },
  };
  t.after(() => {
    if (previous) require.cache[servicePath] = previous;
    else delete require.cache[servicePath];
  });
  const app = express();
  require('../src/routes/public/bought-together.routes').registerBoughtTogetherRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port;
  const response = await fetch(base + '/api/public/products/bun/bought-together');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), {
    success: true,
    productIds: ['coffee'],
    days: 30,
    ready: true,
  });
  const invalid = await fetch(base + '/api/public/products/%20/bought-together');
  assert.equal(invalid.status, 400);
  assert.deepEqual(requested, ['bun']);
});

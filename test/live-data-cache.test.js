const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

test('live branch, contact and product-option responses cannot reuse a stale HTTP cache entry', async (t) => {
  let address = 'Old address';
  const locations = require('../src/services/location.service');
  const contacts = require('../src/services/contact-center.service');
  const options = require('../src/services/product-options.service');
  t.mock.method(locations, 'getBulkaLocations', async () => [{ id: 'one', address }]);
  t.mock.method(locations, 'getCitiesWithPoints', async () => []);
  t.mock.method(contacts, 'listPublicContactCards', async () => ({ cards: [] }));
  t.mock.method(options, 'getProductOptions', async () => new Map());
  t.mock.method(options, 'getProductOptionFlags', async () => new Map());
  const app = express();
  app.use(require('../src/routes/legacy.routes'));
  app.use(require('../src/routes/public.routes'));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => server.close());
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (const path of [
    '/api/guest/locations',
    '/api/public/contact-center',
    '/api/public/product-options?ids=one',
    '/api/public/product-options?ids=one&summary=1',
  ]) {
    const response = await fetch(origin + path);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get('cache-control'), 'no-store', path);
    await response.json();
  }
  const before = await fetch(`${origin}/api/guest/locations`);
  const etag = before.headers.get('etag');
  assert.equal((await before.json()).locations[0].address, 'Old address');
  address = 'New address';
  const after = await fetch(`${origin}/api/guest/locations`, {
    headers: { 'If-None-Match': etag },
  });
  assert.equal(after.status, 200);
  assert.equal((await after.json()).locations[0].address, 'New address');
});

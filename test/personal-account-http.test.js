const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { registerPersonalAccountRoutes } = require('../src/routes/personal-account.routes');
const topups = require('../src/services/personal-account-topup.service');
test('expired historical topups remain readable without decrypting an obsolete bank token', async (t) => {
  const id = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  t.mock.method(topups, 'find', async (found, owner) => {
    assert.equal(found, id);
    assert.equal(owner, 'customer');
    return {
      id,
      customer_id: owner,
      status: 'expired',
      amount_minor: 100000,
      token_ciphertext: 'obsolete',
      created_at: '2026-09-12T00:00:00Z',
    };
  });
  t.mock.method(topups, 'sync', async () => assert.fail('No bank lookup for a finalized GET'));
  const app = express();
  app.use((req, _res, next) => {
    req.customerAuth = { id: 'customer' };
    next();
  });
  registerPersonalAccountRoutes(app);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const response = await fetch(
    `http://127.0.0.1:${server.address().port}/api/customer/personal-account/topups/${id}?resume=1`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const body = await response.json();
  assert.equal(body.paymentStatus, 'expired');
  assert.equal(body.redirectUrl, undefined);
});

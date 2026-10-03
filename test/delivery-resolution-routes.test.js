const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const express = require('express');
const {
  registerDeliveryResolutionRoutes,
} = require('../src/routes/customer/delivery-resolution.routes');
const {
  registerDeliveryResolutionAdminRoutes,
} = require('../src/routes/admin/delivery-resolution.routes');
async function fixture(t) {
  const customer = randomUUID(),
    orderId = randomUUID(),
    resolutionId = randomUUID(),
    calls = [];
  const service = {
    getDeliveryResolution: async (...args) => {
      calls.push(['get', ...args]);
      return { order: { id: orderId }, options: { slots: [] } };
    },
    chooseDeliveryResolution: async (...args) => {
      calls.push(['choice', ...args]);
      return { id: orderId, deliveryResolution: { status: 'pickup_cancelling' } };
    },
    reviewDeliveryResolution: async (...args) => {
      calls.push(['review', ...args]);
      return { id: orderId };
    },
  };
  const app = express();
  app.use(express.json());
  app.use((req, res, next) => {
    req.customerAuth = { id: customer };
    req.admin = { role: req.get('x-role') || 'cashier', sub: 'cashier:test' };
    next();
  });
  registerDeliveryResolutionRoutes(app, service);
  registerDeliveryResolutionAdminRoutes(app, {
    resolution: service,
    assertOrderAccess: async (req, id) => {
      calls.push(['scope', id]);
      if (req.get('x-foreign')) throw Object.assign(Error('Заказ не найден'), { statusCode: 404 });
    },
  });
  app.use((error, req, res, _next) =>
    res.status(error.statusCode || 400).json({ success: false, error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (path, body, headers = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  };
  return {
    customer,
    orderId,
    resolutionId,
    calls,
    request,
    customerPath: `/api/customer/orders/${orderId}/delivery-resolution`,
    adminPath: `/admin/api/orders/${orderId}/delivery-resolution`,
  };
}
test('customer decisions use authenticated owner and strict action/time contract with private responses', async (t) => {
  const f = await fixture(t);
  const get = await f.request(f.customerPath);
  assert.equal(get.status, 200);
  assert.equal(get.cache, 'private, no-store');
  const choice = await f.request(f.customerPath, {
    action: 'pickup',
    pickupTime: '2026-10-03T15:00:00Z',
  });
  assert.equal(choice.status, 200);
  assert.equal(choice.body.order.deliveryResolution.status, 'pickup_cancelling');
  assert.equal(f.calls[1][1], f.customer);
  assert.equal(f.calls[1][2], f.orderId);
  for (const body of [
    { action: 'pickup' },
    { action: 'pickup', pickupTime: 'tomorrow' },
    { action: 'cancel', branchId: randomUUID() },
    { action: 'cancel', customerId: randomUUID() },
    { action: 'accept' },
  ])
    assert.equal((await f.request(f.customerPath, body)).status, 400);
  assert.equal(f.calls.length, 2);
});
test('staff review requires fresh UUID, permitted role and server branch access', async (t) => {
  const f = await fixture(t),
    body = { action: 'accept', resolutionId: f.resolutionId };
  for (const role of ['operator', 'courier', 'viewer', 'iiko_dashboard'])
    assert.equal((await f.request(f.adminPath, body, { 'x-role': role })).status, 403);
  assert.equal((await f.request(f.adminPath, body, { 'x-foreign': '1' })).status, 404);
  assert.equal(
    f.calls.some((c) => c[0] === 'review'),
    false,
  );
  assert.equal((await f.request(f.adminPath, { action: 'accept' })).status, 400);
  const result = await f.request(f.adminPath, body);
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.at(-1), [
    'review',
    f.orderId,
    'accept',
    { resolutionId: f.resolutionId, actor: 'cashier:test' },
  ]);
});

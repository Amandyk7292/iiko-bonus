const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

const id = '11111111-1111-4111-8111-111111111111';
const owner = '22222222-2222-4222-8222-222222222222';
const fixture = {
  id,
  customer_id: owner,
  status: 'paid',
  fulfillment_type: 'delivery',
  fulfillment_status: 'ready',
  delivery_status: 'assigned',
  order_number: 100075,
  cart_items: [],
  created_at: '2026-11-05T17:43:00Z',
  updated_at: '2026-11-05T17:43:00Z',
  delivery_jobs: [
    {
      id: 'job',
      provider: 'yandex',
      internal_status: 'assigned',
      provider_status: 'performer_found',
      courier_name: 'Курьер',
      courier_latitude: 43.6,
      courier_longitude: 51.1,
      tracking_url: 'https://dostavka.yandex.ru/route/live',
    },
  ],
};

function replace(t, modulePath, exports) {
  const path = require.resolve(modulePath),
    previous = require.cache[path];
  require.cache[path] = { id: path, filename: path, loaded: true, exports };
  t.after(() => {
    if (previous) require.cache[path] = previous;
    else delete require.cache[path];
  });
}

test('customer order detail route refreshes tracking and enforces owner, paid status and private caching', async (t) => {
  let row = structuredClone(fixture),
    databaseError = null;
  replace(t, '../src/config/supabase', {
    supabase: {
      from(table) {
        assert.equal(table, 'kaspi_orders');
        const filters = [];
        return {
          select() {
            return this;
          },
          eq(column, value) {
            filters.push((r) => r[column] === value);
            return this;
          },
          in(column, values) {
            filters.push((r) => values.includes(r[column]));
            return this;
          },
          async maybeSingle() {
            return {
              data: row && filters.every((f) => f(row)) ? structuredClone(row) : null,
              error: databaseError,
            };
          },
        };
      },
    },
  });
  replace(t, '../src/services/order-images.service', {
    attachOrderImages: async (orders) => orders,
  });
  const auth = require('../src/middlewares/customer-auth.middleware');
  replace(t, '../src/middlewares/customer-auth.middleware', {
    ...auth,
    customerAuthMiddleware(req, res, next) {
      if (!req.get('x-customer')) return res.status(401).json({ success: false });
      req.customerAuth = { id: req.get('x-customer') };
      next();
    },
  });
  const app = express();
  app.use(require('../src/routes/public.routes'));
  app.use((error, req, res, _next) => res.status(error.statusCode || 400).json({ success: false }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (orderId = id, customer = owner) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/customer/orders/${orderId}`,
      {
        headers: customer ? { 'x-customer': customer } : {},
      },
    );
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body: await response.json(),
    };
  };
  const first = await request();
  assert.equal(first.status, 200);
  assert.equal(first.cache, 'private, no-store');
  assert.equal(first.body.order.courier.latitude, 43.6);
  row.delivery_jobs[0].courier_latitude = 43.66;
  row.delivery_jobs[0].provider_status = 'pickuped';
  row.delivery_jobs[0].internal_status = 'picked_up';
  row.delivery_status = 'picked_up';
  const moved = await request();
  assert.equal(moved.body.order.courier.latitude, 43.66);
  assert.equal(moved.body.order.orderStatus, 'ready');
  assert.equal(moved.body.order.providerDeliveryStatus, 'pickuped');
  assert.equal(moved.body.order.trackingUrl, fixture.delivery_jobs[0].tracking_url);
  assert.equal((await request(id, null)).status, 401);
  assert.equal((await request(id, '33333333-3333-4333-8333-333333333333')).status, 404);
  assert.equal((await request('not-a-uuid')).status, 400);
  row.status = 'pending';
  assert.equal((await request()).status, 404);
  row.status = 'paid';
  row.fulfillment_status = 'completed';
  assert.equal((await request()).body.order.trackingUrl, null);
  row.fulfillment_status = 'cancelled';
  assert.equal((await request()).body.order.trackingUrl, null);
  databaseError = new Error('private database information');
  const failed = await request();
  assert.equal(failed.status, 500);
  assert.equal(JSON.stringify(failed.body).includes('private database information'), false);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  registerProductInventoryUnitRoutes,
} = require('../src/routes/admin/product-inventory-unit.routes');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const unitsService = require('../src/services/product-inventory-unit.service');
const { visibleCashierProducts } = require('../src/services/cashier-catalog.service');

async function fixture(t) {
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      return {
        data: {
          unit: name.startsWith('get_') ? null : args.p_unit,
          configured: !name.startsWith('get_'),
        },
      };
    },
  };
  const units = {
    getProductInventoryUnit: (admin, id) => unitsService.getProductInventoryUnit(admin, id, { db }),
    setProductInventoryUnit: (admin, id, unit) =>
      unitsService.setProductInventoryUnit(admin, id, unit, { db }),
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = {
      role: req.get('x-role') || 'owner',
      sub: 'actor',
      selectedBranchId: 'branch-a',
      branchIds: ['branch-a'],
    };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  registerProductInventoryUnitRoutes(app, { units });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: error.message, code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (method, body, role = 'owner', id = 'astana:product-1') => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/menu/inventory-units/${encodeURIComponent(id)}`,
      {
        method,
        headers: { 'content-type': 'application/json', 'x-role': role },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      },
    );
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  };
  return { request, calls, db };
}

test('global endpoint returns ambiguous null; owner/admin writes contain no branch scope', async (t) => {
  const f = await fixture(t);
  const read = await f.request('GET');
  assert.deepEqual(read.body, { success: true, unit: null, configured: false, canEdit: true });
  assert.equal(read.cache, 'no-store');
  for (const role of ['owner', 'admin']) {
    const saved = await f.request('PUT', { unit: 'кг' }, role);
    assert.deepEqual(saved.body, { success: true, unit: 'кг', configured: true, canEdit: true });
    assert.deepEqual(f.calls.at(-1), {
      name: 'set_product_inventory_unit',
      args: { p_product: 'astana:product-1', p_unit: 'кг', p_actor: 'actor' },
    });
  }
});

test('other menu roles see read-only units and cannot forge a global write; cashier has no menu access', async (t) => {
  const f = await fixture(t);
  for (const role of ['branch_manager', 'editor', 'viewer']) {
    const read = await f.request('GET', undefined, role);
    assert.equal(read.status, 200);
    assert.equal(read.body.canEdit, false);
    const count = f.calls.length;
    assert.equal((await f.request('PUT', { unit: 'кг' }, role)).status, 403);
    assert.equal(f.calls.length, count);
    await assert.rejects(
      () => unitsService.setProductInventoryUnit({ role }, 'product', 'кг', { db: f.db }),
      { statusCode: 403 },
    );
  }
  const count = f.calls.length;
  assert.equal((await f.request('PUT', { unit: 'кг' }, 'cashier')).status, 403);
  assert.equal((await f.request('GET', undefined, 'cashier')).status, 403);
  assert.equal(f.calls.length, count);
});

test('endpoint rejects unknown units, branch fields and unsafe product IDs before mutation', async (t) => {
  const f = await fixture(t);
  for (const payload of [
    { unit: 'litre' },
    { unit: 'шт', branchId: 'branch-b' },
    { unit: null },
    {},
  ])
    assert.equal((await f.request('PUT', payload)).status, 400);
  assert.equal((await f.request('PUT', { unit: 'шт' }, 'owner', 'bad/product')).status, 400);
  assert.equal(f.calls.length, 0);
});

test('a cashier branch without a stock row renders the global kg unit and step', () => {
  const products = visibleCashierProducts({
    rawMenu: { products: [{ id: 'kg-product', name: 'Товар', price: 100 }] },
    overrides: [],
    categories: [],
    custom: [],
    stopIds: new Set(),
    inventory: new Map(),
    inventoryUnits: new Map([['kg-product', 'кг']]),
  });
  assert.equal(products[0].unit, 'кг');
  assert.equal(products[0].quantityStep, 0.001);
  assert.equal(products[0].sourceQuantity, null);
});

test('locked stock setter returns a retryable conflict instead of a generic server error', async () => {
  await assert.rejects(
    () =>
      unitsService.setProductInventoryUnit({ role: 'owner' }, 'product', 'кг', {
        db: { rpc: async () => ({ error: { code: '55P03', message: 'could not obtain lock' } }) },
      }),
    {
      statusCode: 409,
      code: 'PRODUCT_INVENTORY_UNIT_CONFLICT',
      message: 'Остаток обновляется. Повторите сохранение.',
    },
  );
});

test('catalog unit lookup batches exact IDs so PostgREST row limits never lose later products', async () => {
  const ids = Array.from({ length: 1105 }, (_, index) => `product-${index}`),
    sizes = [];
  const result = await unitsService.listProductInventoryUnits({
    productIds: [...ids, ids[0]],
    db: {
      from: () => ({
        select: () => ({
          in: async (_field, batch) => {
            sizes.push(batch.length);
            return { data: batch.map((product_id) => ({ product_id, unit: 'кг' })) };
          },
        }),
      }),
    },
  });
  assert.equal(result.size, ids.length);
  assert.equal(result.get(ids.at(-1)), 'кг');
  assert.equal(sizes.length, 12);
  assert.equal(Math.max(...sizes), 100);
});

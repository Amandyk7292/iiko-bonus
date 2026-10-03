const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  registerProductionBindingRoutes,
} = require('../src/routes/admin/production-bindings.routes');
const branch = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const department = 'bc1334bf-2eb0-8b09-0167-6366b33b000d';
const input = {
  serverId: 'aktau-chain',
  departmentId: department,
  sourceStoreId: department,
  targetStoreId: department,
  enabled: true,
  postImmediately: false,
};

async function fixture(t) {
  const calls = [];
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = {
      role: req.get('x-role') || 'owner',
      sub: 'owner:test',
      branchIds: req.get('x-branches') ? [req.get('x-branches')] : [],
      selectedBranchId: req.get('x-branches') || null,
    };
    next();
  });
  registerProductionBindingRoutes(app, {
    acts: {
      listUnconfirmedProductionActs: async (id) => {
        calls.push(['acts', id]);
        return [];
      },
      resolveProductionAct: async (...args) => {
        calls.push(['resolve', ...args]);
        return { id: args[1], status: args[2].action === 'created' ? 'created' : 'failed' };
      },
    },
    service: {
      readProductionBinding: async (id) => {
        calls.push(['read', id]);
        return input;
      },
      loadProductionDirectory: async (server) => {
        calls.push(['directory', server]);
        return { departments: [], stores: [] };
      },
      saveProductionBinding: async (...args) => {
        calls.push(['save', ...args]);
        return args[1];
      },
    },
    client: {
      listServers: async () => [
        {
          id: 'aktau-chain',
          active: true,
          configured: true,
          city: 'aktau',
          host: 'safe.iiko.it',
          password: 'secret-test',
        },
        { id: 'offline', active: false, configured: true },
        { id: 'empty', active: true, configured: false },
      ],
    },
  });
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = async (body, headers = {}, query = '') => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/locations/${branch}/production-binding${query}`,
      {
        method: body ? 'PUT' : 'GET',
        headers: { 'content-type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body: await response.json(),
    };
  };
  const manual = async (body, headers = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/locations/${branch}/production-acts${body ? `/${other}/resolve` : ''}`,
      {
        method: body ? 'POST' : 'GET',
        headers: { 'content-type': 'application/json', ...headers },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return {
      status: response.status,
      cache: response.headers.get('cache-control'),
      body: await response.json(),
    };
  };
  return { request, calls, manual };
}
test('binding directory is owner-only, branch-scoped and omits secrets', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request(undefined, { 'x-role': 'cashier' })).status, 403);
  assert.equal((await f.request(undefined, { 'x-role': 'branch_manager' })).status, 403);
  assert.equal((await f.request(undefined, { 'x-branches': other })).status, 403);
  assert.equal(f.calls.length, 0);
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.equal(response.cache, 'private, no-store');
  assert.deepEqual(response.body.directory.servers, [
    { id: 'aktau-chain', name: 'safe.iiko.it', city: 'aktau' },
  ]);
  assert.ok(!JSON.stringify(response.body).includes('secret-test'));
});
test('manual result verification is owner-only, branch-scoped and auditable', async (t) => {
  const f = await fixture(t);
  const input = { action: 'created', confirmed: true, documentNumber: '  api-0002  ' };
  assert.equal((await f.manual(undefined, { 'x-role': 'cashier' })).status, 403);
  assert.equal((await f.manual(input, { 'x-role': 'cashier' })).status, 403);
  assert.equal((await f.manual(input, { 'x-role': 'admin', 'x-branches': other })).status, 403);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.manual()).cache, 'private, no-store');
  const response = await f.manual(input);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls.at(-1), [
    'resolve',
    branch,
    other,
    { ...input, documentNumber: 'api-0002' },
    { actor: 'owner:test' },
  ]);
});
test('manual verification rejects blind or conflicting input and does not accept arbitrary branch or quantity', async (t) => {
  const f = await fixture(t);
  for (const body of [
    { action: 'created', confirmed: false, documentNumber: 'api-0002' },
    { action: 'created', confirmed: true, documentNumber: '   ' },
    { action: 'created', confirmed: true, documentNumber: 'unsafe\nnumber' },
    { action: 'not_created', confirmed: true, documentNumber: 'api-0002' },
    { action: 'not_created', confirmed: true, branchId: other },
    { action: 'created', confirmed: true, documentNumber: 'api-0002', quantity: 100 },
  ])
    assert.equal((await f.manual(body)).status, 400);
  assert.equal(f.calls.length, 0);
  assert.equal((await f.manual({ action: 'not_created', confirmed: true })).status, 200);
});
test('unknown servers and arbitrary directory query parameters are rejected', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request(undefined, {}, '?serverId=offline')).status, 409);
  assert.equal((await f.request(undefined, {}, '?host=evil.example')).status, 400);
  assert.ok(!f.calls.some((call) => call[0] === 'directory'));
});
test('settings accept canonical non-RFC iiko GUIDs and use authenticated actor', async (t) => {
  const f = await fixture(t);
  const response = await f.request(input);
  assert.equal(response.status, 200);
  assert.deepEqual(f.calls[0], ['save', branch, input, { actor: 'owner:test' }]);
  assert.equal((await f.request({ ...input, branchId: other })).status, 400);
  assert.equal((await f.request({ ...input, sourceStoreId: 'not-guid' })).status, 400);
});
test('cashiers and a foreign scoped administrator cannot edit mappings', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.request(input, { 'x-role': 'cashier' })).status, 403);
  assert.equal((await f.request(input, { 'x-role': 'admin', 'x-branches': other })).status, 403);
  assert.equal(f.calls.length, 0);
});

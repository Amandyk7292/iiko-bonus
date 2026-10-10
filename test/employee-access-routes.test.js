const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const BRANCH = '20000000-0000-4000-8000-000000000001';
const OTHER = '20000000-0000-4000-8000-000000000002';

async function fixture(t) {
  const profiles = [
    {
      username: 'worker.one',
      display_name: 'Работник',
      role: 'employee',
      branch_ids: [BRANCH],
      active: true,
    },
  ];
  const credentialRows = [{ username: 'worker.one' }];
  const calls = [];
  const db = {
    from(table) {
      const query = {
        filters: [],
        one: false,
        select() {
          return this;
        },
        order() {
          return this;
        },
        eq(key, value) {
          this.filters.push((row) => row[key] === value);
          return this;
        },
        maybeSingle() {
          this.one = true;
          return this;
        },
        then(resolve) {
          const rows = (table === 'admin_user_profiles' ? profiles : credentialRows).filter((row) =>
            this.filters.every((filter) => filter(row)),
          );
          return Promise.resolve({ data: this.one ? rows[0] || null : rows, error: null }).then(
            resolve,
          );
        },
      };
      return query;
    },
  };
  const config = require('../src/config/supabase');
  const realDb = config.supabase;
  const credentials = require('../src/services/admin-credential-auth.service');
  const locations = require('../src/services/location.service');
  const realLocations = locations.getBulkaLocations;
  const originals = new Map();
  const changed = [
    'createEmployeeAccess',
    'updateEmployeeAccess',
    'resetEmployeePassword',
    'createCashierAccess',
    'resetCashierPassword',
  ];
  const routePath = require.resolve('../src/routes/admin/access.routes');
  const previousRoute = require.cache[routePath];
  for (const name of changed) {
    originals.set(name, credentials[name]);
    credentials[name] = async (input) => {
      calls.push({ name, input });
      if (name.startsWith('reset')) return true;
      return {
        username: input.username,
        display_name: input.displayName,
        role: name === 'createCashierAccess' ? 'cashier' : 'employee',
        branch_ids: input.branchIds || [input.branchId],
        active: input.active ?? true,
      };
    };
  }
  let register;
  try {
    config.supabase = db;
    locations.getBulkaLocations = async () => [{ id: BRANCH }, { id: OTHER }];
    delete require.cache[routePath];
    register = require('../src/routes/admin/access.routes').registerAccessAdminRoutes;
  } finally {
    config.supabase = realDb;
    locations.getBulkaLocations = realLocations;
    for (const [name, original] of originals) credentials[name] = original;
    delete require.cache[routePath];
    if (previousRoute) require.cache[routePath] = previousRoute;
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = { sub: 'owner', role: 'owner' };
    next();
  });
  const router = express.Router();
  register(router);
  app.use(router);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code, error: error.message }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const request = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json() };
  };
  return { profiles, credentialRows, calls, request };
}

test('owner access API creates password employee accounts with several branches and keeps cashier constraints', async (t) => {
  const f = await fixture(t);
  const body = {
    username: 'worker.two',
    password: 'SecureWorker2026',
    displayName: 'Работник',
    role: 'employee',
    branchIds: [BRANCH, OTHER],
  };
  const created = await f.request('POST', '/admin/api/access', body);
  assert.equal(created.status, 201);
  assert.equal(created.body.profile.role, 'employee');
  assert.equal(created.body.profile.authMethod, 'password');
  assert.equal(f.calls[0].name, 'createEmployeeAccess');
  assert.deepEqual(f.calls[0].input.branchIds, [BRANCH, OTHER]);
  const cashier = await f.request('POST', '/admin/api/access', { ...body, role: 'cashier' });
  assert.equal(cashier.status, 400);
  const mixed = await f.request('POST', '/admin/api/access', { ...body, phone: '+77001234567' });
  assert.equal(mixed.status, 400);
  const missingBranch = await f.request('POST', '/admin/api/access', {
    ...body,
    branchIds: ['30000000-0000-4000-8000-000000000003'],
  });
  assert.equal(missingBranch.status, 400);
  assert.equal(f.calls.length, 1);
});

test('password employee account type cannot be escalated and update/reset dispatch stays employee-only', async (t) => {
  const f = await fixture(t);
  const rejected = await f.request('PUT', '/admin/api/access/worker.one', {
    displayName: 'Работник',
    role: 'operator',
    branchIds: [BRANCH],
    active: true,
  });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.code, 'ACCESS_AUTH_METHOD_IMMUTABLE');
  assert.equal(f.calls.length, 0);
  const updated = await f.request('PUT', '/admin/api/access/worker.one', {
    role: 'employee',
    branchIds: [],
    active: false,
  });
  assert.equal(updated.status, 200);
  assert.equal(f.calls[0].name, 'updateEmployeeAccess');
  assert.equal(f.calls[0].input.displayName, null, 'RPC preserves prior name when omitted');
  assert.deepEqual(f.calls[0].input.branchIds, []);
  const reset = await f.request('PUT', '/admin/api/access/worker.one/password', {
    password: 'NewWorkerSecure2027',
  });
  assert.equal(reset.status, 200);
  assert.equal(f.calls[1].name, 'resetEmployeePassword');
  const listed = await f.request('GET', '/admin/api/access');
  assert.equal(listed.body.profiles[0].passwordConfigured, true);
  assert.equal(listed.body.profiles[0].authMethod, 'password');
});

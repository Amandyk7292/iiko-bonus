const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');
const { applyAdminBranchSelection } = require('../src/utils/admin-scope.util');
const {
  staffContext,
  nativeTerminal,
  createSale,
  getSale,
  catalog,
  configureTerminal,
} = require('../src/services/virtual-pos.service');
const {
  saleSchema,
  snapshotSchema,
  actionSchema,
} = require('../src/contracts/virtual-pos.contract');
const BRANCH = randomUUID(),
  OTHER = randomUUID(),
  TERMINAL = randomUUID(),
  SALE = randomUUID();
const input = () => ({
  requestId: SALE,
  terminalId: TERMINAL,
  snapshotRevision: 'fresh',
  cashShiftId: randomUUID(),
  paymentTypeId: randomUUID(),
  items: [{ productId: randomUUID(), quantity: 1 }],
  expectedTotal: 200,
});

function roleAllowed(role, method, path) {
  let allowed = false,
    status = 200;
  adminMutationRoleMiddleware(
    { admin: { role, branchIds: [BRANCH] }, method, path },
    {
      status(value) {
        status = value;
        return this;
      },
      json() {
        return this;
      },
    },
    () => {
      allowed = true;
    },
  );
  return { allowed, status };
}

test('retired web POS no longer grants staff permissions; learning and branch scope stay restricted', () => {
  for (const role of ['employee', 'cashier', 'branch_manager']) {
    assert.equal(roleAllowed(role, 'POST', '/staff/virtual-pos/sales').allowed, false);
  }
  for (const path of [
    '/staff/pos/devices',
    '/staff/pos/pairing-code',
    '/staff/virtual-pos/sales/all',
    '/staff/virtual-pos/arbitrary',
  ])
    assert.equal(
      roleAllowed('employee', path.endsWith('pairing-code') ? 'POST' : 'GET', path).allowed,
      false,
    );
  assert.equal(roleAllowed('employee', 'GET', '/scope').allowed, false);
  assert.equal(roleAllowed('employee', 'POST', '/scope').allowed, false);
  assert.equal(roleAllowed('employee', 'GET', '/learning/me').allowed, true);
  assert.equal(roleAllowed('employee', 'PUT', '/staff/virtual-pos/terminal').allowed, false);
  assert.equal(roleAllowed('owner', 'PUT', '/staff/virtual-pos/terminal').allowed, true);
  for (const role of ['viewer', 'operator', 'courier', 'editor', 'marketer'])
    assert.equal(roleAllowed(role, 'POST', '/staff/virtual-pos/sales').allowed, false);
  const employee = { username: 'worker', role: 'employee', branchIds: [BRANCH] };
  assert.throws(() => staffContext(employee, ''), { code: 'VIRTUAL_POS_BRANCH_REQUIRED' });
  assert.throws(() => staffContext(employee, OTHER), { code: 'VIRTUAL_POS_FORBIDDEN' });
  assert.throws(() => applyAdminBranchSelection(employee, OTHER), { statusCode: 403 });
});

test('contracts refuse arbitrary price, fractional quantities beyond precision and fiscalizer fields', () => {
  const body = input();
  assert.equal(saleSchema.safeParse(body).success, true);
  for (const invalid of [
    { ...body, price: 1 },
    { ...body, webkassa: true },
    { ...body, items: [{ ...body.items[0], price: 1 }] },
    { ...body, items: [{ ...body.items[0], quantity: 0.0001 }] },
    { ...body, items: [{ ...body.items[0], quantity: 10000 }] },
    { ...body, expectedTotal: 200.001 },
  ])
    assert.equal(saleSchema.safeParse(invalid).success, false);
  assert.equal(
    actionSchema.safeParse({
      terminalId: TERMINAL,
      saleId: SALE,
      leaseToken: randomUUID(),
      action: 'queued',
    }).success,
    false,
  );
  assert.equal(
    snapshotSchema.safeParse({
      terminalId: TERMINAL,
      revision: 'a',
      cashShift: { id: null, isOpen: false },
      products: [],
      paymentTypes: [],
      profile: { nonFiscalNoPaperVerified: false },
    }).success,
    true,
  );
});

test('catalog and configuration fail closed on unverified/fiscal/stale/unassigned terminals', async () => {
  const snapshot = {
    revision: 'fresh',
    terminalName: 'iiko',
    cashShift: { id: randomUUID(), isOpen: true },
    profile: { nonFiscalNoPaperVerified: true },
    products: [],
    paymentTypes: [{ id: randomUUID(), name: 'Internal', isFiscal: false, selectable: true }],
  };
  const rows = {
    bulka_locations: { id: BRANCH, active: true, name: 'Bulka', address: 'Address', city: 'Oral' },
    pos_devices: {
      terminal_id: TERMINAL,
      branch_id: BRANCH,
      active: true,
      device_role: 'register',
      name: 'iiko',
    },
    virtual_pos_terminals: { branch_id: BRANCH, terminal_id: TERMINAL, enabled: true },
    virtual_pos_snapshots: {
      branch_id: BRANCH,
      terminal_id: TERMINAL,
      snapshot,
      received_at: new Date().toISOString(),
    },
  };
  let writes = 0;
  const db = {
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        eq: (name, value) => {
          filters.push([name, value]);
          return q;
        },
        maybeSingle: async () => ({
          data:
            rows[table] && filters.every(([name, value]) => rows[table][name] === value)
              ? rows[table]
              : null,
        }),
        upsert: async () => {
          writes++;
          return {};
        },
      };
      return q;
    },
  };
  const employee = { username: 'worker', role: 'employee', branchIds: [BRANCH] };
  assert.equal((await catalog(employee, BRANCH, db)).canSell, true);
  snapshot.paymentTypes[0].isFiscal = true;
  const fiscal = await catalog(employee, BRANCH, db);
  assert.equal(fiscal.canSell, false);
  assert.equal(fiscal.paymentTypes[0].selectable, false);
  snapshot.paymentTypes[0].isFiscal = false;
  snapshot.profile.nonFiscalNoPaperVerified = false;
  assert.equal((await catalog(employee, BRANCH, db)).canSell, false);
  snapshot.profile.nonFiscalNoPaperVerified = true;
  rows.virtual_pos_snapshots.received_at = new Date(Date.now() - 46000).toISOString();
  assert.equal((await catalog(employee, BRANCH, db)).terminal.connected, false);
  rows.virtual_pos_snapshots.received_at = new Date().toISOString();
  rows.pos_devices.active = false;
  assert.equal((await catalog(employee, BRANCH, db)).canSell, false);
  await assert.rejects(
    configureTerminal(employee, BRANCH, { terminalId: TERMINAL, enabled: true }, db),
    { code: 'VIRTUAL_POS_FORBIDDEN' },
  );
  const owner = { username: 'owner', role: 'owner' };
  await assert.rejects(
    configureTerminal(owner, BRANCH, { terminalId: TERMINAL, enabled: true }, db),
    { code: 'VIRTUAL_POS_TERMINAL_FORBIDDEN' },
  );
  rows.pos_devices.active = true;
  rows.pos_devices.branch_id = OTHER;
  await assert.rejects(
    configureTerminal(owner, BRANCH, { terminalId: TERMINAL, enabled: true }, db),
    { code: 'VIRTUAL_POS_TERMINAL_FORBIDDEN' },
  );
  rows.pos_devices.branch_id = BRANCH;
  assert.equal(
    (await configureTerminal(owner, BRANCH, { terminalId: TERMINAL, enabled: true }, db)).enabled,
    true,
  );
  assert.equal(writes, 1);
});

test('service pins actor/branch and terminal headers; GET cannot expose another employee sale', async () => {
  const calls = [];
  const db = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return { data: { sale: { id: SALE, status: 'queued' } } };
    },
    from: () => {
      const filters = [];
      const q = {
        select: () => q,
        eq: (name, value) => {
          filters.push([name, value]);
          return q;
        },
        maybeSingle: async () => {
          calls.push({ filters });
          return { data: null };
        },
      };
      return q;
    },
  };
  const actor = { username: 'employee.one', role: 'employee', branchIds: [BRANCH] };
  await createSale(actor, BRANCH, input(), db);
  assert.equal(calls[0].payload.p_actor, 'employee.one');
  assert.equal(calls[0].payload.p_branch, BRANCH);
  await assert.rejects(getSale(actor, BRANCH, SALE, db), { code: 'VIRTUAL_POS_SALE_NOT_FOUND' });
  assert.deepEqual(calls[1].filters, [
    ['id', SALE],
    ['branch_id', BRANCH],
    ['actor_id', 'employee.one'],
  ]);
  assert.equal(
    nativeTerminal({
      body: { terminalId: TERMINAL },
      headers: { 'x-bulka-terminal-id': TERMINAL },
      pairedPos: { terminal_id: TERMINAL },
    }),
    TERMINAL,
  );
  assert.throws(
    () =>
      nativeTerminal({ body: { terminalId: TERMINAL }, headers: { 'x-bulka-terminal-id': OTHER } }),
    { code: 'VIRTUAL_POS_TERMINAL_FORBIDDEN' },
  );
  assert.throws(
    () =>
      nativeTerminal({
        body: { terminalId: TERMINAL },
        headers: { 'x-bulka-terminal-id': TERMINAL },
      }),
    { code: 'VIRTUAL_POS_TERMINAL_FORBIDDEN' },
  );
  assert.throws(
    () =>
      nativeTerminal({
        query: { terminalId: OTHER },
        headers: { 'x-bulka-terminal-id': OTHER },
        pairedPos: { terminal_id: TERMINAL },
      }),
    { code: 'VIRTUAL_POS_TERMINAL_FORBIDDEN' },
  );
});

test('lost definite rejection is recoverable by request ID only within actor and branch scope', async () => {
  const request = input();
  const rejected = {
    request_id: SALE,
    actor_id: 'worker',
    branch_id: BRANCH,
    request_payload: request,
    rejection: {
      error: 'VIRTUAL_POS_OFFLINE',
      message: 'Нет свежего каталога кассы',
      safelyRejected: true,
    },
  };
  const db = {
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        eq: (name, value) => {
          filters.push([name, value]);
          return q;
        },
        maybeSingle: async () => ({
          data:
            table === 'virtual_pos_rejected_requests' &&
            filters.every(([name, value]) => rejected[name] === value)
              ? rejected
              : null,
        }),
      };
      return q;
    },
  };
  const worker = { username: 'worker', role: 'employee', branchIds: [BRANCH] };
  const result = await getSale(worker, BRANCH, SALE, db);
  assert.equal(result.status, 'rejected');
  assert.equal(result.id, SALE);
  assert.equal(result.error, rejected.rejection.message);
  await assert.rejects(getSale({ ...worker, username: 'another-worker' }, BRANCH, SALE, db), {
    code: 'VIRTUAL_POS_SALE_NOT_FOUND',
  });
  await assert.rejects(getSale({ ...worker, branchIds: [OTHER] }, OTHER, SALE, db), {
    code: 'VIRTUAL_POS_SALE_NOT_FOUND',
  });
});

test('unmounted legacy staff router retains payload and sale-envelope validation for historical data', async (t) => {
  const config = require('../src/config/supabase');
  const originalDb = config.supabase;
  const servicePath = require.resolve('../src/services/virtual-pos.service');
  const routePath = require.resolve('../src/routes/admin/virtual-pos.routes');
  const originalService = require.cache[servicePath],
    originalRoute = require.cache[routePath];
  const calls = [];
  const db = {
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return {
        data:
          payload.p_request.expectedTotal === 201
            ? {
                error: 'VIRTUAL_POS_TOTAL_CHANGED',
                message: 'Сумма изменилась',
                safelyRejected: true,
              }
            : { sale: { id: SALE, status: 'queued', total: 200 } },
      };
    },
  };
  let register;
  try {
    config.supabase = db;
    delete require.cache[servicePath];
    delete require.cache[routePath];
    register = require('../src/routes/admin/virtual-pos.routes').registerVirtualPosAdminRoutes;
  } finally {
    config.supabase = originalDb;
    delete require.cache[servicePath];
    delete require.cache[routePath];
    require.cache[servicePath] = originalService;
    if (originalRoute) require.cache[routePath] = originalRoute;
  }
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    req.admin = {
      username: 'worker',
      role: req.headers['x-role'] || 'admin',
      branchIds: [BRANCH],
    };
    next();
  });
  app.use('/admin/api', adminMutationRoleMiddleware);
  register(app);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const send = async (body, branch = BRANCH, role = 'admin') => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/admin/api/staff/virtual-pos/sales`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-bulka-branch-id': branch,
          'x-role': role,
        },
        body: JSON.stringify(body),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  assert.equal((await send(input(), '')).status, 400);
  assert.equal((await send(input(), OTHER, 'employee')).status, 403);
  assert.equal((await send({ ...input(), discount: 5 })).status, 400);
  assert.equal((await send(input(), BRANCH, 'viewer')).status, 403);
  assert.equal(calls.length, 0);
  assert.deepEqual((await send(input())).body, {
    success: true,
    sale: { id: SALE, status: 'queued', total: 200 },
  });
  const rejected = await send({ ...input(), expectedTotal: 201 });
  assert.equal(rejected.status, 409);
  assert.equal(rejected.body.safelyRejected, true);
});

test('native HTTP routes require paired branch transport and matching terminal before snapshot/command access', async (t) => {
  const priorEncryptionKey = process.env.GIFT_CARD_ENCRYPTION_KEY;
  process.env.GIFT_CARD_ENCRYPTION_KEY = 'virtual-pos-test-encryption-key-32-characters';
  t.after(() => {
    if (priorEncryptionKey === undefined) delete process.env.GIFT_CARD_ENCRYPTION_KEY;
    else process.env.GIFT_CARD_ENCRYPTION_KEY = priorEncryptionKey;
  });
  const config = require('../src/config/supabase');
  const originalDb = config.supabase;
  const token = `pt1_${'a'.repeat(64)}`;
  const { posDeviceTokenHash } = require('../src/services/pos-pairing.service');
  const device = {
    terminal_id: TERMINAL,
    branch_id: BRANCH,
    terminal_group_id: randomUUID(),
    token_hash: posDeviceTokenHash(token),
    active: true,
    branch: { id: BRANCH, active: true },
  };
  const calls = [];
  const db = {
    from(table) {
      const filters = [];
      const q = {
        select: () => q,
        eq: (name, value) => {
          filters.push([name, value]);
          return q;
        },
        maybeSingle: async () => {
          const row =
            table === 'pos_devices'
              ? device
              : table === 'bulka_locations'
                ? { id: BRANCH, active: true }
                : null;
          return {
            data: row && filters.every(([name, value]) => row[name] === value) ? row : null,
          };
        },
      };
      return q;
    },
    rpc: async (name, payload) => {
      calls.push({ name, payload });
      return {
        data:
          name === 'claim_virtual_pos_sale'
            ? { command: null }
            : name === 'advance_virtual_pos_sale'
              ? { sale: { id: SALE, status: 'creating' }, guardAccepted: true }
              : { revision: payload.p_snapshot.revision },
      };
    },
  };
  const reload = [
    '../src/routes/virtual-pos.routes',
    '../src/services/virtual-pos.service',
    '../src/middlewares/pos-transport.middleware',
    '../src/middlewares/branch-pos-auth.middleware',
  ];
  const paths = reload.map(require.resolve),
    old = paths.map((path) => require.cache[path]);
  const priorSecret = process.env.API_SECRET;
  process.env.API_SECRET = 'virtual-pos-test-only-secret-32-characters';
  let router;
  try {
    config.supabase = db;
    paths.forEach((path) => {
      delete require.cache[path];
    });
    router = require('../src/routes/virtual-pos.routes');
  } finally {
    config.supabase = originalDb;
    paths.forEach((path, index) => {
      delete require.cache[path];
      if (old[index]) require.cache[path] = old[index];
    });
  }
  t.after(() => {
    if (priorSecret === undefined) delete process.env.API_SECRET;
    else process.env.API_SECRET = priorSecret;
  });
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use((error, _req, res, _next) =>
    res.status(error.statusCode || 500).json({ code: error.code }),
  );
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const send = async (method, path, body, headers = {}) => {
    const response = await fetch(
      `http://127.0.0.1:${server.address().port}/api/loyalty/virtual-pos${path}`,
      {
        method,
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${token}`,
          'x-bulka-branch-id': BRANCH,
          'x-bulka-terminal-id': TERMINAL,
          ...headers,
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      },
    );
    return { status: response.status, body: await response.json() };
  };
  assert.equal(
    (await send('GET', `/poll?terminalId=${TERMINAL}`, null, { authorization: 'Bearer invalid' }))
      .status,
    401,
  );
  assert.equal(
    (await send('GET', `/poll?terminalId=${TERMINAL}`, null, { 'x-bulka-branch-id': OTHER }))
      .status,
    401,
  );
  assert.equal((await send('GET', `/poll?terminalId=${OTHER}`)).status, 403);
  assert.equal((await send('GET', '/poll')).status, 400);
  assert.equal(calls.length, 0);
  assert.deepEqual((await send('GET', `/poll?terminalId=${TERMINAL}`)).body, {
    success: true,
    command: null,
  });
  const snapshot = {
    terminalId: TERMINAL,
    revision: 'fresh',
    cashShift: { id: null, isOpen: false },
    products: [],
    paymentTypes: [],
    profile: { nonFiscalNoPaperVerified: false },
  };
  assert.equal((await send('POST', '/snapshot', { ...snapshot, terminalId: OTHER })).status, 401);
  assert.deepEqual((await send('POST', '/snapshot', snapshot)).body, {
    success: true,
    revision: 'fresh',
  });
  assert.equal(calls.at(-1).payload.p_branch, BRANCH);
  const accepted = await send('POST', '/action', {
    terminalId: TERMINAL,
    saleId: SALE,
    leaseToken: randomUUID(),
    action: 'creating',
  });
  assert.deepEqual(accepted.body, {
    success: true,
    sale: { id: SALE, status: 'creating' },
    guardAccepted: true,
  });
  assert.equal(
    (
      await send('POST', '/action', {
        terminalId: TERMINAL,
        saleId: SALE,
        leaseToken: randomUUID(),
        action: 'retry',
      })
    ).status,
    400,
  );
});

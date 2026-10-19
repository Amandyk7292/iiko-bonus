const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const vm = require('node:vm');
const { createClient } = require('@supabase/supabase-js');
const { frontAutoReceiptPollSchema } = require('../src/contracts/front-auto-receipt.contract');

function load(path, mocks) {
  const filename = require.resolve(path);
  const module = { exports: {} };
  const localRequire = createRequire(filename);
  const run = vm.runInThisContext(
    `(function(require,module,exports){${readFileSync(filename, 'utf8')}\n})`,
    { filename },
  );
  run((id) => (Object.hasOwn(mocks, id) ? mocks[id] : localRequire(id)), module, module.exports);
  return module.exports;
}

async function invoke(middleware, request) {
  const result = {};
  const response = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  await middleware(request, response, (error) => {
    if (error) result.error = error;
    else result.next = true;
  });
  return result;
}

function authFixture() {
  const terminal = randomUUID();
  const branch = randomUUID();
  const group = randomUUID();
  const token = `pt1_${'a'.repeat(64)}`;
  const state = {
    active: true,
    branchActive: true,
    branchMissing: false,
    minimum: false,
    policyError: null,
    gate: null,
  };
  const calls = [];
  const db = {
    from(table) {
      calls.push(['from', table]);
      const q = {
        select(value) {
          calls.push(['select', table, value]);
          return q;
        },
        eq() {
          return q;
        },
        async maybeSingle() {
          if (state.gate) await state.gate;
          if (table === 'pos_devices')
            return {
              data: state.active
                ? {
                    terminal_id: terminal,
                    branch_id: branch,
                    terminal_group_id: group,
                    token_hash: token,
                    plugin_version: '1.14.6',
                    branch: state.branchMissing ? null : { id: branch, active: state.branchActive },
                  }
                : null,
            };
          if (table === 'pos_plugin_policy')
            return {
              data: { enforce_minimum: state.minimum, minimum_version: '2.0.0' },
              error: state.policyError,
            };
          throw new Error(`Unexpected round trip to ${table}`);
        },
      };
      return q;
    },
  };
  const authMocks = {
    '../config/supabase': { supabase: db },
    '../services/auth.service': { safeEqual: (a, b) => a === b },
  };
  const { posTransportMiddleware } = load('../src/middlewares/pos-transport.middleware', {
    ...authMocks,
    '../services/pos-pairing.service': { posDeviceTokenHash: (value) => value },
    '../services/pos-health.service': { compareVersions: () => -1 },
    './webhook.middleware': { webhookMiddleware: (_req, _res, next) => next() },
  });
  const { branchPosAuthMiddleware } = load('../src/middlewares/branch-pos-auth.middleware', {
    ...authMocks,
    '../services/branch-pos-credential.service': { branchPosTokenHash: (value) => value },
  });
  const request = () => ({
    method: 'POST',
    path: '/api/loyalty/orders/receipts/poll',
    headers: {
      authorization: `Bearer ${token}`,
      'x-bulka-terminal-id': terminal,
      'x-bulka-plugin-version': '1.14.6',
    },
    body: { terminalId: terminal },
  });
  const authenticate = async (req = request()) => {
    const transport = await invoke(posTransportMiddleware, req);
    return transport.next ? invoke(branchPosAuthMiddleware, req) : transport;
  };
  return { state, calls, request, authenticate, branch, terminal, group, branchPosAuthMiddleware };
}

test('paired POS reads current device/branch and policy in parallel, without another branch round trip', async () => {
  const f = authFixture();
  let release;
  f.state.gate = new Promise((resolve) => {
    release = resolve;
  });
  const req = f.request();
  const result = f.authenticate(req);
  assert.deepEqual(
    f.calls.filter(([method]) => method === 'from'),
    [
      ['from', 'pos_devices'],
      ['from', 'pos_plugin_policy'],
    ],
    'both reads must start while either response is still pending',
  );
  release();
  assert.equal((await result).next, true);
  assert.equal(req.posBranchId, f.branch);
  assert.equal(f.calls.filter(([method]) => method === 'from').length, 2);
  assert.match(
    f.calls.find(([method, table]) => method === 'select' && table === 'pos_devices')[2],
    /branch:bulka_locations!inner\(id,active\)/,
  );
});

test('the next request observes device, branch and policy revocation immediately; no authorization cache', async () => {
  const f = authFixture();
  assert.equal((await f.authenticate()).next, true);
  f.state.active = false;
  assert.equal((await f.authenticate()).status, 401);
  f.state.active = true;
  f.state.branchActive = false;
  assert.equal((await f.authenticate()).body.code, 'BRANCH_POS_UNAUTHORIZED');
  f.state.branchActive = true;
  f.state.minimum = true;
  assert.equal((await f.authenticate()).status, 426);
  f.state.minimum = false;
  assert.equal((await f.authenticate()).next, true);
  assert.equal(
    f.calls.filter(([method, table]) => method === 'from' && table === 'pos_devices').length,
    5,
  );
});

test('missing joined branch, policy failure and spoofed terminal/group/body branch fail closed', async () => {
  const f = authFixture();
  f.state.branchMissing = true;
  assert.equal((await f.authenticate()).status, 401);
  f.state.branchMissing = false;
  f.state.policyError = new Error('Database unavailable');
  assert.equal((await f.authenticate()).error, f.state.policyError);
  f.state.policyError = null;
  for (const change of [
    { branchId: randomUUID() },
    { terminalId: randomUUID() },
    { terminalGroupId: randomUUID() },
  ]) {
    const request = f.request();
    Object.assign(request.body, change);
    assert.equal((await f.authenticate(request)).status, 401);
  }
  const req = f.request();
  req.pairedPos = { branch_id: f.branch, token_hash: 'hash' };
  assert.equal((await invoke(f.branchPosAuthMiddleware, req)).status, 401);
});

function receiptFixture() {
  const rows = [];
  const requests = [];
  const db = createClient('https://fixture.invalid', 'fixture-key', {
    auth: { persistSession: false },
    global: {
      fetch: async (input) => {
        const url = new URL(typeof input === 'string' ? input : input.url);
        requests.push(url);
        let result = rows.slice();
        if (url.searchParams.get('fiscal_due') === 'eq.true')
          result = result.filter((row) => row.fiscal_due);
        if (
          url.searchParams.getAll('or').includes('(fiscal_due.eq.true,assembly_status.neq.printed)')
        )
          result = result.filter((row) => row.fiscal_due || row.assembly_status !== 'printed');
        const order = (url.searchParams.get('order') || '').split(',').filter(Boolean);
        result.sort((a, b) => {
          for (const rule of order) {
            const [column, direction] = rule.split('.');
            if (a[column] === b[column]) continue;
            return (a[column] < b[column] ? -1 : 1) * (direction === 'desc' ? -1 : 1);
          }
          return 0;
        });
        result = result.slice(0, Number(url.searchParams.get('limit')));
        return new Response(JSON.stringify(result), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      },
    },
  });
  const service = load('../src/services/front-auto-receipt.service', {
    '../config/supabase': { supabase: db },
    './front-stock-guard.service': {},
  });
  const add = (id, fiscalDue, assemblyStatus) => {
    const row = {
      order_id: id,
      created_at: `2026-10-19T00:${String(rows.length).padStart(2, '0')}:00Z`,
      updated_at: `2026-10-19T00:${String(rows.length).padStart(2, '0')}:00Z`,
      fiscal_due: fiscalDue,
      assembly_status: assemblyStatus,
      kaspi_orders: { order_number: rows.length + 1, status: 'paid' },
    };
    rows.push(row);
    return row;
  };
  return { service, add, requests };
}

test('automatic receipt queue filters more than 20 idle jobs before paging, prioritizes fiscal work and keeps recovery work', async () => {
  const f = receiptFixture();
  for (let i = 0; i < 25; i++) f.add(`idle-${i}`, false, 'printed');
  f.add('assembly', false, 'pending');
  f.add('recover-assembly', false, 'printing');
  f.add('fiscal', true, 'printed');
  const result = await f.service.listAutoReceipts('branch', {
    terminalId: 'terminal',
    assemblyVersion: 1,
    workOnly: true,
  });
  assert.deepEqual(
    result.jobs.map((job) => job.orderId),
    ['fiscal', 'assembly', 'recover-assembly'],
  );
  assert.deepEqual(f.requests[0].searchParams.getAll('or'), [
    '(terminal_id.is.null,terminal_id.eq.terminal)',
    '(fiscal_due.eq.true,assembly_status.neq.printed)',
  ]);
  assert.equal(
    f.requests[0].searchParams.get('order'),
    'fiscal_due.desc,updated_at.asc,created_at.asc,order_id.asc',
  );
  assert.equal(f.requests[0].searchParams.get('limit'), '20');
});

test('failed attempts rotate behind fresh fiscal jobs without giving assembly work priority over fiscal work', async () => {
  const f = receiptFixture();
  const stalled = [];
  for (let i = 0; i < 20; i++) stalled.push(f.add(`stalled-fiscal-${i}`, true, 'printed'));
  f.add('fresh-fiscal', true, 'printed');
  f.add('assembly', false, 'pending');
  const payload = { terminalId: 'terminal', assemblyVersion: 1, workOnly: true };
  const first = await f.service.listAutoReceipts('branch', payload);
  assert.equal(first.jobs.length, 20);
  assert.equal(
    first.jobs.some((job) => job.orderId === 'fresh-fiscal'),
    false,
  );
  // Both successful claims and reported print problems persist updated_at. A
  // stuck printer must not permanently occupy every slot of the next page.
  for (const row of stalled) row.updated_at = '2026-10-19T01:00:00Z';
  const next = await f.service.listAutoReceipts('branch', payload);
  assert.equal(next.jobs[0].orderId, 'fresh-fiscal');
  assert.equal(
    next.jobs.some((job) => job.orderId === 'assembly'),
    false,
  );
  assert.equal(new Set(next.jobs.map((job) => job.orderId)).size, 20);
});

test('manual reprints and installed older plugins retain idle jobs; old assembly-unaware clients remain fiscal only', async () => {
  const f = receiptFixture();
  f.add('idle-manual-reprint', false, 'printed');
  f.add('assembly', false, 'pending');
  f.add('fiscal', true, 'printed');
  for (const workOnly of [undefined, false]) {
    const result = await f.service.listAutoReceipts('branch', {
      terminalId: 'terminal',
      assemblyVersion: 1,
      workOnly,
    });
    assert.deepEqual(
      result.jobs.map((job) => job.orderId),
      ['fiscal', 'idle-manual-reprint', 'assembly'],
    );
  }
  const legacy = await f.service.listAutoReceipts('branch', {
    terminalId: 'terminal',
    workOnly: true,
  });
  assert.deepEqual(
    legacy.jobs.map((job) => job.orderId),
    ['fiscal'],
  );
  const body = { terminalId: randomUUID(), assemblyVersion: 1 };
  for (const workOnly of [undefined, false, true])
    assert.equal(frontAutoReceiptPollSchema.safeParse({ ...body, workOnly }).success, true);
  assert.equal(frontAutoReceiptPollSchema.safeParse({ ...body, workOnly: 'true' }).success, false);
});

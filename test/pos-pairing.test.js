const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
require.cache[require.resolve('../src/config/supabase')] = {
  exports: {
    supabase: {
      from() {
        throw new Error('Unexpected database call');
      },
    },
  },
};
const { activatePosSchema } = require('../src/contracts/pos-pairing.contract');
const {
  issuePosPairingCode,
  activatePosDevice,
  posDeviceTokenHash,
} = require('../src/services/pos-pairing.service');
const { credentialHash } = require('../src/utils/secret-envelope.util');
const { supabase } = require('../src/config/supabase');
const { posTransportMiddleware } = require('../src/middlewares/pos-transport.middleware');
const {
  branchPosAuthMiddleware,
  branchPosRolloutMiddleware,
} = require('../src/middlewares/branch-pos-auth.middleware');
const { adminMutationRoleMiddleware } = require('../src/middlewares/auth.middleware');

const db = new PGlite();
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key,name text,active boolean default true);
    create table front_stock_policies(branch_id uuid primary key,enabled boolean default false,
      terminal_ids uuid[] check(cardinality(terminal_ids)<=8),updated_at timestamptz default now());`);
  await db.exec(readFileSync('supabase/migrations/20260910160000_pos_device_pairing.sql', 'utf8'));
});
test.after(() => db.close());
const hash = () => randomUUID().replaceAll('-', '').repeat(2);
async function branch() {
  const id = randomUUID();
  await db.query('insert into bulka_locations(id,name) values($1,$2)', [id, 'Тестовый филиал']);
  return id;
}
async function code(id) {
  const value = hash();
  await db.query('select issue_pos_pairing_code($1,$2)', [id, value]);
  return value;
}
async function activate(
  c,
  terminal = randomUUID(),
  group = randomUUID(),
  token = hash(),
  expected = null,
) {
  const { rows } = await db.query('select activate_pos_device($1,$2,$3,$4,$5,$6) as value', [
    c,
    terminal,
    group,
    'Касса',
    token,
    expected,
  ]);
  return rows[0].value;
}

test('two registers link independently; retry cannot consume a code for another register', async () => {
  const b = await branch(),
    t1 = randomUUID(),
    t2 = randomUUID(),
    group = randomUUID(),
    h1 = hash(),
    h2 = hash();
  const c1 = await code(b);
  assert.equal((await activate(c1, t1, group, h1)).branchId, b);
  assert.deepEqual(await activate(c1, t2, group, h2), { error: 'invalid_code' });
  const c2 = await code(b);
  assert.equal((await activate(c2, t2, group, h2)).branchId, b);
  const { rows } = await db.query(
    'select terminal_id, token_hash from pos_devices where branch_id=$1 order by terminal_id',
    [b],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows.find((r) => r.terminal_id === t1).token_hash, h1);
  assert.equal((await activate(c1, t1, group, h1)).terminalId, t1);
  assert.deepEqual(await activate(c1, t1, group, hash()), { error: 'invalid_code' });
});

test('expired, replaced and consumed codes cannot create another registration', async () => {
  const b = await branch(),
    c = await code(b);
  await db.query(
    "update pos_pairing_codes set expires_at=now()-interval '1 second' where code_hash=$1",
    [c],
  );
  assert.deepEqual(await activate(c), { error: 'invalid_code' });
  const replaced = await code(b);
  await code(b);
  assert.deepEqual(await activate(replaced), { error: 'invalid_code' });
  assert.deepEqual(await activate(hash()), { error: 'invalid_code' });
});

test('a paired device cannot migrate to another branch or an unrelated terminal group', async () => {
  const b1 = await branch(),
    b2 = await branch(),
    t = randomUUID(),
    group = randomUUID();
  await activate(await code(b1), t, group);
  assert.deepEqual(await activate(await code(b2), t, group), { error: 'different_branch' });
  assert.deepEqual(await activate(await code(b1)), { error: 'different_group' });
  assert.deepEqual(await activate(await code(b2), randomUUID(), randomUUID(), hash(), b1), {
    error: 'different_branch',
  });
  await db.query('update bulka_locations set active=false where id=$1', [b1]);
  await assert.rejects(code(b1));
});

test('re-pairing only rotates that terminal and stale retry cannot restore an old credential', async () => {
  const b = await branch(),
    terminal = randomUUID(),
    group = randomUUID(),
    token = hash();
  const old = await code(b);
  await activate(old, terminal, group, token);
  const replacement = hash();
  await activate(await code(b), terminal, group, replacement);
  assert.deepEqual(await activate(old, terminal, group, token), { error: 'invalid_code' });
  await db.query('update pos_devices set active=false where terminal_id=$1', [terminal]);
  assert.deepEqual(await activate(old, terminal, group, token), { error: 'invalid_code' });
});

test('enabled stock policy keeps the first terminal and enrolls the second without resetting it', async () => {
  const b = await branch(),
    t1 = randomUUID(),
    t2 = randomUUID(),
    group = randomUUID();
  await db.query(
    'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
    [b, [t1]],
  );
  const result = await activate(await code(b), t2, group);
  assert.equal(result.sharedStockEnabled, true);
  const { rows } = await db.query(
    'select terminal_ids from front_stock_policies where branch_id=$1',
    [b],
  );
  assert.deepEqual(rows[0].terminal_ids, [t1, t2]);
  const untouched = await branch();
  assert.equal((await activate(await code(untouched))).sharedStockEnabled, false);
});

test('durable attempt limiter survives separate calls, expires and separates sources', async () => {
  const source = hash();
  for (let i = 0; i < 12; i++) {
    const { rows } = await db.query('select allow_pos_pairing_attempt($1) as allowed', [source]);
    assert.equal(rows[0].allowed, i < 10);
  }
  await db.query(
    "update pos_pairing_attempts set window_start=now()-interval '11 minutes' where source_hash=$1",
    [source],
  );
  assert.equal(
    (await db.query('select allow_pos_pairing_attempt($1) as allowed', [source])).rows[0].allowed,
    true,
  );
});

test('codes and credential tables/RPCs are inaccessible to anonymous and customer roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(db.query('select * from pos_devices'));
    await assert.rejects(db.query('select * from pos_pairing_codes'));
    await assert.rejects(db.query('select allow_pos_pairing_attempt($1)', [hash()]));
    await db.exec('reset role');
  }
});

const chain = (result) => {
  const builder = { then: (resolve) => Promise.resolve(result).then(resolve) };
  for (const name of ['select', 'eq', 'order']) builder[name] = () => builder;
  builder.maybeSingle = async () => result;
  return builder;
};
test('cashier issues a six-digit branch-scoped code, stores only the hash and cannot choose another branch', async () => {
  const b = randomUUID();
  let stored;
  const fake = {
    from: () => chain({ data: { id: b, name: 'Филиал' } }),
    rpc: async (name, params) => {
      stored = params;
      return { data: { id: randomUUID(), expiresAt: new Date(Date.now() + 300000).toISOString() } };
    },
  };
  const result = await issuePosPairingCode({ role: 'cashier', branchIds: [b] }, fake);
  assert.match(result.code, /^[1-9][0-9]{5}$/);
  assert.equal(stored.p_branch, b);
  assert.equal(stored.p_code_hash, credentialHash(result.code, 'pos-pairing-code'));
  assert.equal(JSON.stringify(stored).includes(result.code), false);
  await assert.rejects(
    issuePosPairingCode(
      { role: 'cashier', branchIds: [] },
      { ...fake, from: () => chain({ data: null }) },
    ),
  );
  await assert.rejects(issuePosPairingCode({ role: 'viewer', branchIds: [b] }, fake));
  await assert.rejects(issuePosPairingCode({ role: 'admin' }, fake));
});

test('activation validates its contract and rate limit runs before checking the code', async () => {
  const input = {
    code: '123456',
    terminalId: randomUUID(),
    terminalGroupId: randomUUID(),
    terminalName: 'Касса 2',
    terminalToken: 'pt1_' + 'a'.repeat(64),
  };
  assert.equal(activatePosSchema.safeParse(input).success, true);
  for (const change of [
    { code: '12345' },
    { branchId: randomUUID() },
    { terminalToken: 'short' },
    { terminalId: 'bad' },
  ]) {
    assert.equal(activatePosSchema.safeParse({ ...input, ...change }).success, false);
  }
  const calls = [];
  await assert.rejects(
    activatePosDevice(input, 'source', {
      rpc: async (name) => {
        calls.push(name);
        return { data: false };
      },
    }),
    { statusCode: 429 },
  );
  assert.deepEqual(calls, ['allow_pos_pairing_attempt']);
});

const invoke = async (fn, req) => {
  const result = {};
  const res = {
    status: (code) => {
      result.status = code;
      return res;
    },
    json: (value) => {
      result.body = value;
      return res;
    },
  };
  await fn(req, res, (error) => {
    if (error) result.error = error;
    else result.next = true;
  });
  return result;
};
test('paired POS authentication binds branch, physical terminal, group and gift reservation; no global token needed', async (t) => {
  const b = randomUUID(),
    terminal = randomUUID(),
    group = randomUUID(),
    token = 'pt1_' + 'c'.repeat(64);
  let active = true;
  t.mock.method(supabase, 'from', (table) =>
    chain({
      data:
        table === 'pos_devices'
          ? {
              terminal_id: terminal,
              branch_id: b,
              terminal_group_id: group,
              token_hash: posDeviceTokenHash(token),
            }
          : table === 'bulka_locations'
            ? active
              ? { id: b }
              : null
            : { branch_id: randomUUID() },
    }),
  );
  const request = (body = {}) => ({
    headers: { authorization: `Bearer ${token}`, 'x-bulka-terminal-id': terminal },
    body,
    path: '/api/loyalty/inventory/sale',
  });
  const valid = request({ terminalId: terminal, branchId: b });
  assert.equal((await invoke(posTransportMiddleware, valid)).next, true);
  assert.equal((await invoke(branchPosRolloutMiddleware, valid)).next, true);
  assert.equal(valid.posAuthMode, 'branch');
  assert.equal(valid.posBranchId, b);
  assert.equal(
    (await invoke(posTransportMiddleware, request({ terminalId: randomUUID() }))).status,
    401,
  );
  assert.equal(
    (await invoke(posTransportMiddleware, request({ terminalGroupId: randomUUID() }))).status,
    401,
  );
  const wrongBranch = request({ branchId: randomUUID() });
  await invoke(posTransportMiddleware, wrongBranch);
  assert.equal((await invoke(branchPosAuthMiddleware, wrongBranch)).status, 401);
  const gift = request({ reservationId: randomUUID() });
  gift.path = '/api/loyalty/gift-cards/commit';
  await invoke(posTransportMiddleware, gift);
  assert.equal((await invoke(branchPosAuthMiddleware, gift)).status, 401);
  active = false;
  const disabled = request();
  await invoke(posTransportMiddleware, disabled);
  assert.equal((await invoke(branchPosAuthMiddleware, disabled)).status, 401);
});

test('cashier RBAC permits issuing a pairing code but not unrelated device mutations', async () => {
  const admin = { role: 'cashier', branchIds: [randomUUID()] };
  assert.equal(
    (
      await invoke(adminMutationRoleMiddleware, {
        admin,
        method: 'POST',
        path: '/staff/pos/pairing-code',
      })
    ).next,
    true,
  );
  assert.equal(
    (
      await invoke(adminMutationRoleMiddleware, {
        admin,
        method: 'DELETE',
        path: '/staff/pos/devices',
      })
    ).status,
    403,
  );
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (name, args) =>
  (await one(`select ${name}(${args.map((_, index) => `$${index + 1}`).join(',')}) r`, args)).r;
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key,name text,active boolean default true);
    create table pos_devices(terminal_id uuid primary key,branch_id uuid,active boolean default true,device_role text default 'register');`);
  await db.exec(
    fs.readFileSync('supabase/migrations/20261013190000_virtual_pos_sales.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function fixture() {
  const f = {
    branch: randomUUID(),
    terminal: randomUUID(),
    shift: randomUUID(),
    payment: randomUUID(),
    product: randomUUID(),
    actor: randomUUID(),
  };
  await db.query('insert into bulka_locations(id,name) values($1,$2)', [f.branch, 'Test']);
  await db.query('insert into pos_devices(terminal_id,branch_id) values($1,$2)', [
    f.terminal,
    f.branch,
  ]);
  await db.query(
    'insert into virtual_pos_terminals(branch_id,terminal_id,enabled) values($1,$2,true)',
    [f.branch, f.terminal],
  );
  f.snapshot = {
    terminalId: f.terminal,
    revision: 'revision-1',
    cashShift: { id: f.shift, isOpen: true },
    profile: { nonFiscalNoPaperVerified: true },
    products: [
      {
        id: f.product,
        name: 'Товар',
        price: 10.05,
        quantityStep: 0.001,
        available: true,
        paymentTypeIds: [f.payment],
      },
    ],
    paymentTypes: [{ id: f.payment, name: 'Нефискальная', isFiscal: false, selectable: true }],
  };
  await publish(f);
  f.request = {
    requestId: randomUUID(),
    terminalId: f.terminal,
    snapshotRevision: 'revision-1',
    cashShiftId: f.shift,
    paymentTypeId: f.payment,
    items: [{ productId: f.product, quantity: 0.5 }],
    expectedTotal: 5.03,
  };
  return f;
}
const publish = (f) =>
  rpc('publish_virtual_pos_snapshot', [f.branch, f.terminal, JSON.stringify(f.snapshot)]);
const create = (f, changes = {}, actor = f.actor, branch = f.branch) =>
  rpc('create_virtual_pos_sale', [branch, actor, JSON.stringify({ ...f.request, ...changes })]);
const poll = (f, terminal = f.terminal, branch = f.branch) =>
  rpc('claim_virtual_pos_sale', [branch, terminal]);
const action = (f, command, target, changes = {}) =>
  rpc('advance_virtual_pos_sale', [
    f.branch,
    f.terminal,
    JSON.stringify({
      saleId: f.request.requestId,
      leaseToken: command.leaseToken,
      action: target,
      ...changes,
    }),
  ]);

test('authoritative SQL rounds exact decimal lines and idempotently replays before freshness checks', async () => {
  const f = await fixture();
  const [first, simultaneous] = await Promise.all([create(f), create(f)]);
  assert.equal(first.sale.total, 5.03);
  assert.deepEqual(first, simultaneous);
  assert.equal(
    (await one('select count(*)::int n from virtual_pos_sales where id=$1', [f.request.requestId]))
      .n,
    1,
  );
  await db.query(
    "update virtual_pos_snapshots set received_at=now()-interval '1 day' where terminal_id=$1",
    [f.terminal],
  );
  assert.deepEqual(await create(f), first);
  assert.equal((await create(f, { expectedTotal: 6 })).error, 'VIRTUAL_POS_IDEMPOTENCY_CONFLICT');
  assert.equal((await create(f, {}, 'other-worker')).error, 'VIRTUAL_POS_IDEMPOTENCY_CONFLICT');
  assert.equal(
    (await create(f, {}, f.actor, randomUUID())).error,
    'VIRTUAL_POS_IDEMPOTENCY_CONFLICT',
  );
});

test('tiyn totals sum independently rounded lines rather than round raw subtotal', async () => {
  const f = await fixture();
  const second = randomUUID();
  f.snapshot.products.push({ ...f.snapshot.products[0], id: second });
  await publish(f);
  f.request.items.push({ productId: second, quantity: 0.5 });
  f.request.expectedTotal = 10.06;
  assert.equal((await create(f)).sale.total, 10.06);
});

test('definite rejection consumes immutable request key across catalog recovery and concurrent tabs', async () => {
  const f = await fixture();
  const oldRequest = { ...f.request };
  await db.query(
    "update virtual_pos_snapshots set received_at=now()-interval '46 seconds' where terminal_id=$1",
    [f.terminal],
  );
  const [rejected, duplicate] = await Promise.all([create(f), create(f)]);
  assert.equal(rejected.error, 'VIRTUAL_POS_OFFLINE');
  assert.equal(rejected.safelyRejected, true);
  assert.deepEqual(duplicate, rejected);
  assert.equal(
    (
      await one('select count(*)::int n from virtual_pos_rejected_requests where request_id=$1', [
        f.request.requestId,
      ])
    ).n,
    1,
  );
  await publish(f);
  f.request = { ...oldRequest, requestId: randomUUID() };
  assert.equal((await create(f)).sale.status, 'queued');
  f.request = oldRequest;
  assert.deepEqual(await create(f), rejected);
  assert.equal((await create(f, {}, 'other-actor')).error, 'VIRTUAL_POS_IDEMPOTENCY_CONFLICT');
  assert.equal(
    (await create(f, {}, f.actor, randomUUID())).error,
    'VIRTUAL_POS_IDEMPOTENCY_CONFLICT',
  );
  assert.equal((await create(f, { expectedTotal: 10 })).error, 'VIRTUAL_POS_IDEMPOTENCY_CONFLICT');
  assert.equal(
    (await one('select count(*)::int n from virtual_pos_sales where actor_id=$1', [f.actor])).n,
    1,
  );
});

test('sale preflight rejects stale/closed/fiscal/unsupported and wrong amounts without queuing', async () => {
  const cases = [
    {
      modify: (f) => {
        f.request.snapshotRevision = 'old';
      },
      code: 'VIRTUAL_POS_STALE_CATALOG',
    },
    {
      modify: (f) => {
        f.snapshot.cashShift.isOpen = false;
      },
      code: 'VIRTUAL_POS_SHIFT_CHANGED',
    },
    {
      modify: (f) => {
        f.snapshot.profile.nonFiscalNoPaperVerified = false;
      },
      code: 'VIRTUAL_POS_PROFILE_UNVERIFIED',
    },
    {
      modify: (f) => {
        f.snapshot.paymentTypes[0].isFiscal = true;
      },
      code: 'VIRTUAL_POS_PAYMENT_FORBIDDEN',
    },
    {
      modify: (f) => {
        f.snapshot.products[0].paymentTypeIds = [];
      },
      code: 'VIRTUAL_POS_PRODUCT_UNAVAILABLE',
    },
    {
      modify: (f) => {
        f.snapshot.products[0].quantityStep = 1;
      },
      code: 'VIRTUAL_POS_QUANTITY_INVALID',
    },
    {
      modify: (f) => {
        f.request.expectedTotal = 5.02;
      },
      code: 'VIRTUAL_POS_TOTAL_CHANGED',
    },
    {
      modify: (f) => {
        f.request.items[0].quantity = 0.0001;
      },
      code: 'VIRTUAL_POS_QUANTITY_INVALID',
    },
    {
      modify: (f) => {
        f.request.items[0].quantity = 10000;
      },
      code: 'VIRTUAL_POS_QUANTITY_INVALID',
    },
    {
      modify: (f) => {
        f.request.items.push(f.request.items[0]);
      },
      code: 'VIRTUAL_POS_INVALID_ITEMS',
    },
  ];
  for (const { modify, code } of cases) {
    const f = await fixture();
    modify(f);
    await publish(f);
    const result = await create(f);
    assert.equal(result.error, code);
    assert.equal(result.safelyRejected, true);
    assert.equal(
      (
        await one('select count(*)::int n from virtual_pos_sales where id=$1', [
          f.request.requestId,
        ])
      ).n,
      0,
    );
  }
  const f = await fixture();
  await db.query(
    "update virtual_pos_snapshots set received_at=now()-interval '46 seconds' where terminal_id=$1",
    [f.terminal],
  );
  assert.equal((await create(f)).error, 'VIRTUAL_POS_OFFLINE');
});

test('terminal authorization pins approved active register to branch and rejects malformed cross bindings', async () => {
  const f = await fixture(),
    other = await fixture();
  assert.equal((await poll(f, other.terminal)).error, 'VIRTUAL_POS_TERMINAL_FORBIDDEN');
  assert.equal(
    (
      await rpc('publish_virtual_pos_snapshot', [
        other.branch,
        f.terminal,
        JSON.stringify(f.snapshot),
      ])
    ).error,
    'VIRTUAL_POS_TERMINAL_FORBIDDEN',
  );
  assert.equal(
    (await create(f, { terminalId: other.terminal })).error,
    'VIRTUAL_POS_TERMINAL_FORBIDDEN',
  );
  f.request.requestId = randomUUID();
  await db.query("update pos_devices set device_role='bakery' where terminal_id=$1", [f.terminal]);
  assert.equal((await create(f)).error, 'VIRTUAL_POS_TERMINAL_FORBIDDEN');
});

test('leases serialize guards, reject phase skips and never repeat creation or payment after lost ACK', async () => {
  const f = await fixture();
  await create(f);
  const command = (await poll(f)).command;
  assert.equal(command.phase, 'claimed');
  assert.equal(command.items[0].price, 10.05);
  assert.equal((await poll(f)).command.leaseToken, command.leaseToken);
  assert.equal((await action(f, command, 'completed')).error, 'VIRTUAL_POS_PHASE_CONFLICT');
  assert.equal(
    (await action(f, { ...command, leaseToken: randomUUID() }, 'creating')).error,
    'VIRTUAL_POS_LEASE_FORBIDDEN',
  );
  const guards = await Promise.all([
    action(f, command, 'creating'),
    action(f, command, 'creating'),
  ]);
  assert.equal(guards.filter((result) => result.guardAccepted).length, 1);
  const order = randomUUID();
  assert.equal((await action(f, command, 'created')).error, 'VIRTUAL_POS_ORDER_REQUIRED');
  assert.equal(
    (await action(f, command, 'created', { frontOrderId: order })).sale.status,
    'created',
  );
  assert.equal((await action(f, command, 'rejected')).error, 'VIRTUAL_POS_PHASE_CONFLICT');
  assert.equal((await action(f, command, 'creating')).guardAccepted, false);
  const paymentGuards = await Promise.all([
    action(f, command, 'payment_started'),
    action(f, command, 'payment_started'),
  ]);
  assert.equal(paymentGuards.filter((result) => result.guardAccepted).length, 1);
  assert.equal((await action(f, command, 'rejected')).error, 'VIRTUAL_POS_PHASE_CONFLICT');
  await db.query(
    "update virtual_pos_sales set lease_expires_at=now()-interval '1 second' where id=$1",
    [f.request.requestId],
  );
  assert.equal((await poll(f)).command.phase, 'needs_reconciliation');
  assert.equal((await action(f, command, 'creating')).error, 'VIRTUAL_POS_PHASE_CONFLICT');
  assert.equal(
    (await action(f, command, 'completed', { frontOrderId: randomUUID() })).error,
    'VIRTUAL_POS_ORDER_CONFLICT',
  );
  const completed = await action(f, command, 'completed', { frontOrderId: order });
  assert.equal(completed.sale.status, 'completed');
  assert.equal((await create(f)).sale.frontOrderId, order);
  assert.equal((await poll(f)).command, null);
});

test('catalog changes reject queued work; terminal restart never renews an uncertain command as queued', async () => {
  const f = await fixture();
  await create(f);
  f.snapshot.revision = 'revision-2';
  await publish(f);
  assert.equal((await poll(f)).command, null);
  assert.equal(
    (await one('select status from virtual_pos_sales where id=$1', [f.request.requestId])).status,
    'rejected',
  );
  const restart = await fixture();
  await create(restart);
  const c = (await poll(restart)).command;
  await action(restart, c, 'creating');
  await db.query(
    "update virtual_pos_sales set lease_expires_at=now()-interval '1 second' where id=$1",
    [restart.request.requestId],
  );
  const recovered = (await poll(restart)).command;
  assert.equal(recovered.phase, 'needs_reconciliation');
  assert.equal(recovered.leaseToken, c.leaseToken);
});

test('creation/payment guards recheck fresh cash shift and verified snapshot at the moment of mutation', async () => {
  const f = await fixture();
  await create(f);
  const c = (await poll(f)).command;
  f.snapshot.cashShift.isOpen = false;
  await publish(f);
  assert.equal((await action(f, c, 'creating')).error, 'VIRTUAL_POS_SNAPSHOT_CHANGED');
  f.snapshot.cashShift.isOpen = true;
  await publish(f);
  assert.equal((await action(f, c, 'creating')).guardAccepted, true);
  await action(f, c, 'created', { frontOrderId: randomUUID() });
  f.snapshot.profile.nonFiscalNoPaperVerified = false;
  await publish(f);
  assert.equal((await action(f, c, 'payment_started')).error, 'VIRTUAL_POS_SNAPSHOT_CHANGED');
  f.snapshot.profile.nonFiscalNoPaperVerified = true;
  await publish(f);
  await db.query(
    "update virtual_pos_sales set lease_expires_at=now()-interval '1 second' where id=$1",
    [f.request.requestId],
  );
  assert.equal((await action(f, c, 'payment_started')).error, 'VIRTUAL_POS_LEASE_EXPIRED');
});

test('RLS tables and command functions have no anon/authenticated access', async () => {
  for (const table of [
    'virtual_pos_terminals',
    'virtual_pos_snapshots',
    'virtual_pos_sales',
    'virtual_pos_rejected_requests',
  ]) {
    assert.equal(
      (await one('select relrowsecurity enabled from pg_class where relname=$1', [table])).enabled,
      true,
    );
    for (const role of ['anon', 'authenticated'])
      assert.equal(
        (await one("select has_table_privilege($1,$2,'SELECT') allowed", [role, table])).allowed,
        false,
      );
  }
  assert.equal(
    (
      await one(
        "select has_function_privilege('anon','create_virtual_pos_sale(uuid,text,jsonb)','EXECUTE') allowed",
      )
    ).allowed,
    false,
  );
});

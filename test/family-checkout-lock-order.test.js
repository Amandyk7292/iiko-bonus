const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

// PGlite verifies the replacement's real ledger behavior. It cannot prove
// multi-session lock scheduling; the definition check protects the lock order.
const db = new PGlite();
const read = (path) => fs.readFileSync(path, 'utf8');
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
};
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await row(`select ${sql} as r`, args)).r;

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,name text,phone text,deleted_at timestamptz,
      created_at timestamptz default now(),balance numeric default 0,total_spent numeric default 0,
      updated_at timestamptz default now());
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text,
      type text,amount numeric,order_total numeric,description text,items jsonb,branch_id uuid,
      available_at timestamptz,activated_at timestamptz,created_at timestamptz default now(),timestamp timestamptz default now());
    create table kaspi_orders(id uuid primary key,customer_id uuid,operation_id text,client_request_id uuid,
      amount numeric,subtotal numeric,discount_amount numeric default 0,delivery_fee numeric default 0,
      status text default 'pending',fulfillment_status text default 'pending',branch_id uuid,
      earned_bonus numeric default 0,bonus_awarded_at timestamptz,bonus_reversed_at timestamptz,
      refund_status text,cart_items jsonb,promo_code text);
    create table loyalty_reservations(id uuid primary key default gen_random_uuid(),customer_id uuid,
      order_id text unique,original_order_id varchar(200),order_total numeric,discount_amount numeric,status text,
      expires_at timestamptz,updated_at timestamptz default now(),committed_at timestamptz,cancelled_at timestamptz);
    create table order_partial_refunds(id uuid primary key,order_id uuid,status text,amount numeric);
    create table order_partial_refund_items(refund_id uuid,line_key text,unit_amount numeric,quantity numeric,refund_amount numeric);
    create table promotion_redemptions(order_id uuid,promotion_id uuid,discount_amount numeric,
      refunded_discount_amount numeric default 0,released_at timestamptz);
    create table targeted_promotions(id uuid,used_count integer,updated_at timestamptz);`);
  const finances = read(
    'supabase/migrations/20260715120000_financial_branch_courier_hardening.sql',
  );
  const start = finances.indexOf(
    'create table if not exists public.order_partial_refund_adjustments',
  );
  await db.exec(finances.slice(start, finances.indexOf('\n);', start) + 3));
  await db.exec(functionSql(read('supabase_schema.sql'), 'apply_loyalty_transaction'));
  const fulfillment = read('supabase/migrations/20260713190000_order_fulfillment.sql');
  for (const name of [
    'reserve_loyalty_balance',
    'commit_loyalty_reservation',
    'cancel_loyalty_reservation',
  ])
    await db.exec(functionSql(fulfillment, name));
  const retry = read('supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql');
  for (const name of ['reserve_loyalty_balance', 'cancel_loyalty_reservation'])
    await db.exec(functionSql(retry, name));
  for (const migration of [
    '20260909180000_checkout_bonus.sql',
    '20260926114000_refund_reserved_balance.sql',
    '20261002170000_customer_family.sql',
    '20261002172000_family_checkout_bonus.sql',
    '20261002172900_checkout_bonus_recovery.sql',
    '20261002172900_checkout_bonus_recovery.sql',
  ])
    await db.exec(read(`supabase/migrations/${migration}`));
});
test.after(() => db.close());

async function customer(balance = 1200) {
  const id = crypto.randomUUID();
  await db.query(
    "insert into customers(id,name,phone,balance) values($1,'Test','77000000001',$2)",
    [id, balance],
  );
  return id;
}
async function fixture({ family = true } = {}) {
  const owner = await customer();
  const actor = family ? await customer(75) : owner;
  if (family) {
    const group = crypto.randomUUID();
    await db.query('insert into family_groups(id,owner_customer_id) values($1,$2)', [group, owner]);
    await db.query(
      "insert into family_members(group_id,customer_id,name,relation) values($1,$2,'Adult','sister')",
      [group, actor],
    );
  }
  const request = crypto.randomUUID();
  const hold = await rpc('reserve_checkout_bonus($1,$2,1800,900)', [actor, request]);
  const order = crypto.randomUUID(),
    branch = crypto.randomUUID();
  await db.query(
    `insert into kaspi_orders(id,customer_id,operation_id,client_request_id,
      amount,subtotal,discount_amount,delivery_fee,bonus_spent,bonus_reservation_id,branch_id)
    values($1,$2,$3::text,$3::text::uuid,1900,2000,200,1000,900,$4,$5)`,
    [order, actor, request, hold.reservationId, branch],
  );
  return { owner, actor, order, request, reservation: hold.reservationId, branch };
}
async function state(f) {
  return row(
    `select balance,total_spent,
    (select count(*) from transactions where customer_id=$1) as entries
    from customers where id=$1`,
    [f.owner],
  );
}
const commit = (f, delay = 0) => rpc('commit_checkout_bonus($1,45,$2)', [f.order, delay]);

test('deployed function definition locks the order before the immutable owner, matching refund paths', async () => {
  const definition = await rpc(
    "pg_get_functiondef('commit_checkout_bonus(uuid,numeric,integer)'::regprocedure)",
  );
  const orderLock = definition.indexOf('where id = p_order_id for update;');
  const ownerCapture = definition.indexOf(
    'v_owner := coalesce(v_order.bonus_customer_id, v_order.customer_id);',
  );
  const ownerLock = definition.indexOf('pg_advisory_xact_lock(hashtext(v_owner::text))');
  assert.ok(orderLock >= 0 && orderLock < ownerCapture && ownerCapture < ownerLock);
  assert.equal(
    (definition.match(/from public\.kaspi_orders where id = p_order_id/g) || []).length,
    1,
  );
  for (const name of [
    'reverse_loyalty_order(uuid,text,numeric)',
    'apply_partial_refund_adjustments(uuid)',
  ]) {
    const refund = await rpc('pg_get_functiondef($1::regprocedure)', [name]);
    const order = refund.indexOf('from public.kaspi_orders');
    const orderForUpdate = refund.indexOf('for update;', order);
    const loyaltyLock = refund.indexOf('pg_advisory_xact_lock(hashtext(', orderForUpdate);
    assert.ok(order >= 0 && orderForUpdate >= order && loyaltyLock > orderForUpdate, name);
  }
});

test('captured family owner commits once after member leaves, and refund restores only that owner once', async () => {
  const f = await fixture();
  await db.query("update family_members set status='removed' where customer_id=$1", [f.actor]);
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  assert.equal((await commit(f)).status, 'committed');
  assert.equal((await commit(f)).status, 'committed');
  const retained = await row(
    `select o.bonus_reservation_id,r.family_actor_customer_id,r.status,
      (select count(*) from loyalty_reservations where customer_id=$2) as holds
    from kaspi_orders o join loyalty_reservations r on r.id=o.bonus_reservation_id
    where o.id=$1`,
    [f.order, f.owner],
  );
  assert.equal(retained.bonus_reservation_id, f.reservation);
  assert.equal(retained.family_actor_customer_id, f.actor);
  assert.equal(retained.status, 'committed');
  assert.equal(Number(retained.holds), 1);
  const paid = await state(f);
  assert.equal(Number(paid.balance), 345);
  assert.equal(Number(paid.total_spent), 900);
  assert.equal(
    Number((await row('select balance from customers where id=$1', [f.actor])).balance),
    75,
  );
  const branchRows = await db.query('select branch_id from transactions where customer_id=$1', [
    f.owner,
  ]);
  assert.ok(
    branchRows.rows.length > 0 && branchRows.rows.every((entry) => entry.branch_id === f.branch),
  );
  const refund = await rpc('reverse_loyalty_order($1,$2,900)', [f.owner, `kaspi:${f.request}`]);
  assert.equal(refund.spentBonusRestored, 900);
  assert.equal(
    (await rpc('reverse_loyalty_order($1,$2,900)', [f.owner, `kaspi:${f.request}`])).duplicate,
    true,
  );
  assert.equal(Number((await state(f)).balance), 1200);
});

test('expired funded hold is replaced atomically, preserving the original family owner and actor after leaving', async () => {
  const f = await fixture();
  await db.query("update family_members set status='removed' where customer_id=$1", [f.actor]);
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  await db.query(
    "update loyalty_reservations set expires_at=now()-interval '1 second' where id=$1",
    [f.reservation],
  );
  assert.equal((await commit(f)).status, 'committed');
  const renewed = await row(
    `select o.bonus_customer_id,o.bonus_reservation_id,r.customer_id,r.family_actor_customer_id,
      r.order_id,r.discount_amount,r.status
    from kaspi_orders o join loyalty_reservations r on r.id=o.bonus_reservation_id where o.id=$1`,
    [f.order],
  );
  assert.notEqual(renewed.bonus_reservation_id, f.reservation);
  assert.equal(renewed.bonus_customer_id, f.owner);
  assert.equal(renewed.customer_id, f.owner);
  assert.equal(renewed.family_actor_customer_id, f.actor);
  assert.equal(renewed.order_id, `kaspi:${f.request}`);
  assert.equal(Number(renewed.discount_amount), 900);
  assert.equal(renewed.status, 'committed');
  const archived = await row('select * from loyalty_reservations where id=$1', [f.reservation]);
  assert.equal(archived.status, 'expired');
  assert.equal(archived.order_id, `archived:${f.reservation}`);
  assert.equal(archived.original_order_id, `kaspi:${f.request}`);
  assert.equal(archived.family_actor_customer_id, f.actor);
  const paid = await state(f);
  assert.equal(Number(paid.balance), 345);
  assert.equal(Number(paid.total_spent), 900);
  assert.equal((await commit(f)).status, 'committed');
  assert.deepEqual(await state(f), paid);
  assert.equal(
    (
      await rpc('cancel_loyalty_reservation($1,$2,$3)', [
        f.owner,
        `kaspi:${f.request}`,
        f.reservation,
      ])
    ).duplicate,
    true,
  );
  assert.equal(
    (
      await row('select status from loyalty_reservations where id=$1', [
        renewed.bonus_reservation_id,
      ])
    ).status,
    'committed',
  );
  assert.equal(
    (await rpc('reverse_loyalty_order($1,$2,900)', [f.owner, `kaspi:${f.request}`]))
      .spentBonusRestored,
    900,
  );
  const refunded = await state(f);
  assert.equal(Number(refunded.balance), 1200);
  assert.equal(
    (await rpc('reverse_loyalty_order($1,$2,900)', [f.owner, `kaspi:${f.request}`])).duplicate,
    true,
  );
  assert.deepEqual(await state(f), refunded);
  assert.equal(
    Number((await row('select balance from customers where id=$1', [f.actor])).balance),
    75,
  );
});

test('cancelled hold is renewed for a paid callback and retains the actor from the captured order when absent in the old hold', async () => {
  const f = await fixture();
  await rpc('cancel_loyalty_reservation($1,$2,$3)', [f.owner, `kaspi:${f.request}`, f.reservation]);
  await db.query('update loyalty_reservations set family_actor_customer_id=null where id=$1', [
    f.reservation,
  ]);
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  assert.equal((await commit(f)).status, 'committed');
  const renewed = await row(
    `select r.id,r.customer_id,r.family_actor_customer_id,r.status
    from kaspi_orders o join loyalty_reservations r on r.id=o.bonus_reservation_id where o.id=$1`,
    [f.order],
  );
  assert.notEqual(renewed.id, f.reservation);
  assert.equal(renewed.customer_id, f.owner);
  assert.equal(renewed.family_actor_customer_id, f.actor);
  assert.equal(renewed.status, 'committed');
  const paid = await state(f);
  assert.equal(Number(paid.balance), 345);
  assert.equal((await commit(f)).status, 'committed');
  assert.deepEqual(await state(f), paid);
});

test('unpaid, zero-spend and refund-in-progress orders never award through the replacement', async () => {
  for (const guard of ['pending', 'zero', 'reversed', 'processing', 'unknown', 'succeeded']) {
    const f = await fixture();
    if (guard !== 'pending')
      await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
    if (guard === 'zero')
      await db.query('update kaspi_orders set bonus_spent=0 where id=$1', [f.order]);
    if (guard === 'reversed')
      await db.query('update kaspi_orders set bonus_reversed_at=now() where id=$1', [f.order]);
    if (['processing', 'unknown', 'succeeded'].includes(guard))
      await db.query('update kaspi_orders set refund_status=$2 where id=$1', [f.order, guard]);
    assert.equal((await commit(f)).status, 'unavailable', guard);
    const unchanged = await state(f);
    assert.equal(Number(unchanged.balance), 1200, guard);
    assert.equal(Number(unchanged.entries), 0, guard);
  }
});

test('changed reservation owner, order key or discount fails atomically without money or earning entries', async () => {
  for (const field of ['customer_id', 'order_id', 'discount_amount']) {
    const f = await fixture();
    const value =
      field === 'customer_id'
        ? f.actor
        : field === 'order_id'
          ? `other:${crypto.randomUUID()}`
          : 899;
    await db.query(`update loyalty_reservations set ${field}=$2 where id=$1`, [
      f.reservation,
      value,
    ]);
    await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
    await assert.rejects(commit(f), /checkout bonus mismatch/);
    const unchanged = await state(f);
    assert.equal(Number(unchanged.balance), 1200);
    assert.equal(Number(unchanged.entries), 0);
  }
});

test('expired insufficient reservation returns unavailable without silently spending another balance', async () => {
  const f = await fixture();
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  await db.query(
    "update loyalty_reservations set expires_at=now()-interval '1 second' where id=$1",
    [f.reservation],
  );
  await db.query('update customers set balance=0 where id=$1', [f.owner]);
  assert.equal((await commit(f)).status, 'unavailable');
  assert.equal(Number((await state(f)).balance), 0);
  assert.equal(Number((await state(f)).entries), 0);
  const unchanged = await row(
    `select o.bonus_reservation_id,r.order_id,r.status,
      (select count(*) from loyalty_reservations where customer_id=$2) as holds
    from kaspi_orders o join loyalty_reservations r on r.id=o.bonus_reservation_id where o.id=$1`,
    [f.order, f.owner],
  );
  assert.equal(unchanged.bonus_reservation_id, f.reservation);
  assert.equal(unchanged.order_id, `kaspi:${f.request}`);
  assert.equal(unchanged.status, 'active');
  assert.equal(Number(unchanged.holds), 1);
});

test('expired renewal respects other active holds instead of spending their reserved funds', async () => {
  const f = await fixture();
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  await db.query("update loyalty_reservations set status='expired' where id=$1", [f.reservation]);
  const other = await rpc('reserve_loyalty_balance($1,$2,800,400,50,1)', [
    f.owner,
    `other:${crypto.randomUUID()}`,
  ]);
  assert.equal((await commit(f)).status, 'unavailable');
  assert.equal(Number((await state(f)).balance), 1200);
  assert.equal(Number((await state(f)).entries), 0);
  assert.equal(
    (await row('select bonus_reservation_id from kaspi_orders where id=$1', [f.order]))
      .bonus_reservation_id,
    f.reservation,
  );
  assert.equal(
    (await row('select status from loyalty_reservations where id=$1', [other.reservation_id]))
      .status,
    'active',
  );
});

test('a later commit validation failure rolls back renewal, archival and the order pointer together', async () => {
  const f = await fixture();
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  await db.query("update loyalty_reservations set status='expired' where id=$1", [f.reservation]);
  await assert.rejects(
    rpc('commit_checkout_bonus($1,-1,0)', [f.order]),
    /invalid loyalty commit values/,
  );
  const unchanged = await row(
    `select o.bonus_reservation_id,o.bonus_awarded_at,r.order_id,r.original_order_id,r.status,
      (select count(*) from loyalty_reservations where customer_id=$2) as holds
    from kaspi_orders o join loyalty_reservations r on r.id=o.bonus_reservation_id where o.id=$1`,
    [f.order, f.owner],
  );
  assert.equal(unchanged.bonus_reservation_id, f.reservation);
  assert.equal(unchanged.bonus_awarded_at, null);
  assert.equal(unchanged.order_id, `kaspi:${f.request}`);
  assert.equal(unchanged.original_order_id, null);
  assert.equal(unchanged.status, 'expired');
  assert.equal(Number(unchanged.holds), 1);
  assert.equal(Number((await state(f)).balance), 1200);
  assert.equal(Number((await state(f)).entries), 0);
});

test('a renewal returning another owner, order key, discount or no reservation cannot attach or debit it', async () => {
  const actualReserve = functionSql(
    read('supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql'),
    'reserve_loyalty_balance',
  );
  for (const fault of ['customer_id', 'order_id', 'discount_amount', 'missing']) {
    const f = await fixture();
    await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
    await db.query("update loyalty_reservations set status='expired' where id=$1", [f.reservation]);
    const returnedId = crypto.randomUUID();
    if (fault !== 'missing')
      await db.query(
        `insert into loyalty_reservations(id,customer_id,order_id,order_total,discount_amount,status,expires_at)
        values($1,$2,$3,1800,$4,'active',now()+interval '1 hour')`,
        [
          returnedId,
          fault === 'customer_id' ? f.actor : f.owner,
          fault === 'order_id' ? `other:${returnedId}` : `kaspi:${f.request}:unexpected`,
          fault === 'discount_amount' ? 899 : 900,
        ],
      );
    // Fault-inject only the renewal's response. The order guard and actual
    // commit ledger stay intact and must reject the untrusted returned row.
    try {
      await db.exec(`create or replace function public.reserve_loyalty_balance(
        p_customer_id uuid,p_order_id text,p_order_total numeric,p_discount_amount numeric,
        p_max_discount_percent numeric,p_ttl_hours integer default 24
      ) returns jsonb language plpgsql security definer set search_path=public as $$
      begin
        update loyalty_reservations set original_order_id=order_id,order_id='archived:'||id::text
          where id='${f.reservation}'::uuid;
        ${fault !== 'order_id' && fault !== 'missing' ? `update loyalty_reservations set order_id=p_order_id where id='${returnedId}'::uuid;` : ''}
        return jsonb_build_object('reservation_id','${returnedId}');
      end; $$;`);
      await assert.rejects(commit(f), /checkout bonus mismatch/, fault);
      assert.equal(
        (await row('select bonus_reservation_id from kaspi_orders where id=$1', [f.order]))
          .bonus_reservation_id,
        f.reservation,
        fault,
      );
      assert.equal(
        (await row('select order_id from loyalty_reservations where id=$1', [f.reservation]))
          .order_id,
        `kaspi:${f.request}`,
        fault,
      );
      assert.equal(Number((await state(f)).balance), 1200, fault);
      assert.equal(Number((await state(f)).entries), 0, fault);
    } finally {
      await db.exec(actualReserve);
    }
  }
});

test('pending cashback activation and ordinary non-family purchases retain their ledger behavior', async () => {
  const f = await fixture({ family: false });
  await db.query("update kaspi_orders set status='paid' where id=$1", [f.order]);
  assert.equal((await commit(f, 2)).status, 'committed');
  assert.equal((await commit(f, 2)).status, 'committed');
  assert.equal(Number((await state(f)).balance), 300);
  const pending = await row(
    "select count(*) as n,sum(amount) as earned,min(available_at)>now() as future from transactions where customer_id=$1 and type='pending_deposit'",
    [f.owner],
  );
  assert.equal(Number(pending.n), 1);
  assert.equal(Number(pending.earned), 45);
  assert.equal(pending.future, true);
});

test('reapplication preserves the service-only RPC permission and not-found failure', async () => {
  for (const role of ['anon', 'authenticated', 'service_role'])
    assert.equal(
      (
        await row(
          "select has_function_privilege($1,'commit_checkout_bonus(uuid,numeric,integer)','EXECUTE') allowed",
          [role],
        )
      ).allowed,
      role === 'service_role',
    );
  await assert.rejects(
    rpc('commit_checkout_bonus($1,45,0)', [crypto.randomUUID()]),
    /order not found/,
  );
});

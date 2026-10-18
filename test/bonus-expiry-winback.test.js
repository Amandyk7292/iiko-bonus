const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const row = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await row(`select ${sql} result`, args)).result;
const realFunction = (path, name) => {
  const source = readFileSync(path, 'utf8');
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('$$;', start) + 3);
};
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create table customers(id uuid primary key,balance numeric default 0,total_spent numeric default 0,
      deleted_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now());
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,
      order_total numeric,description text,items jsonb,available_at timestamptz,activated_at timestamptz,
      expires_at timestamptz,expired_at timestamptz,created_at timestamptz default now(),timestamp timestamptz default now());
    create table loyalty_reservations(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text unique,
      original_order_id text,order_total numeric,discount_amount numeric,status text,expires_at timestamptz,
      updated_at timestamptz default now(),committed_at timestamptz,cancelled_at timestamptz);
    create table settings(key text primary key,value text);
    create table kaspi_orders(id uuid primary key default gen_random_uuid(),operation_id text,status text,
      refund_status text,amount numeric,partially_refunded_amount numeric default 0);
    insert into settings values('bonus_expiration','{"enabled":true,"auto_write_off":true,"expiration_months":6}');
    create table loyalty_faq(id uuid primary key,answer_ru text,answer_kk text);
    create function family_bonus_owner(uuid) returns uuid language sql immutable as $$select $1$$;
    create table test_winback_outbox(claim_id uuid primary key,customer_id uuid,amount numeric);
    create function queue_bonus_winback_notification(p_customer_id uuid,p_claim_id uuid,p_amount numeric default 1000)
      returns void language plpgsql as $$begin
      if exists(select 1 from settings where key='test_fail_push') then raise exception 'test push rollback'; end if;
      insert into test_winback_outbox values(p_claim_id,p_customer_id,p_amount) on conflict do nothing;
    end$$;`);
  await db.exec(realFunction('supabase_schema.sql', 'apply_loyalty_transaction'));
  await db.exec(
    realFunction(
      'supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql',
      'reserve_loyalty_balance',
    ),
  );
  await db.exec(
    realFunction('supabase/migrations/20260909180000_checkout_bonus.sql', 'quote_checkout_bonus'),
  );
  await db.exec(readFileSync('supabase/migrations/20261015110000_bonus_credit_lots.sql', 'utf8'));
  await db.exec(
    readFileSync('supabase/migrations/20261015130000_bonus_expiry_winback.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20261018101000_winback_retained_purchase.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20261018101000_winback_retained_purchase.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function customer(created = '2020-01-01T00:00:00Z') {
  const id = randomUUID();
  await db.query('insert into customers(id,created_at) values($1,$2)', [id, created]);
  return id;
}
async function credit(
  id,
  amount,
  timestamp,
  { type = 'deposit', orderTotal = null, orderId = randomUUID() } = {},
) {
  await db.transaction(async (tx) => {
    if (type !== 'pending_deposit')
      await tx.query('update customers set balance=balance+$2 where id=$1', [id, amount]);
    await tx.query(
      `insert into transactions(customer_id,order_id,type,amount,timestamp,order_total,available_at)
      values($1,$2,$3,$4,$5,$6,case when $3='pending_deposit' then now()-interval '1 second' end)`,
      [id, orderId, type, amount, timestamp, orderTotal],
    );
  });
}
const expire = (id, at = '2030-07-16T00:00:00Z') =>
  rpc('expire_bonus_credit_lots($1,$2)', [id, at]);
const balance = async (id) =>
  Number((await row('select balance from customers where id=$1', [id])).balance);
const claims = async (id) =>
  (
    await db.query(
      'select * from bonus_expiry_winback_rewards where customer_id=$1 order by granted_at',
      [id],
    )
  ).rows;

test('an actually expired portion grants 1000 exactly once after 90 days without a purchase, with ledger, lot, and durable push in one transaction', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T10:00:00+05:00', {
    orderTotal: 10000,
    orderId: 'last-purchase-' + id,
  });
  const first = await expire(id);
  assert.equal(first.expiredAmount, 500);
  assert.equal(first.winbackAmount, 1000);
  assert.equal(first.balance, 1000);
  assert.equal(await balance(id), 1000);
  assert.equal((await claims(id)).length, 1);
  assert.equal(
    (await row('select count(*) n from test_winback_outbox where customer_id=$1', [id])).n,
    1,
  );
  const gift = await row(
    "select * from transactions where customer_id=$1 and order_id like 'WINBACK-%'",
    [id],
  );
  assert.equal(gift.type, 'manual_deposit');
  assert.equal(Number(gift.amount), 1000);
  const lot = await row('select * from bonus_credit_lots where source_transaction_id=$1', [
    gift.id,
  ]);
  assert.equal(new Date(lot.expires_at).toISOString(), '2031-01-16T00:00:00.000Z');
  for (let attempt = 0; attempt < 3; attempt++) assert.equal((await expire(id)).winbackAmount, 0);
  assert.equal((await claims(id)).length, 1);
});

test('the return gift expiring six months later cannot repeatedly renew itself', async () => {
  const id = await customer();
  await credit(id, 200, '2030-01-15T10:00:00+05:00', { orderTotal: 1000 });
  assert.equal((await expire(id)).winbackAmount, 1000);
  const later = await expire(id, '2031-01-17T00:00:00Z');
  assert.equal(later.expiredAmount, 1000);
  assert.equal(later.winbackAmount, 0);
  assert.equal(await balance(id), 0);
  assert.equal((await claims(id)).length, 1);
  assert.equal(
    Number((await row('select count(*) n from test_winback_outbox where customer_id=$1', [id])).n),
    1,
  );
});

test('only a new real purchase re-arms a later absence cycle; its own gift, manual credits, refunds and old pending activation do not', async () => {
  const id = await customer();
  await credit(id, 100, '2030-01-15T00:00:00Z', {
    orderTotal: 1000,
    orderId: 'purchase-one-' + id,
  });
  assert.equal((await expire(id)).winbackAmount, 1000);
  await credit(id, 10, '2030-08-01T00:00:00Z', { orderTotal: 500, orderId: 'purchase-two-' + id });
  const second = await expire(id, '2031-02-02T00:00:00Z');
  assert.equal(second.expiredAmount, 1010);
  assert.equal(second.winbackAmount, 1000);
  assert.equal((await claims(id)).length, 2);
  assert.notEqual((await claims(id))[0].cycle_key, (await claims(id))[1].cycle_key);
  assert.equal((await expire(id, '2031-08-03T00:00:00Z')).winbackAmount, 0);
  assert.equal(await balance(id), 0);
});

test('a recent real purchase blocks a gift even if an old portion expires', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T00:00:00Z', { orderTotal: 1000 });
  await credit(id, 20, '2030-07-01T00:00:00Z', { orderTotal: 500 });
  const result = await expire(id);
  assert.equal(result.expiredAmount, 500);
  assert.equal(result.winbackAmount, 0);
  assert.equal(await balance(id), 20);
  assert.equal((await claims(id)).length, 0);
});

test('an unused portion expiring before day 90 qualifies a gift later without requiring another expiry', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T00:00:00Z', { orderTotal: 1000 });
  await credit(id, 20, '2030-07-01T00:00:00Z', { orderTotal: 500 });
  assert.equal((await expire(id)).expiredAmount, 500);
  assert.equal((await expire(id, '2030-09-28T23:59:59Z')).winbackAmount, 0);
  const batch = await rpc('expire_due_bonus_credit_lots(1000,$1)', ['2030-09-29T00:00:00Z']);
  assert.ok(batch.winbackCustomerIds.includes(id));
  assert.equal(await balance(id), 1020);
  assert.equal((await claims(id)).length, 1);
  assert.equal(Number((await claims(id))[0].expiration_amount), 500);
  assert.equal((await expire(id, '2030-10-01T00:00:00Z')).winbackAmount, 0);
});

test('a new purchase cancels an earlier unearned expiry qualification and requires a new actual expiry', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T00:00:00Z', { orderTotal: 1000 });
  await credit(id, 20, '2030-07-01T00:00:00Z', { orderTotal: 500 });
  await expire(id);
  await credit(id, 10, '2030-08-01T00:00:00Z', { orderTotal: 1000 });
  const batch = await rpc('expire_due_bonus_credit_lots(1000,$1)', ['2030-10-31T00:00:00Z']);
  assert.ok(!batch.winbackCustomerIds.includes(id));
  assert.equal((await claims(id)).length, 0);
  assert.ok(
    (
      await row(
        'select cancelled_at from bonus_expiry_winback_qualifications where customer_id=$1',
        [id],
      )
    ).cancelled_at,
  );
  const later = await expire(id, '2031-01-02T00:00:00Z');
  assert.equal(later.expiredAmount, 20);
  assert.equal(later.winbackAmount, 1000);
  assert.equal((await claims(id)).length, 1);
});

test('the zero-purchase cycle grants once for old accounts, but not for new accounts or informational ledger events', async () => {
  const id = await customer();
  await credit(id, 100, '2030-01-01T00:00:00Z', { type: 'manual_deposit' });
  assert.equal((await expire(id)).winbackAmount, 1000);
  assert.equal((await claims(id))[0].cycle_key, 'initial');
  await credit(id, 200, '2030-02-01T00:00:00Z', { type: 'manual_deposit' });
  assert.equal((await expire(id, '2030-08-02T00:00:00Z')).winbackAmount, 0);
  assert.equal((await claims(id)).length, 1);
  const fresh = await customer('2030-07-01T00:00:00Z');
  await credit(fresh, 100, '2030-01-01T00:00:00Z', { type: 'manual_deposit' });
  assert.equal((await expire(fresh)).winbackAmount, 0);
});

test('unspent money protected by a reservation cannot grant a gift until a portion actually burns', async () => {
  const id = await customer();
  await credit(id, 100, '2030-01-01T00:00:00Z', { orderTotal: 1000 });
  await db.query(
    "insert into loyalty_reservations(customer_id,order_id,discount_amount,status,expires_at) values($1,$2,100,'active','infinity')",
    [id, randomUUID()],
  );
  assert.equal((await expire(id)).expiredAmount, 0);
  assert.equal((await expire(id)).winbackAmount, 0);
  assert.equal((await claims(id)).length, 0);
  await db.query("update loyalty_reservations set status='cancelled' where customer_id=$1", [id]);
  assert.equal((await expire(id)).winbackAmount, 1000);
});

test('late activation never changes the real purchase inactivity clock', async () => {
  const id = await customer();
  const oldPurchaseAt = (await row("select now()-interval '100 days' as value")).value;
  const oldBonusAt = (await row("select now()-interval '7 months' as value")).value;
  await credit(id, 50, oldBonusAt, { type: 'manual_deposit' });
  await credit(id, 25, oldPurchaseAt, { type: 'pending_deposit', orderTotal: 500 });
  await rpc('activate_pending_bonus_transactions()');
  const result = await rpc('expire_bonus_credit_lots($1)', [id]);
  assert.equal(result.expiredAmount, 50);
  assert.equal(result.winbackAmount, 1000);
  assert.equal(await balance(id), 1025);
});

test('a push-queue failure rolls back expiry, gift, claim and ledger together; retry then credits only once', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-01T00:00:00Z', { orderTotal: 1000 });
  await db.query("insert into settings values('test_fail_push','true')");
  try {
    await assert.rejects(expire(id), /test push rollback/);
    assert.equal(await balance(id), 500);
    assert.equal((await claims(id)).length, 0);
    assert.equal(
      Number(
        (
          await row(
            "select count(*) n from transactions where customer_id=$1 and type='expiration'",
            [id],
          )
        ).n,
      ),
      0,
    );
  } finally {
    await db.query("delete from settings where key='test_fail_push'");
  }
  assert.equal((await expire(id)).winbackAmount, 1000);
  assert.equal((await claims(id)).length, 1);
});

test('batch and lazy summaries expose win-back results for wallet/realtime synchronization', async () => {
  const id = await customer();
  await credit(id, 25, '2020-01-01T00:00:00Z', { orderTotal: 1000 });
  const batch = await rpc('expire_due_bonus_credit_lots(200)');
  assert.ok(batch.customerIds.includes(id));
  assert.ok(batch.winbackCustomerIds.includes(id));
  assert.ok(batch.winbackCount >= 1);
  assert.equal(batch.totalWinbackAmount, batch.winbackCount * 1000);
  const lazy = await customer();
  await credit(lazy, 15, '2020-01-01T00:00:00Z', { orderTotal: 1000 });
  const summary = await rpc('bonus_expiry_summary($1)', [lazy]);
  assert.equal(summary.expiredAmount, 15);
  assert.equal(summary.winbackAmount, 1000);
  assert.equal(summary.currentBalance, 1000);
});

test('clients and service_role cannot mint gifts through the internal grant or bypass its guarded expiry wrapper', async () => {
  for (const role of ['anon', 'authenticated', 'service_role'])
    for (const signature of [
      'grant_bonus_expiry_winback(uuid,numeric,timestamptz)',
      'expire_bonus_credit_lots_before_winback(uuid,timestamptz)',
    ])
      assert.equal(
        (await row("select has_function_privilege($1,$2,'execute') allowed", [role, signature]))
          .allowed,
        false,
      );
});

test('a fully refunded online purchase and a reversed POS sale cannot re-arm the previous absence gift', async () => {
  for (const online of [false, true]) {
    const id = await customer();
    const original = `retained-${id}`;
    await credit(id, 500, '2030-01-01T00:00:00Z', { orderTotal: 1000, orderId: original });
    assert.equal((await expire(id, '2030-07-02T00:00:00Z')).winbackAmount, 1000);
    const operation = randomUUID();
    const returned = online ? `kaspi:${operation}` : `bp1:returned-${operation}`;
    await credit(id, 50, '2030-08-01T00:00:00Z', { orderTotal: 1000, orderId: returned });
    if (online) {
      // State alone is authoritative even if loyalty reversal has not finished.
      await db.query(
        "insert into kaspi_orders(operation_id,status,refund_status,amount) values($1,'refunded','succeeded',1000)",
        [operation],
      );
    } else {
      await db.query(
        "insert into transactions(customer_id,order_id,type,amount,order_total,timestamp) values($1,$2,'refund_reversal',50,1000,'2030-08-02')",
        [id, `${returned}:refund`],
      );
    }
    const expired = await expire(id, '2031-02-02T00:00:00Z');
    assert.equal(expired.winbackAmount, 0);
    assert.equal((await claims(id)).length, 1);
    assert.equal((await claims(id))[0].cycle_key, `purchase:${original}`);
  }
});

test('a recent full refund does not postpone the retained purchase inactivity clock, while partial purchases still count', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-01T00:00:00Z', { orderTotal: 1000, orderId: `old-${id}` });
  const operation = randomUUID();
  await credit(id, 50, '2030-07-01T00:00:00Z', { orderTotal: 1000, orderId: `kaspi:${operation}` });
  await db.query(
    "insert into kaspi_orders(operation_id,status,refund_status,amount) values($1,'refunded','succeeded',1000)",
    [operation],
  );
  assert.equal((await expire(id)).winbackAmount, 1000);
  assert.equal((await claims(id))[0].cycle_key, `purchase:old-${id}`);

  const partialId = await customer();
  const partialOp = randomUUID();
  await credit(partialId, 500, '2030-01-01T00:00:00Z', {
    orderTotal: 1000,
    orderId: `kaspi:${partialOp}`,
  });
  await db.query(
    "insert into kaspi_orders(operation_id,status,refund_status,amount,partially_refunded_amount) values($1,'paid','partial',1000,500)",
    [partialOp],
  );
  assert.equal((await expire(partialId)).winbackAmount, 1000);
  assert.equal((await claims(partialId))[0].cycle_key, `purchase:kaspi:${partialOp}`);
});

test('refund of the purchase behind an already granted gift cannot open an older or initial cycle', async () => {
  const id = await customer();
  const operation = randomUUID();
  await credit(id, 500, '2030-01-01T00:00:00Z', {
    orderTotal: 1000,
    orderId: `kaspi:${operation}`,
  });
  await db.query("insert into kaspi_orders(operation_id,status,amount) values($1,'paid',1000)", [
    operation,
  ]);
  assert.equal((await expire(id)).winbackAmount, 1000);
  await db.query(
    "update kaspi_orders set status='refunded',refund_status='succeeded' where operation_id=$1",
    [operation],
  );
  assert.equal((await expire(id, '2031-01-17T00:00:00Z')).winbackAmount, 0);
  assert.equal((await claims(id)).length, 1);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const migration = readFileSync('supabase/migrations/20261015110000_bonus_credit_lots.sql', 'utf8');
const legacyKnown = randomUUID();
const legacyUnknown = randomUUID();
const legacyReversal = randomUUID();
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
    insert into settings values('bonus_expiration','{"enabled":true,"auto_write_off":true,"expiration_months":6}');
    create table loyalty_faq(id uuid primary key,answer_ru text,answer_kk text);
    insert into loyalty_faq values('fa010000-0000-4000-8000-000000000005',
      'В программе может действовать срок хранения бонусов и автоматическое списание при отсутствии активности. Старый текст.','Ескі мәтін');
    create function family_bonus_owner(uuid) returns uuid language sql immutable as $$select $1$$;`);
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
  await db.exec(
    realFunction(
      'supabase/migrations/20260713190000_order_fulfillment.sql',
      'commit_loyalty_reservation',
    ),
  );
  await db.query('insert into customers(id,balance) values($1,700),($2,123)', [
    legacyKnown,
    legacyUnknown,
  ]);
  await db.query(
    `insert into transactions(customer_id,order_id,type,amount,timestamp) values
      ($1,'oldcredit','deposit',900,now()-interval '9 months'),
      ($1,'spending','withdrawal',200,now()-interval '8 months')`,
    [legacyKnown],
  );
  await db.query('insert into customers(id,balance) values($1,650)', [legacyReversal]);
  await db.query(
    `insert into transactions(customer_id,order_id,type,amount,timestamp) values
      ($1,'earlier','deposit',500,now()-interval '9 months'),
      ($1,'later','deposit',200,now()-interval '1 month'),
      ($1,'reversal-including-unrecovered','refund_reversal',500,now())`,
    [legacyReversal],
  );
  await db.exec(migration);
});
test.after(() => db.close());

async function customer() {
  const id = randomUUID();
  await db.query('insert into customers(id) values($1)', [id]);
  return id;
}
async function credit(id, amount, timestamp, { type = 'deposit', orderId = randomUUID() } = {}) {
  const transactionId = randomUUID();
  await db.transaction(async (tx) => {
    if (type !== 'pending_deposit')
      await tx.query('update customers set balance=balance+$2 where id=$1', [id, amount]);
    await tx.query(
      `insert into transactions(id,customer_id,order_id,type,amount,timestamp,available_at)
      values($1,$2,$3,$4,$5,$6,case when $4='pending_deposit' then now()-interval '1 second' end)`,
      [transactionId, id, orderId, type, amount, timestamp],
    );
  });
  return transactionId;
}
const lots = async (id) =>
  (
    await db.query('select * from bonus_credit_lots where customer_id=$1 order by expires_at,id', [
      id,
    ])
  ).rows;
const balance = async (id) =>
  Number((await row('select balance from customers where id=$1', [id])).balance);
const amount = (value) => Number(value);
const iso = (value) => new Date(value).toISOString();
async function spend(id, spent, earned = 0, order = randomUUID()) {
  return rpc(
    'apply_loyalty_transaction($1,$2,$3::numeric,$4,1000,1000::numeric-$3::numeric,0,null)',
    [id, order, spent, earned],
  );
}

test('backfill preserves the balance, grants known overdue portions notice, and dates unknown opening money conservatively', async () => {
  const known = await lots(legacyKnown);
  assert.equal(known.length, 1);
  assert.equal(amount(known[0].remaining_amount), 700);
  assert.equal(await balance(legacyKnown), 700);
  assert.equal(
    Number(
      (
        await row(
          'select sum(a.amount) n from bonus_lot_allocations a join transactions t on t.id=a.debit_transaction_id where t.customer_id=$1',
          [legacyKnown],
        )
      ).n,
    ),
    200,
  );
  const now = new Date((await row('select now() value')).value).getTime();
  assert.ok(Math.abs(Date.parse(known[0].expires_at) - now - 31 * 86400000) < 3000);
  const unknown = await lots(legacyUnknown);
  assert.equal(unknown.length, 1);
  assert.equal(unknown[0].source_kind, 'opening_balance');
  assert.equal(amount(unknown[0].remaining_amount), 123);
  assert.equal(
    iso(unknown[0].expires_at),
    iso(await rpc('bonus_six_month_expiry($1)', [unknown[0].credited_at])),
  );
  assert.match((await row('select answer_ru from loyalty_faq')).answer_ru, /6 календарных месяцев/);
  const reconciled = await lots(legacyReversal);
  assert.deepEqual(
    reconciled.map((lot) => amount(lot.remaining_amount)),
    [450, 200],
  );
  assert.equal(
    reconciled.some((lot) => lot.source_kind === 'opening_balance'),
    false,
  );
});

test('an informational credit ledger row without an actual balance credit creates no spendable money', async () => {
  const id = await customer();
  await db.query(
    "insert into transactions(customer_id,order_id,type,amount) values($1,'not-credited','deposit',900)",
    [id],
  );
  assert.equal(await balance(id), 0);
  assert.equal(
    (await lots(id)).reduce((total, lot) => total + amount(lot.remaining_amount), 0),
    0,
  );
  const funded = await customer();
  const original = await credit(funded, 500, '2030-01-01T00:00:00Z');
  await db.query(
    "insert into transactions(customer_id,order_id,type,amount) values($1,'not-credited-on-existing-money','deposit',900)",
    [funded],
  );
  assert.equal(await balance(funded), 500);
  assert.equal(
    amount(
      (
        await row('select remaining_amount from bonus_credit_lots where source_transaction_id=$1', [
          original,
        ])
      ).remaining_amount,
    ),
    500,
  );
  assert.equal((await lots(funded)).filter((lot) => amount(lot.remaining_amount) > 0).length, 1);
});

test('six calendar months clips month ends and preserves Kazakhstan wall-clock time, including leap years', async () => {
  for (const [from, to] of [
    ['2026-08-31T23:59:59+05:00', '2027-02-28T23:59:59+05:00'],
    ['2027-08-31T09:30:00+05:00', '2028-02-29T09:30:00+05:00'],
    ['2030-01-15T12:34:56+05:00', '2030-07-15T12:34:56+05:00'],
  ])
    assert.equal(iso(await rpc('bonus_six_month_expiry($1)', [from])), iso(to));
});

test('January 500 and March 200 expire separately in July and September; a later reward never renews January', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T10:00:00+05:00');
  await credit(id, 200, '2030-03-15T10:00:00+05:00');
  const before = await lots(id);
  assert.equal(iso(before[0].expires_at), '2030-07-15T05:00:00.000Z');
  assert.equal(iso(before[1].expires_at), '2030-09-15T05:00:00.000Z');
  const result = await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-15T10:00:00+05:00']);
  assert.equal(result.expiredAmount, 500);
  assert.equal(await balance(id), 200);
  assert.equal((await lots(id))[1].remaining_amount, '200.00');
  const repeat = await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-15T10:00:00+05:00']);
  assert.equal(repeat.expiredAmount, 0);
  assert.equal(
    Number(
      (
        await row("select count(*) from transactions where customer_id=$1 and type='expiration'", [
          id,
        ])
      ).count,
    ),
    1,
  );
});

test('spending consumes the earliest expiry first and only that unused remainder later expires', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T10:00:00+05:00');
  await credit(id, 200, '2030-03-15T10:00:00+05:00');
  await spend(id, 240);
  assert.deepEqual(
    (await lots(id)).map((lot) => amount(lot.remaining_amount)),
    [260, 200],
  );
  const result = await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-16T00:00:00+05:00']);
  assert.equal(result.expiredAmount, 260);
  assert.equal(await balance(id), 200);
});

test('pending credits have no spendable lot, and their six-month clock starts once at actual activation', async () => {
  const id = await customer();
  const txId = await credit(id, 50, '2020-01-01T00:00:00Z', { type: 'pending_deposit' });
  assert.equal((await lots(id)).length, 0);
  assert.equal(await balance(id), 0);
  const activated = await rpc('activate_pending_bonus_transactions()');
  assert.equal(activated.activated_count, 1);
  assert.equal(await balance(id), 50);
  const pending = await row('select * from transactions where id=$1', [txId]);
  const created = (await lots(id))[0];
  assert.equal(iso(created.credited_at), iso(pending.activated_at));
  assert.equal(
    iso(created.expires_at),
    iso(await rpc('bonus_six_month_expiry($1)', [pending.activated_at])),
  );
  assert.equal((await rpc('activate_pending_bonus_transactions()')).activated_count, 0);
  assert.equal((await lots(id)).length, 1);
});

test('a spend with equal or larger immediate cashback still consumes its full earlier portion', async () => {
  for (const cashback of [100, 200]) {
    const id = await customer();
    await credit(id, 500, (await row("select now()-interval '1 month' value")).value);
    await spend(id, 100, cashback);
    const created = await lots(id);
    const original = created.find((lot) => amount(lot.original_amount) === 500);
    assert.equal(amount(original.remaining_amount), 400);
    assert.equal(await balance(id), 400 + cashback);
    assert.equal(
      created.reduce((sum, lot) => sum + amount(lot.remaining_amount), 0),
      await balance(id),
    );
    assert.equal(
      Number(
        (
          await row(
            "select sum(allocated_amount) n from bonus_lot_movements where customer_id=$1 and kind='withdrawal'",
            [id],
          )
        ).n,
      ),
      100,
    );
  }
});

test('a reversal ledger can exceed the actual removed cashback without consuming or renewing unrelated money', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T10:00:00+05:00');
  await credit(id, 200, '2030-03-15T10:00:00+05:00');
  await db.transaction(async (tx) => {
    await tx.query('update customers set balance=balance-50 where id=$1', [id]);
    await tx.query(
      "insert into transactions(customer_id,order_id,type,amount) values($1,'refund-large','refund_reversal',500)",
      [id],
    );
  });
  assert.deepEqual(
    (await lots(id)).map((lot) => amount(lot.remaining_amount)),
    [450, 200],
  );
  assert.equal(await balance(id), 650);
  assert.equal((await lots(id)).length, 2);
});

test('refunding spent bonuses restores the original portions and original expiry rather than giving a new lifetime', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T10:00:00+05:00');
  await credit(id, 200, '2030-03-15T10:00:00+05:00');
  const order = 'purchase-' + randomUUID();
  await spend(id, 550, 0, order);
  await credit(id, 550, '2030-06-15T10:00:00+05:00', {
    type: 'refund_bonus_restore',
    orderId: order + ':refund:' + randomUUID() + ':restore',
  });
  const restored = (await lots(id)).filter((lot) => lot.restored_from_lot_id);
  assert.equal(restored.length, 2);
  assert.deepEqual(
    restored.map((lot) => amount(lot.remaining_amount)),
    [500, 50],
  );
  assert.deepEqual(
    restored.map((lot) => iso(lot.expires_at)),
    ['2030-07-15T05:00:00.000Z', '2030-09-15T05:00:00.000Z'],
  );
  assert.equal(
    (await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-16T00:00:00Z'])).expiredAmount,
    500,
  );
  assert.equal(await balance(id), 200);
});

test('expiration protects live reservations, then expires the unspent remainder when a hold is released', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T10:00:00+05:00');
  await credit(id, 200, '2030-03-15T10:00:00+05:00');
  await db.query(
    "insert into loyalty_reservations(customer_id,order_id,discount_amount,status,expires_at) values($1,$2,500,'active','infinity')",
    [id, randomUUID()],
  );
  assert.equal(
    (await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-16T00:00:00Z'])).expiredAmount,
    200,
  );
  assert.equal(await balance(id), 500);
  assert.equal(
    (await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-16T00:00:00Z'])).expiredAmount,
    0,
  );
  await db.query("update loyalty_reservations set status='cancelled' where customer_id=$1", [id]);
  assert.equal(
    (await rpc('expire_bonus_credit_lots($1,$2)', [id, '2030-07-16T00:00:00Z'])).expiredAmount,
    300,
  );
  assert.equal(await balance(id), 200);
});

test('checkout quote and financial spending lazily expire due portions before a delayed worker can run', async () => {
  const id = await customer();
  await credit(id, 500, '2020-01-15T00:00:00Z');
  await credit(id, 200, '2030-03-15T00:00:00Z');
  assert.equal((await rpc('quote_checkout_bonus($1,1000)', [id])).available, 200);
  assert.equal(await balance(id), 200);
  await assert.rejects(spend(id, 201), /insufficient balance/);
  const second = await customer();
  await credit(second, 500, '2020-01-15T00:00:00Z');
  await credit(second, 200, '2030-03-15T00:00:00Z');
  await assert.rejects(
    rpc('reserve_loyalty_balance($1,$2,1000,201,100,24)', [second, randomUUID()]),
    /discount exceeds available reserved balance/,
  );
  await rpc('reserve_loyalty_balance($1,$2,1000,200,100,24)', [second, randomUUID()]);
  assert.equal(await balance(second), 200);
});

test('forecast groups only unused portions, returns nearest amount, and uses the local calendar day', async () => {
  const id = await customer();
  await credit(id, 500, '2030-01-15T01:00:00+05:00');
  await credit(id, 200, '2030-01-15T18:00:00+05:00');
  const summary = await rpc('bonus_expiry_summary($1,30,$2)', [id, '2030-07-08T10:00:00+05:00']);
  assert.equal(summary.currentBalance, 700);
  assert.equal(summary.totalExpiring, 700);
  assert.equal(summary.nextExpiryAmount, 700);
  assert.equal(summary.buckets.length, 1);
  assert.equal(summary.buckets[0].daysRemaining, 7);
  assert.equal(summary.expirationMonths, 6);
  const forecasts = (
    await db.query('select * from bonus_expiry_customer_forecasts($1,$2)', [
      [id],
      '2030-07-08T10:00:00+05:00',
    ])
  ).rows;
  assert.equal(forecasts.length, 1);
  assert.equal(amount(forecasts[0].expiring_amount), 700);
});

test('batch expiration is bounded, retry-safe, and ignores deleted customers', async () => {
  const a = await customer();
  const b = await customer();
  const deleted = await customer();
  for (const id of [a, b, deleted]) await credit(id, 25, '2020-01-01T00:00:00Z');
  await db.query('update customers set deleted_at=now() where id=$1', [deleted]);
  let result;
  let loops = 0;
  do {
    result = await rpc('expire_due_bonus_credit_lots(1)');
    assert.ok(result.expiredCount <= 1);
    assert.ok(++loops < 30);
  } while (result.hasMore);
  assert.equal(await balance(a), 0);
  assert.equal(await balance(b), 0);
  assert.equal(await balance(deleted), 25);
  assert.equal((await rpc('expire_due_bonus_credit_lots(200)')).expiredCount, 0);
});

test('disabled policy blocks write-off and forecasts; old inactivity RPCs always fail closed', async () => {
  const id = await customer();
  await credit(id, 100, '2020-01-01T00:00:00Z');
  await db.query("update settings set value=$1 where key='bonus_expiration'", [
    '{"enabled":false,"auto_write_off":true}',
  ]);
  try {
    assert.equal(await rpc('bonus_expiry_policy_enabled()'), false);
    assert.equal((await rpc('expire_bonus_credit_lots($1)', [id])).expiredAmount, 0);
    assert.equal((await rpc('bonus_expiry_summary($1)', [id])).totalExpiring, 0);
    assert.equal((await rpc('expire_due_bonus_credit_lots()')).hasMore, false);
    assert.equal(await balance(id), 100);
    assert.equal(await rpc("expire_customer_bonus($1,100,'old')", [id]), '0');
    assert.equal(await rpc("expire_customer_bonus($1,100,'old',now())", [id]), '0');
  } finally {
    await db.query("update settings set value=$1 where key='bonus_expiration'", [
      '{"enabled":true,"auto_write_off":true,"expiration_months":6}',
    ]);
  }
});

test('customer roles cannot access financial lots, expiry RPCs, or the old unguarded financial bodies', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const signature of [
      'expire_bonus_credit_lots(uuid,timestamptz)',
      'expire_due_bonus_credit_lots(integer,timestamptz)',
      'bonus_expiry_summary(uuid,integer,timestamptz)',
      'bonus_expiry_customer_forecasts(uuid[],timestamptz)',
      'consume_bonus_credit_lots(uuid,numeric,uuid,text)',
      'apply_loyalty_transaction_before_credit_lots(uuid,text,numeric,numeric,numeric,numeric,integer,jsonb)',
    ])
      assert.equal(
        (await row("select has_function_privilege($1,$2,'execute') allowed", [role, signature]))
          .allowed,
        false,
      );
    for (const table of ['bonus_credit_lots', 'bonus_lot_movements', 'bonus_lot_allocations'])
      assert.equal(
        (await row("select has_table_privilege($1,$2,'select') allowed", [role, table])).allowed,
        false,
      );
  }
  assert.equal(
    (
      await row(
        "select has_function_privilege('service_role','expire_due_bonus_credit_lots(integer,timestamptz)','execute') allowed",
      )
    ).allowed,
    true,
  );
  assert.equal(
    (
      await row(
        "select has_function_privilege('service_role','apply_loyalty_transaction_before_credit_lots(uuid,text,numeric,numeric,numeric,numeric,integer,jsonb)','execute') allowed",
      )
    ).allowed,
    false,
  );
});

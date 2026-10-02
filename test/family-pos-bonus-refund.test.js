const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const read = (path) => fs.readFileSync(path, 'utf8');
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`select ${sql} as r`, args)).r;
const functionSql = (source, name) => {
  const start = source.indexOf(`create or replace function public.${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('\n$$;', start) + 4);
};
const fingerprint = 'b'.repeat(64);
const passwordHash = bcrypt.hashSync('Child2026', 4);
const keyFor = (branch, order) =>
  `bp1:${branch}:${crypto.createHash('sha256').update(`${branch}\0${order}`).digest('hex')}`;

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,name text,phone text,deleted_at timestamptz,
      balance numeric default 0,total_spent numeric default 0,preferred_language text default 'ru',
      created_at timestamptz default now(),updated_at timestamptz default now());
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid,order_id text,
      type text,amount numeric,order_total numeric,description text,items jsonb,branch_id uuid,
      available_at timestamptz,activated_at timestamptz,created_at timestamptz default now(),timestamp timestamptz default now());
    create table bulka_locations(id uuid primary key,active boolean default true,name text);
    create table customer_notifications(id uuid primary key,customer_id uuid,title text,body text,type text,payload jsonb);
    create table kaspi_orders(id uuid primary key,customer_id uuid,payment_method text,order_kind text default 'product',
      status text default 'pending',fulfillment_status text default 'pending',amount numeric,provider_status text,
      payment_reconciled_at timestamptz,updated_at timestamptz default now());
    create table iiko_operation_logs(branch_id uuid,created_at timestamptz);`);
  await db.exec(functionSql(read('supabase_schema.sql'), 'apply_loyalty_transaction'));
  const fulfillment = read('supabase/migrations/20260713190000_order_fulfillment.sql');
  const end =
    fulfillment.indexOf(
      ';',
      fulfillment.indexOf('grant execute on function public.cancel_loyalty_reservation'),
    ) + 1;
  await db.exec(
    fulfillment.slice(
      fulfillment.indexOf('create table if not exists public.loyalty_reservations'),
      end,
    ),
  );
  const scoped = read('supabase/migrations/20260810110000_backend_rbac_financial_hardening.sql');
  await db.exec(scoped.slice(0, scoped.indexOf('alter table public.gift_cards')));
  for (const migration of [
    '20260910190000_loyalty_retry_after_cancel.sql',
    '20260912090000_personal_account.sql',
    '20260924010000_personal_account_pos.sql',
    '20260924050000_personal_pos_terminal_state.sql',
    '20260924160000_personal_pos_notice_amount.sql',
    '20261002170000_customer_family.sql',
    '20261002171000_family_pos_wallet.sql',
    '20261002172600_family_pos_bonus_refund.sql',
    '20261002172600_family_pos_bonus_refund.sql',
  ])
    await db.exec(read(`supabase/migrations/${migration}`));
});
test.after(() => db.close());

async function fixture({ bonusBalance = 0 } = {}) {
  const f = {
    owner: crypto.randomUUID(),
    branch: crypto.randomUUID(),
    order: crypto.randomUUID(),
    payment: crypto.randomUUID(),
    request: crypto.randomUUID(),
    transaction: crypto.randomUUID(),
    amount: 40000,
  };
  await db.query(
    "insert into customers(id,name,phone,balance) values($1,'Parent','77000000001',$2)",
    [f.owner, bonusBalance],
  );
  await db.query("insert into bulka_locations(id,name) values($1,'Bulka')", [f.branch]);
  await db.query('insert into personal_accounts(customer_id,balance_minor) values($1,100000)', [
    f.owner,
  ]);
  f.member = (
    await rpc('family_create_child($1,$2,$3,$4,$5,100000)', [
      f.owner,
      'Child',
      `kid_${crypto.randomUUID().replaceAll('-', '').slice(0, 20)}`,
      'child@example.com',
      passwordHash,
    ])
  ).memberId;
  f.key = keyFor(f.branch, f.order);
  assert.equal(
    (await one('select family_pos_bonus_order_key($1,$2) key', [f.branch, f.order])).key,
    f.key,
  );
  assert.equal(
    (
      await rpc('family_pos_start($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)', [
        f.payment,
        f.request,
        f.member,
        new Date(Date.now() + 240000).toISOString(),
        f.branch,
        f.order,
        f.amount,
        fingerprint,
        'a'.repeat(64),
        crypto.randomUUID(),
      ])
    ).status,
    'authorized',
  );
  return f;
}
async function action(f, action, overrides = {}) {
  return rpc('personal_account_pos_action($1,$2,$3,$4,$5,$6,null,$7)', [
    f.payment,
    overrides.branch || f.branch,
    f.order,
    overrides.amount || f.amount,
    fingerprint,
    action,
    overrides.transaction || f.transaction,
  ]);
}
async function reserve(f, overrides = {}) {
  return rpc(
    'reserve_branch_loyalty_balance($1,$2,$3,$4,$5,50,24,1000000,500000,10000,10000000,10000000)',
    [
      overrides.branch || f.branch,
      overrides.customer || f.owner,
      f.key,
      overrides.total ?? f.amount / 100,
      overrides.discount ?? 0,
    ],
  );
}
async function commit(f, reservation, { delay = 0, customer = f.owner, branch = f.branch } = {}) {
  return rpc(
    'commit_branch_loyalty_reservation($1,$2,$3,$4,$5,20,$6,$7,1000000,500000,100000,10000000)',
    [
      branch,
      customer,
      f.key,
      reservation.reservation_id,
      f.amount / 100,
      delay,
      JSON.stringify([
        {
          productId: 'bread',
          productName: 'Bread',
          amount: 1,
          price: f.amount / 100,
          total: f.amount / 100,
        },
      ]),
    ],
  );
}
async function balances(f) {
  const state = await one(
    'select c.balance,c.total_spent,a.balance_minor from customers c join personal_accounts a on a.customer_id=c.id where c.id=$1',
    [f.owner],
  );
  return {
    bonus: Number(state.balance),
    spent: Number(state.total_spent),
    wallet: Number(state.balance_minor),
  };
}

test('paid family receipt earns, then atomic refund reverses personal money and cashback once', async () => {
  const f = await fixture();
  assert.equal((await action(f, 'pay')).status, 'paid');
  const reservation = await reserve(f);
  assert.equal((await commit(f, reservation)).duplicate, false);
  assert.deepEqual(await balances(f), { bonus: 20, spent: 400, wallet: 60000 });
  const refunded = await action(f, 'refund');
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.familyBonusCustomerId, f.owner);
  assert.equal(refunded.familyBonusRefund.earnedBonusReversed, 20);
  assert.equal(refunded.familyBonusRefund.activeBonusRemoved, 20);
  assert.equal(refunded.familyBonusRefund.realMoneyReversed, 400);
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
  assert.equal((await action(f, 'refund')).familyBonusRefund.duplicate, true);
  assert.equal((await action(f, 'status')).familyBonusRefund.duplicate, true);
  assert.equal((await reserve(f)).status, 'family_refunded');
  const late = await commit(f, reservation);
  assert.equal(late.status, 'family_refunded');
  assert.equal(late.earned_bonus, 0);
  assert.equal(late.duplicate, true);
  assert.equal(
    Number(
      (
        await one(
          "select count(*) n from transactions where customer_id=$1 and type='refund_reversal'",
          [f.owner],
        )
      ).n,
    ),
    1,
  );
  assert.equal(
    Number(
      (await one('select count(*) n from personal_account_entries where customer_id=$1', [f.owner]))
        .n,
    ),
    2,
  );
});

test('refund before any accrual permanently acknowledges queued earnings without fabricating a completed earning', async () => {
  const f = await fixture();
  await action(f, 'pay');
  const refunded = await action(f, 'refund');
  assert.equal(refunded.familyBonusRefund.applied, false);
  assert.equal(refunded.familyBonusRefund.earnedBonusReversed, 0);
  for (let retry = 0; retry < 3; retry++) {
    const skipped = await reserve(f);
    assert.equal(skipped.status, 'family_refunded');
    assert.equal(skipped.customer_id, f.owner);
    assert.equal(skipped.earned_bonus, 0);
    assert.equal(skipped.discount_applied, 0);
  }
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
  assert.equal(
    Number(
      (
        await one(
          "select count(*) n from transactions where customer_id=$1 and type in ('deposit','pending_deposit','order')",
          [f.owner],
        )
      ).n,
    ),
    0,
  );
});

test('refund between reservation and commit cancels that receipt while blocking a delayed commit', async () => {
  const f = await fixture();
  await action(f, 'pay');
  const reservation = await reserve(f);
  await action(f, 'refund');
  assert.equal(
    (await one('select status from loyalty_reservations where id=$1', [reservation.reservation_id]))
      .status,
    'cancelled',
  );
  assert.equal((await commit(f, reservation)).status, 'family_refunded');
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
});

test('pending family cashback is cancelled before activation while the full wallet refund succeeds', async () => {
  const f = await fixture();
  await action(f, 'pay');
  await commit(f, await reserve(f), { delay: 3 });
  assert.deepEqual(await balances(f), { bonus: 0, spent: 400, wallet: 60000 });
  const refunded = await action(f, 'refund');
  assert.equal(refunded.familyBonusRefund.pendingBonusCancelled, 20);
  assert.equal(refunded.familyBonusRefund.activeBonusRemoved, 0);
  assert.equal(refunded.familyBonusRefund.unrecoveredBonus, 0);
  const pending = await one(
    'select type,amount from transactions where customer_id=$1 and order_id=$2',
    [f.owner, f.key],
  );
  assert.equal(pending.type, 'cancelled_deposit');
  assert.equal(Number(pending.amount), 0);
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
});

test('cashback reversal protects other held bonuses and records the unrecovered amount honestly', async () => {
  const f = await fixture();
  await action(f, 'pay');
  await commit(f, await reserve(f));
  const otherOrder = `other:${crypto.randomUUID()}`;
  const held = await rpc('reserve_loyalty_balance($1,$2,40,20,50,24)', [f.owner, otherOrder]);
  const refund = await action(f, 'refund');
  assert.equal(refund.familyBonusRefund.earnedBonusReversed, 20);
  assert.equal(refund.familyBonusRefund.activeBonusRemoved, 0);
  assert.equal(refund.familyBonusRefund.unrecoveredBonus, 20);
  assert.deepEqual(await balances(f), { bonus: 20, spent: 0, wallet: 100000 });
  assert.equal(
    (await one('select status from loyalty_reservations where id=$1', [held.reservation_id]))
      .status,
    'active',
  );
  await rpc('commit_loyalty_reservation($1,$2,$3,40,0,0,null)', [
    f.owner,
    otherOrder,
    held.reservation_id,
  ]);
  assert.equal((await balances(f)).bonus, 0);
  assert.equal((await action(f, 'refund')).familyBonusRefund.unrecoveredBonus, 20);
});

test('mismatched customer, branch, amount or bonus discount never obtains a refund acknowledgement', async () => {
  const f = await fixture();
  await action(f, 'pay');
  const reservation = await reserve(f);
  const stranger = crypto.randomUUID(),
    branch = crypto.randomUUID();
  await db.query("insert into customers(id,name,phone) values($1,'Other','77000000002')", [
    stranger,
  ]);
  await db.query("insert into bulka_locations(id,name) values($1,'Other')", [branch]);
  assert.equal((await action(f, 'refund', { branch })).status, 'not_found');
  assert.equal((await action(f, 'refund', { amount: f.amount + 1 })).status, 'mismatch');
  assert.equal(
    (await action(f, 'refund', { transaction: crypto.randomUUID() })).status,
    'mismatch',
  );
  await assert.rejects(reserve(f, { customer: stranger }), /family loyalty claim conflict/);
  await assert.rejects(reserve(f, { total: 401 }), /family loyalty claim conflict/);
  await assert.rejects(reserve(f, { discount: 1 }), /family loyalty claim conflict/);
  await action(f, 'refund');
  await assert.rejects(reserve(f, { customer: stranger }), /family loyalty claim conflict/);
  await assert.rejects(
    commit(f, reservation, { customer: stranger }),
    /family loyalty claim conflict/,
  );
  await assert.rejects(
    commit(f, reservation, { branch }),
    /invalid branch loyalty safety limits|branch loyalty claim conflict/,
  );
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
});

test('membership removal never blocks refund or redirects captured cashback owner', async () => {
  const f = await fixture();
  await action(f, 'pay');
  await commit(f, await reserve(f));
  await rpc('family_remove_member($1,$2)', [f.owner, f.member]);
  assert.equal((await action(f, 'refund')).familyBonusRefund.activeBonusRemoved, 20);
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
});

test('a cancelled first owner does not shadow the subsequently paid owner of the same physical receipt', async () => {
  const first = await fixture();
  await action(first, 'cancel');
  const second = await fixture();
  await action(second, 'cancel');
  second.branch = first.branch;
  second.order = first.order;
  second.key = first.key;
  second.payment = crypto.randomUUID();
  second.request = crypto.randomUUID();
  assert.equal(
    (
      await rpc('family_pos_start($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10)', [
        second.payment,
        second.request,
        second.member,
        new Date(Date.now() + 240000).toISOString(),
        second.branch,
        second.order,
        second.amount,
        fingerprint,
        'a'.repeat(64),
        crypto.randomUUID(),
      ])
    ).status,
    'authorized',
  );
  await action(second, 'pay');
  await assert.rejects(reserve(first), /family loyalty claim conflict/);
  await commit(second, await reserve(second));
  assert.deepEqual(await balances(first), { bonus: 0, spent: 0, wallet: 100000 });
  assert.deepEqual(await balances(second), { bonus: 20, spent: 400, wallet: 60000 });
  assert.equal((await action(second, 'refund')).familyBonusCustomerId, second.owner);
  assert.equal((await reserve(second)).status, 'family_refunded');
  await assert.rejects(reserve(first), /family loyalty claim conflict/);
  assert.deepEqual(await balances(second), { bonus: 0, spent: 0, wallet: 100000 });
});

test('a failure in cashback reversal rolls back the wallet refund and remains safely retryable', async () => {
  const f = await fixture();
  await action(f, 'pay');
  await commit(f, await reserve(f));
  await db.exec(`create function fail_family_refund_test() returns trigger language plpgsql as $$
    begin if new.type='refund_reversal' then raise exception 'simulated reversal outage'; end if; return new; end $$;
    create trigger fail_family_refund_test before insert on transactions for each row execute function fail_family_refund_test();`);
  try {
    await assert.rejects(action(f, 'refund'), /simulated reversal outage/);
    assert.deepEqual(await balances(f), { bonus: 20, spent: 400, wallet: 60000 });
    const state = await one(
      'select status,family_bonus_reversed_at from personal_account_pos_payments where id=$1',
      [f.payment],
    );
    assert.equal(state.status, 'paid');
    assert.equal(state.family_bonus_reversed_at, null);
    assert.equal(
      Number(
        (
          await one(
            "select count(*) n from personal_account_entries where customer_id=$1 and kind='refund'",
            [f.owner],
          )
        ).n,
      ),
      0,
    );
  } finally {
    await db.exec(
      'drop trigger fail_family_refund_test on transactions; drop function fail_family_refund_test();',
    );
  }
  assert.equal((await action(f, 'refund')).status, 'refunded');
  assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
});

test('queued commit and refund converge to no cashback in either request ordering', async () => {
  for (const refundFirst of [true, false]) {
    const f = await fixture();
    await action(f, 'pay');
    const reservation = await reserve(f);
    const results = refundFirst
      ? await Promise.all([action(f, 'refund'), commit(f, reservation)])
      : await Promise.all([commit(f, reservation), action(f, 'refund')]);
    assert.equal(results[refundFirst ? 0 : 1].status, 'refunded');
    if (refundFirst) assert.equal(results[1].status, 'family_refunded');
    assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 });
  }
});

test('unpaid family intent cannot earn and ordinary branch purchases retain their normal ledger', async () => {
  const f = await fixture();
  await assert.rejects(reserve(f), /family payment not paid/);
  const ordinary = { ...f, key: keyFor(f.branch, crypto.randomUUID()) };
  const reserved = await reserve(ordinary);
  assert.equal((await commit(ordinary, reserved)).duplicate, false);
  assert.deepEqual(await balances(f), { bonus: 20, spent: 400, wallet: 100000 });
});

test('cancelled or expired unpaid family intent does not block normal cash/card accrual to another guest', async () => {
  for (const scenario of ['cancelled', 'expired', 'stale_authorized']) {
    const f = await fixture();
    if (scenario === 'cancelled') await action(f, 'cancel');
    else if (scenario === 'expired') {
      await db.query("update personal_account_pos_payments set status='expired' where id=$1", [
        f.payment,
      ]);
    } else {
      await db.query(
        "update personal_account_pos_payments set expires_at=now()-interval '1 second' where id=$1",
        [f.payment],
      );
    }
    const guest = crypto.randomUUID();
    await db.query("insert into customers(id,name,phone) values($1,'Cash guest','77000000004')", [
      guest,
    ]);
    const ordinary = { ...f, owner: guest };
    const reservation = await reserve(ordinary);
    assert.equal((await commit(ordinary, reservation)).duplicate, false, scenario);
    const customer = await one('select balance,total_spent from customers where id=$1', [guest]);
    assert.equal(Number(customer.balance), 20, scenario);
    assert.equal(Number(customer.total_spent), 400, scenario);
    assert.deepEqual(await balances(f), { bonus: 0, spent: 0, wallet: 100000 }, scenario);
  }
});

test('internal bypass helpers cannot be executed by API roles, including service-role callers', async () => {
  for (const role of ['anon', 'authenticated', 'service_role']) {
    for (const signature of [
      'family_pos_reverse_cashback(uuid)',
      'personal_account_pos_family_base_action(uuid,uuid,uuid,bigint,text,text,text,uuid)',
      'family_pos_base_reserve(uuid,uuid,text,numeric,numeric,numeric,integer,numeric,numeric,integer,numeric,numeric)',
      'family_pos_base_commit(uuid,uuid,text,uuid,numeric,numeric,integer,jsonb,numeric,numeric,numeric,numeric)',
    ])
      assert.equal(
        (await one('select has_function_privilege($1,$2,$3) allowed', [role, signature, 'EXECUTE']))
          .allowed,
        false,
      );
  }
});

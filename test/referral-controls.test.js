const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const legacy = {
  owner: randomUUID(),
  friend: randomUUID(),
  code: randomUUID(),
  redemption: randomUUID(),
  order: randomUUID(),
};
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table settings(key text primary key,value text);
    create table customers(id uuid primary key,name text,balance numeric default 0,total_spent numeric default 0,updated_at timestamptz);
    create table bulka_locations(id uuid primary key,name text);
    create table kaspi_orders(id uuid primary key,customer_id uuid,amount numeric,branch_id uuid,status text,partially_refunded_amount numeric default 0);
    create table loyalty_reservations(id uuid primary key,customer_id uuid,order_total numeric,discount_amount numeric default 0,status text,committed_at timestamptz,pos_branch_id uuid,expires_at timestamptz default now()+interval '1 day');
    create table transactions(id uuid default gen_random_uuid(),customer_id uuid,order_id text,type text,amount numeric,description text,branch_id uuid);`);
  const suite = readFileSync(
    'supabase/migrations/20260715090000_commerce_operations_suite.sql',
    'utf8',
  );
  await db.exec(
    suite.slice(
      suite.indexOf('create table if not exists public.referral_codes'),
      suite.indexOf('create table if not exists public.targeted_promotions'),
    ),
  );
  for (const file of [
    '20260927010000_referral_links_first_purchase.sql',
    '20260927120000_referral_controls.sql',
  ]) {
    if (file === '20260927120000_referral_controls.sql') {
      await db.query('insert into customers(id,balance) values($1,500),($2,300)', [
        legacy.owner,
        legacy.friend,
      ]);
      await db.query(
        "insert into referral_codes(id,customer_id,code,reward_referrer,reward_friend) values($1,$2,'BULKA-LEGACY01',9999,9999)",
        [legacy.code, legacy.owner],
      );
      await db.query(
        "insert into kaspi_orders(id,customer_id,amount,status) values($1,$2,2000,'refunded')",
        [legacy.order, legacy.friend],
      );
      await db.query(
        "insert into referral_redemptions(id,referral_code_id,referred_customer_id,order_id,status,rewarded_at) values($1,$2,$3,$4,'rewarded',now())",
        [legacy.redemption, legacy.code, legacy.friend, legacy.order],
      );
      await db.query(
        "insert into transactions(customer_id,order_id,type,amount) values($1,$3,'deposit',500),($2,$4,'deposit',300)",
        [
          legacy.owner,
          legacy.friend,
          'REFERRAL-' + legacy.redemption + ':owner',
          'REFERRAL-' + legacy.redemption + ':friend',
        ],
      );
    }
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
});
test.after(() => db.close());
test('migration recovers historical rewards from ledger without retroactively reversing old refunds', async () => {
  const row = (
    await db.query('select reward_referrer,reward_friend from referral_redemptions where id=$1', [
      legacy.redemption,
    ])
  ).rows[0];
  assert.equal(Number(row.reward_referrer), 500);
  assert.equal(Number(row.reward_friend), 300);
  assert.equal(
    (
      await db.query('select state from referral_first_purchases where customer_id=$1', [
        legacy.friend,
      ])
    ).rows[0].state,
    'rejected',
  );
  assert.equal(Number((await wallet(legacy.owner)).balance), 500);
});
async function fixture(policy = {}) {
  await db.query("update settings set value=$1 where key='bonus_referral'", [
    JSON.stringify({
      enabled: true,
      inviter_bonus: 1000,
      friend_bonus: 500,
      min_first_order: 0,
      ...policy,
    }),
  ]);
  const owner = randomUUID(),
    friend = randomUUID(),
    branch = randomUUID(),
    purchase = randomUUID(),
    code = 'BULKA-' + randomUUID().slice(0, 8);
  await db.query('insert into customers(id) values($1),($2)', [owner, friend]);
  await db.query('insert into bulka_locations values($1,$2)', [branch, 'Test branch']);
  await db.query('insert into referral_codes(customer_id,code) values($1,$2)', [owner, code]);
  return { owner, friend, branch, purchase, code };
}
async function accept(f) {
  return (await db.query('select (redeem_referral_code($1,$2)).*', [f.friend, f.code])).rows[0];
}
async function buy(f) {
  await db.query(
    "insert into kaspi_orders(id,customer_id,amount,branch_id,status) values($1,$2,2000,$3,'paid')",
    [f.purchase, f.friend, f.branch],
  );
}
async function rpc(name, id) {
  return (await db.query(`select ${name}($1) result`, [id])).rows[0].result;
}
async function wallet(id) {
  return (
    await db.query('select balance,referral_bonus_debt debt from customers where id=$1', [id])
  ).rows[0];
}

test('refund revokes each reward once; spent and reserved amounts become debt repaid by later credits', async () => {
  const f = await fixture();
  await accept(f);
  await buy(f);
  await rpc('process_referral_purchase', f.friend);
  await db.query('update customers set balance=100 where id=$1', [f.owner]);
  await db.query(
    "insert into loyalty_reservations(id,customer_id,discount_amount,status) values($1,$2,80,'active')",
    [randomUUID(), f.owner],
  );
  await db.query('update customers set balance=0 where id=$1', [f.friend]);
  await db.query("update kaspi_orders set status='refunded' where id=$1", [f.purchase]);
  assert.equal((await rpc('reverse_referral_purchase', f.friend)).status, 'reversed');
  assert.deepEqual(await wallet(f.owner), { balance: '80', debt: '980.00' });
  assert.deepEqual(await wallet(f.friend), { balance: '0', debt: '500.00' });
  assert.equal((await rpc('reverse_referral_purchase', f.friend)).status, 'unchanged');
  await db.query('update customers set balance=balance+1200 where id=$1', [f.owner]);
  assert.deepEqual(await wallet(f.owner), { balance: '300.00', debt: '0.00' });
  assert.equal(
    (
      await db.query(
        'select count(*) n from referral_events where redemption_id=(select id from referral_redemptions where referred_customer_id=$1)',
        [f.friend],
      )
    ).rows[0].n,
    4,
  );
});
test('partial refund retains reward above minimum, reverses when net purchase falls below it', async () => {
  const f = await fixture({ min_first_order: 1000 });
  await accept(f);
  await buy(f);
  await rpc('process_referral_purchase', f.friend);
  await db.query('update kaspi_orders set partially_refunded_amount=500 where id=$1', [f.purchase]);
  assert.equal((await rpc('reverse_referral_purchase', f.friend)).status, 'unchanged');
  await db.query('update kaspi_orders set partially_refunded_amount=1200 where id=$1', [
    f.purchase,
  ]);
  assert.equal((await rpc('reverse_referral_purchase', f.friend)).status, 'reversed');
});
test('refund before processing cannot produce rewards or notifications', async () => {
  const f = await fixture({ min_first_order: 1000 });
  await accept(f);
  await buy(f);
  await db.query('update kaspi_orders set partially_refunded_amount=1500 where id=$1', [
    f.purchase,
  ]);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'not_eligible');
  assert.equal(Number((await wallet(f.owner)).balance), 0);
});
test('shared device holds reward until an audited administrator decision', async () => {
  const f = await fixture();
  await db.query('insert into referral_devices(customer_id,device_hash) values($1,$3),($2,$3)', [
    f.owner,
    f.friend,
    'a'.repeat(64),
  ]);
  const r = await accept(f);
  assert.equal(r.review_state, 'pending');
  await buy(f);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'review');
  await db.query("select review_referral($1,'approve','admin','Verified customer')", [r.id]);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'rewarded');
  const reviewed = (
    await db.query('select reviewed_by,review_note from referral_redemptions where id=$1', [r.id])
  ).rows[0];
  assert.equal(reviewed.reviewed_by, 'admin');
  assert.equal(reviewed.review_note, 'Verified customer');
});
test('invitation cap and monthly reward cap are enforced, retries remain idempotent', async () => {
  const f = await fixture({ max_invites_per_day: 1, max_reward_amount_per_month: 500 });
  const r = await accept(f);
  assert.equal((await accept(f)).id, r.id);
  const other = randomUUID();
  await db.query('insert into customers(id) values($1)', [other]);
  await assert.rejects(db.query('select redeem_referral_code($1,$2)', [other, f.code]), /limit/);
  await buy(f);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'review');
  await db.query("select review_referral($1,'reject','admin','Unverified reward')", [r.id]);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'not_eligible');
});
test('customer history is owner-scoped and excludes friend identity and purchase amounts', async () => {
  const f = await fixture();
  await accept(f);
  await buy(f);
  await rpc('process_referral_purchase', f.friend);
  const h = await rpc('customer_referral_history', f.owner);
  assert.equal(h.registered, 1);
  assert.equal(h.purchased, 1);
  assert.equal(h.earned, 1000);
  assert.deepEqual(
    Object.keys(h.items[0]).sort(),
    ['id', 'number', 'purchased', 'registeredAt', 'reward', 'status'].sort(),
  );
  assert.equal(JSON.stringify(h).includes(f.friend), false);
  assert.equal((await rpc('customer_referral_history', f.friend)).registered, 0);
});
test('branch reports use net first-purchase revenue and exclude other branches', async () => {
  const f = await fixture();
  await accept(f);
  await buy(f);
  await rpc('process_referral_purchase', f.friend);
  const report = (
    await db.query(
      "select admin_referral_report(now()-interval '1 day',now()+interval '1 day',$1,0) r",
      [[f.branch]],
    )
  ).rows[0].r;
  assert.equal(report.summary.invitations, 1);
  assert.equal(report.summary.revenue, 2000);
  assert.equal(report.summary.awarded, 1500);
  assert.equal(report.branches[0].branch_id, f.branch);
});
test('POS branch and full cancellation flow through referral accounting', async () => {
  const f = await fixture();
  await accept(f);
  await db.query("insert into loyalty_reservations values($1,$2,2000,0,'committed',now(),$3)", [
    f.purchase,
    f.friend,
    f.branch,
  ]);
  assert.equal((await rpc('process_referral_purchase', f.friend)).status, 'rewarded');
  const p = (
    await db.query('select branch_id from referral_first_purchases where customer_id=$1', [
      f.friend,
    ])
  ).rows[0];
  assert.equal(p.branch_id, f.branch);
  await db.query("update loyalty_reservations set status='cancelled' where id=$1", [f.purchase]);
  assert.equal((await rpc('reverse_referral_purchase', f.friend)).status, 'reversed');
});

test('combined POS debit and cashback cannot bypass bonus debt repayment', async () => {
  const f = await fixture();
  await db.query('update customers set balance=80,referral_bonus_debt=100 where id=$1', [f.friend]);
  await db.query(
    "insert into loyalty_reservations(id,customer_id,discount_amount,status) values($1,$2,80,'active')",
    [f.purchase, f.friend],
  );
  await db.query('update customers set balance=balance-80+10 where id=$1', [f.friend]);
  assert.deepEqual(await wallet(f.friend), { balance: '10', debt: '100.00' });
  await db.query(
    "update loyalty_reservations set status='committed',committed_at=now(),order_total=2000 where id=$1",
    [f.purchase],
  );
  assert.deepEqual(await wallet(f.friend), { balance: '0', debt: '90.00' });
});

test('cancelled and expired holds do not hide debt; another live hold stays protected', async () => {
  const f = await fixture();
  await db.query('update customers set balance=100,referral_bonus_debt=100 where id=$1', [
    f.friend,
  ]);
  await db.query(
    "insert into loyalty_reservations(id,customer_id,discount_amount,status,expires_at) values($1,$2,60,'active',now()+interval '1 day'),($3,$2,40,'active',now()+interval '1 day'),($4,$2,500,'active',now()-interval '1 day')",
    [f.purchase, f.friend, randomUUID(), randomUUID()],
  );
  await db.query("update loyalty_reservations set status='cancelled' where id=$1", [f.purchase]);
  assert.deepEqual(await wallet(f.friend), { balance: '40', debt: '40.00' });
});

test('manual POS return records cumulative refunds and does not double reverse', async () => {
  const f = await fixture({ min_first_order: 1000 });
  await accept(f);
  await db.query("insert into loyalty_reservations values($1,$2,2000,0,'committed',now(),$3)", [
    f.purchase,
    f.friend,
    f.branch,
  ]);
  await rpc('process_referral_purchase', f.friend);
  const r = (
    await db.query('select id from referral_redemptions where referred_customer_id=$1', [f.friend])
  ).rows[0];
  await db.query("select record_referral_pos_return($1,500,'admin','Receipt checked')", [r.id]);
  assert.equal(Number((await wallet(f.friend)).balance), 500);
  await assert.rejects(
    db.query("select record_referral_pos_return($1,100,'admin','Receipt checked')", [r.id]),
    /invalid POS return/,
  );
  await db.query("select record_referral_pos_return($1,1500,'admin','Receipt checked')", [r.id]);
  await db.query("select record_referral_pos_return($1,1500,'admin','Receipt checked')", [r.id]);
  assert.equal(Number((await wallet(f.friend)).balance), 0);
});

test('only service role can access history, reports and review; old payout bypass is revoked', async () => {
  for (const role of ['anon', 'authenticated'])
    for (const fn of [
      'customer_referral_history(uuid,integer)',
      'admin_referral_report(timestamptz,timestamptz,uuid[],integer)',
      'review_referral(uuid,text,text,text)',
      'record_referral_pos_return(uuid,numeric,text,text)',
    ])
      assert.equal(
        (await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, fn]))
          .rows[0].allowed,
        false,
      );
  for (const fn of ['process_referral_purchase_v1(uuid)', 'redeem_referral_code_v1(uuid,text)']) {
    assert.equal(
      (await db.query("select has_function_privilege('service_role',$1,'EXECUTE') allowed", [fn]))
        .rows[0].allowed,
      false,
    );
  }
});

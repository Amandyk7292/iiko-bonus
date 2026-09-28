const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create table admin_user_profiles(username text primary key,role text constraint admin_user_profiles_role_check check(role in ('owner','viewer')));
 create table bulka_locations(id uuid primary key,name text,city text);
 create table kaspi_orders(id uuid primary key,branch_id uuid,customer_id uuid,order_number int,created_at timestamptz default now(),status text,fulfillment_status text,refund_status text,amount numeric,bonus_spent numeric,discount_amount numeric,delivery_fee numeric,partially_refunded_amount numeric,cancellation_reason text,payment_method text,provider_status text,payment_reconciled_at timestamptz,fulfillment_type text default 'pickup');
 create table order_partial_refund_adjustments(order_id uuid,spent_bonus_restored numeric);
 create table order_partial_refunds(id uuid primary key,order_id uuid,status text);
 create table order_partial_refund_items(refund_id uuid,line_key text,refund_amount numeric);
 create table delivery_jobs(id uuid primary key default gen_random_uuid(),order_id uuid,budget_final_cost numeric,currency text default 'KZT');`);
  for (const name of [
    '20260928090000_franchise_accounts.sql',
    '20260928091000_franchise_finances.sql',
    '20260928092000_franchise_operations.sql',
    '20260928120000_franchise_controls.sql',
    '20260928121000_franchise_report_detail.sql',
    '20260928140000_franchise_automatic_settlement.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
});
test.after(() => db.close());
async function fixture(delivery = true) {
  const b = randomUUID(),
    p = randomUUID(),
    o = randomUUID();
  await db.query("insert into bulka_locations values($1,'Точка','Актау')", [b]);
  await db.query(
    "insert into franchise_partners(id,name,created_by) values($1,'Франчайзи','owner')",
    [p],
  );
  await db.query("select franchise_set_terms($1,$2,400,10000,'partner','owner')", [b, p]);
  await db.query(
    "insert into kaspi_orders(id,branch_id,order_number,status,fulfillment_status,amount,bonus_spent,delivery_fee,payment_method,provider_payment_confirmed_at,fulfillment_type) values($1,$2,1,'paid','completed',1020000,0,20000,'forte_card',now(),$3)",
    [o, b, delivery ? 'delivery' : 'pickup'],
  );
  return { b, p, o };
}
async function row(o) {
  return (await db.query('select * from franchise_order_finances_v3 where order_id=$1', [o]))
    .rows[0];
}
test('4 percent includes acquiring; client delivery counted once; real courier cost deducted', async () => {
  const { o } = await fixture();
  let r = await row(o);
  assert.equal(r.settlement_model, 2);
  assert.equal(r.commission_bps, 400);
  assert.equal(r.payment_confirmed, true);
  assert.equal(r.payment_review, false);
  assert.equal(r.delivery_cost_pending, true);
  assert.equal(r.reconciled, false);
  await db.query('insert into delivery_jobs(order_id,budget_final_cost) values($1,70000)', [o]);
  r = await row(o);
  assert.equal(Number(r.entitlement), 910000);
  assert.equal(Number(r.delivery_net_cost), 50000);
  assert.equal(r.reconciled, true);
  await db.query('update franchise_order_accounts set acquiring_fee=40000 where order_id=$1', [o]);
  assert.equal(Number((await row(o)).entitlement), 910000);
});
test('payout blocks missing delivery bill; only final amount can be confirmed once', async () => {
  const { b, p, o } = await fixture();
  const id = randomUUID();
  const pay = () =>
    db.query("select franchise_record_payout($1,$2,$3,910000,'doc-unique',now(),'owner')", [
      id,
      b,
      p,
    ]);
  await assert.rejects(pay(), /Reconcile/);
  await db.query('insert into delivery_jobs(order_id,budget_final_cost) values($1,70000)', [o]);
  await pay();
  await pay();
  assert.equal(Number((await row(o)).paid_out), 910000);
  await db.query(
    "update kaspi_orders set status='refunded',refund_status='succeeded',provider_status='refunded' where id=$1",
    [o],
  );
  const r = await row(o);
  assert.equal(Number(r.entitlement), -70000);
  assert.equal(Number(r.entitlement) - Number(r.paid_out), -980000);
});
test('no manual reconciliation or bank fee needed for approved own point', async () => {
  const { b, o } = await fixture(false);
  await db.query('update franchise_order_accounts set partner_id=null where order_id=$1', [o]);
  const r = await row(o);
  assert.equal(r.reconciled, true);
  assert.equal(r.payment_review, false);
  const issues = (
    await db.query(
      "select franchise_order_drilldown(now()-interval '1 day',now()+interval '1 day',$1,$2,null,'issues',0) r",
      [[b], b],
    )
  ).rows[0].r;
  assert.equal(issues.total, 0);
});
test('bank mismatch and pending refund require review; missing cost cannot be treated as zero', async () => {
  const { o } = await fixture(false);
  await db.query('update kaspi_orders set provider_payment_confirmed_at=null where id=$1', [o]);
  let r = await row(o);
  assert.equal(r.payment_review, true);
  assert.equal(r.reconciled, false);
  await db.query(
    "update kaspi_orders set provider_payment_confirmed_at=now(),refund_status='processing' where id=$1",
    [o],
  );
  r = await row(o);
  assert.equal(r.payment_review, true);
});
test('several courier jobs add up, including charged cancellation; a missing bill blocks', async () => {
  const { o } = await fixture();
  await db.query(
    'insert into delivery_jobs(order_id,budget_final_cost) values($1,10000),($1,null)',
    [o],
  );
  assert.equal((await row(o)).delivery_cost_pending, true);
  await db.query(
    'update delivery_jobs set budget_final_cost=60000 where order_id=$1 and budget_final_cost is null',
    [o],
  );
  assert.equal(Number((await row(o)).delivery_actual_cost), 70000);
});

test('a newer bank discrepancy invalidates an earlier manual statement', async () => {
  const { o } = await fixture(false);
  const r = await row(o);
  await db.query("select franchise_reconcile($1,0,'platform','statement-1','owner',$2)", [
    o,
    r.current_signature,
  ]);
  await db.query(
    "insert into franchise_bank_checks(order_id,checked_by,signature,payment_status,refund_status,issue,checked_at) values($1,'automatic',$2,'pending','none','payment_unconfirmed',now()+interval '1 second')",
    [o, r.current_signature],
  );
  const changed = await row(o);
  assert.equal(changed.payment_review, true);
  assert.equal(changed.reconciled, false);
});

test('late courier bill corrections appear once in the next month, leaving the closed month intact', async () => {
  const { b, p, o } = await fixture();
  await db.query("update kaspi_orders set created_at='2025-01-12' where id=$1", [o]);
  await db.query('insert into delivery_jobs(order_id,budget_final_cost) values($1,70000)', [o]);
  const preview = async (month) =>
    (await db.query('select franchise_month_preview($1,$2,$3) r', [b, p, month])).rows[0].r;
  const first = await preview('2025-01-01');
  assert.equal(first.blocked, 0);
  const closure = (
    await db.query("select franchise_close_month($1,$2,'2025-01-01',$3,'owner') id", [
      b,
      p,
      first.signature,
    ])
  ).rows[0].id;
  await db.query('update delivery_jobs set budget_final_cost=80000 where order_id=$1', [o]);
  const next = await preview('2025-02-01');
  assert.equal(Number(next.entitlement), -10000);
  assert.equal(next.items[0].adjustment, true);
  const snapshot = (
    await db.query('select snapshot from franchise_month_closures where id=$1', [closure])
  ).rows[0].snapshot;
  assert.equal(Number(snapshot.entitlement), 910000);
  await db.query("select franchise_close_month($1,$2,'2025-02-01',$3,'owner')", [
    b,
    p,
    next.signature,
  ]);
  assert.equal((await preview('2025-03-01')).items.length, 0);
});

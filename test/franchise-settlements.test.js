const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const branch = randomUUID(),
  partner = randomUUID();
test.before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;
 create table bulka_locations(id uuid primary key,name text,city text);
 create table kaspi_orders(id uuid primary key,branch_id uuid,customer_id uuid,order_number integer,created_at timestamptz default now(),status text,fulfillment_status text,refund_status text,amount numeric,bonus_spent numeric,discount_amount numeric,delivery_fee numeric,partially_refunded_amount numeric);
 create table order_partial_refund_adjustments(order_id uuid,spent_bonus_restored numeric);
 create table order_partial_refunds(id uuid primary key,order_id uuid,status text);
 create table order_partial_refund_items(refund_id uuid,line_key text,refund_amount numeric);`);
  for (const file of [
    '20260928090000_franchise_accounts.sql',
    '20260928091000_franchise_finances.sql',
    '20260928092000_franchise_operations.sql',
  ])
    await db.exec(readFileSync('supabase/migrations/' + file, 'utf8').replace(/^\uFEFF/, ''));
  await db.query("insert into bulka_locations values($1,'Точка','Актау')", [branch]);
  await db.query(
    "insert into franchise_partners(id,name,created_by) values($1,'Партнёр','owner')",
    [partner],
  );
});
test.after(() => db.close());
async function terms(p = partner, commission = 1000) {
  await db.query("select franchise_set_terms($1,$2,$3,10000,'platform','owner')", [
    branch,
    p,
    commission,
  ]);
}
async function order() {
  const id = randomUUID();
  await db.query(
    "insert into kaspi_orders(id,branch_id,customer_id,order_number,status,fulfillment_status,amount,bonus_spent,discount_amount,delivery_fee) values($1,$2,$3,1,'paid','completed',1200,100,50,200)",
    [id, branch, randomUUID()],
  );
  return id;
}
async function row(id) {
  return (await db.query('select * from franchise_order_finances where order_id=$1', [id])).rows[0];
}
async function reconcile(id, fee = 20) {
  const r = await row(id);
  await db.query("select franchise_reconcile($1,$2,'platform','statement-1','owner',$3)", [
    id,
    fee,
    r.current_signature,
  ]);
}
test('company-owned by default, terms frozen for past orders', async () => {
  const id = await order();
  await terms();
  assert.equal((await row(id)).partner_id, null);
  const p = await order();
  await terms(partner, 2000);
  assert.equal((await row(p)).commission_bps, 1000);
  await terms(null);
});
test('exact decimal entitlement and confirmed refunds only', async () => {
  await terms();
  const id = await order();
  await reconcile(id);
  let r = await row(id);
  assert.equal(Number(r.entitlement), 980);
  await db.query("update kaspi_orders set refund_status='pending' where id=$1", [id]);
  r = await row(id);
  assert.equal(Number(r.cash_refunded), 0);
  assert.equal(r.reconciled, false);
  await terms(null);
});
test('report scopes branches and excludes private customer ids', async () => {
  const result = (
    await db.query(
      "select franchise_report(now()-interval '1 day',now()+interval '1 day',$1,null,0) r",
      [[randomUUID()]],
    )
  ).rows[0].r;
  assert.equal(result.totalOrders, 0);
  const all = (
    await db.query(
      "select franchise_report(now()-interval '1 day',now()+interval '1 day','{}',null,0) r",
    )
  ).rows[0].r;
  assert.ok(all.orders.length);
  assert.equal('customer_id' in all.orders[0], false);
});
test('payout blocks unverified orders, records allocations once, refund creates debt', async () => {
  // Isolate this partner from the earlier intentionally unverified fixtures.
  const p = randomUUID();
  await db.query("insert into franchise_partners(id,name,created_by) values($1,'Второй','owner')", [
    p,
  ]);
  await terms(p);
  const id = await order();
  const payout = randomUUID();
  const pay = () =>
    db.query(
      "select franchise_record_payout($1,$2,$3,980,'bank-transfer-unique',now(),'owner') r",
      [payout, branch, p],
    );
  await assert.rejects(pay(), /Reconcile/);
  await reconcile(id);
  await pay();
  await pay();
  assert.equal(Number((await row(id)).paid_out), 980);
  await assert.rejects(
    db.query("select franchise_record_payout($1,$2,$3,980,'different',now(),'owner')", [
      randomUUID(),
      branch,
      p,
    ]),
    /Balance changed/,
  );
  await db.query(
    "update kaspi_orders set status='refunded',partially_refunded_amount=1200 where id=$1",
    [id],
  );
  const r = await row(id);
  assert.equal(Number(r.entitlement) - Number(r.paid_out), -1000);
  assert.equal(r.reconciled, false);
});
test('old reconciliation signature cannot confirm changed order', async () => {
  const id = await order();
  const r = await row(id);
  await db.query('update kaspi_orders set amount=1300 where id=$1', [id]);
  await assert.rejects(
    db.query("select franchise_reconcile($1,20,'platform','bank-ref','owner',$2)", [
      id,
      r.current_signature,
    ]),
    /Order changed/,
  );
});
test('anonymous role cannot read accounts or invoke payouts', async () => {
  await db.exec('set role anon');
  try {
    await assert.rejects(db.query('select * from franchise_order_accounts'), /permission denied/);
    await assert.rejects(
      db.query("select franchise_report(now(),now()+interval '1 day','{}',null,0)"),
      /permission denied/,
    );
  } finally {
    await db.exec('reset role');
  }
});
test('partial cash, delivery and bonus refund reduce entitlement without double subtraction', async () => {
  await terms();
  const id = await order(),
    refund = randomUUID();
  await reconcile(id);
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded')", [refund, id]);
  await db.query("insert into order_partial_refund_items values($1,'__delivery_fee__',200)", [
    refund,
  ]);
  await db.query('insert into order_partial_refund_adjustments values($1,40)', [id]);
  await db.query('update kaspi_orders set partially_refunded_amount=600 where id=$1', [id]);
  let r = await row(id);
  assert.equal(Number(r.cash_net), 600);
  assert.equal(Number(r.delivery_net), 0);
  assert.equal(Number(r.bonus_net), 60);
  assert.equal(Number(r.entitlement), 580);
  assert.equal(r.reconciled, false);
  await reconcile(id, 10);
  r = await row(id);
  assert.equal(Number(r.entitlement), 590);
  assert.equal(r.reconciled, true);
});
test('direct partner receipt is not counted again as money owed', async () => {
  await terms();
  const id = await order(),
    r = await row(id);
  await db.query("select franchise_reconcile($1,20,'partner','direct-bank','owner',$2)", [
    id,
    r.current_signature,
  ]);
  assert.equal(Number((await row(id)).entitlement), -200);
});
test('pending partial refund invalidates reconciliation before cash total changes', async () => {
  const id = await order();
  await reconcile(id);
  await db.query("insert into order_partial_refunds values($1,$2,'processing')", [
    randomUUID(),
    id,
  ]);
  const r = await row(id);
  assert.equal(r.refund_unresolved, true);
  assert.equal(r.reconciled, false);
});
test('payout detail applies scope and retains every allocation', async () => {
  const payouts = (await db.query('select id from franchise_payouts')).rows;
  assert.equal(payouts.length, 1);
  const hidden = (
    await db.query('select franchise_payout_detail($1,$2) r', [payouts[0].id, [randomUUID()]])
  ).rows[0].r;
  assert.equal(hidden, null);
  const visible = (
    await db.query('select franchise_payout_detail($1,$2) r', [payouts[0].id, [branch]])
  ).rows[0].r;
  assert.equal(visible.items.length, 1);
  assert.equal(Number(visible.items[0].amount), 980);
});

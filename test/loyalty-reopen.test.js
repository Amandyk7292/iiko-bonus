const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(async () => {
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create table customers(id uuid primary key,balance numeric);
    create table bulka_locations(id uuid primary key, active boolean default true);
    create table iiko_operation_logs(branch_id uuid,created_at timestamptz);`);
  const base = readFileSync('supabase/migrations/20260713190000_order_fulfillment.sql', 'utf8');
  await db.exec(
    base.slice(
      base.indexOf('create table if not exists public.loyalty_reservations'),
      base.indexOf(
        ';',
        base.indexOf('grant execute on function public.cancel_loyalty_reservation'),
      ) + 1,
    ),
  );
  const branch = readFileSync(
    'supabase/migrations/20260810110000_backend_rbac_financial_hardening.sql',
    'utf8',
  );
  await db.exec(
    branch.slice(
      0,
      branch.indexOf('create or replace function public.commit_branch_loyalty_reservation'),
    ),
  );
  const cancelStart = branch.indexOf(
    'create or replace function public.cancel_branch_loyalty_reservation',
  );
  await db.exec(
    branch.slice(
      cancelStart,
      branch.indexOf('revoke all on function public.reserve_branch_loyalty_balance'),
    ),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260910190000_loyalty_retry_after_cancel.sql', 'utf8'),
  );
});
test.after(() => db.close());
async function fixture() {
  const branch = randomUUID(),
    customer = randomUUID(),
    order = `bp1:${branch}:${randomUUID()}`;
  await db.query('insert into customers values($1,10000)', [customer]);
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  return { branch, customer, order };
}
async function reserve(ctx, total, discount, limit = 2000000) {
  const { rows } = await db.query(
    'select reserve_branch_loyalty_balance($1,$2,$3,$4,$5,50,24,250000,125000,500,5000000,$6) r',
    [ctx.branch, ctx.customer, ctx.order, total, discount, limit],
  );
  return rows[0].r;
}
const cancel = (ctx, id) =>
  db.query('select cancel_branch_loyalty_reservation($1,$2,$3,$4) r', [
    ctx.branch,
    ctx.customer,
    ctx.order,
    id,
  ]);
test('cancelled purchase can use bonuses again for a different amount; late cancellation cannot release new reserve', async () => {
  const ctx = await fixture();
  const first = await reserve(ctx, 5070, 2535);
  await cancel(ctx, first.reservation_id);
  const next = await reserve(ctx, 450, 225);
  assert.notEqual(first.reservation_id, next.reservation_id);
  assert.equal(next.discount_amount, 225);
  assert.equal(next.available_balance, 9775);
  const late = await cancel(ctx, first.reservation_id);
  assert.equal(late.rows[0].r.duplicate, true);
  const result = await db.query('select status from loyalty_reservations where id=$1', [
    next.reservation_id,
  ]);
  assert.equal(result.rows[0].status, 'active');
  const duplicate = await reserve(ctx, 450, 225);
  assert.equal(duplicate.reservation_id, next.reservation_id);
});
test('editing an unpaid check updates the branch ledger with the new amounts', async () => {
  const ctx = await fixture();
  const first = await reserve(ctx, 1000, 500);
  const next = await reserve(ctx, 450, 225);
  assert.equal(first.reservation_id, next.reservation_id);
  const { rows } = await db.query(
    'select order_total,discount_amount from branch_pos_loyalty_usage where reservation_id=$1',
    [next.reservation_id],
  );
  assert.equal(Number(rows[0].order_total), 450);
  assert.equal(Number(rows[0].discount_amount), 225);
});
test('committed purchase cannot be repurposed or cancelled', async () => {
  const ctx = await fixture();
  const first = await reserve(ctx, 1000, 500);
  await db.query(
    "update loyalty_reservations set status='committed',committed_at=now() where id=$1",
    [first.reservation_id],
  );
  await assert.rejects(reserve(ctx, 450, 225), /committed reservation/);
  await assert.rejects(cancel(ctx, first.reservation_id), /already committed/);
});
test('expired reserve gets a new identity and cannot be committed by a stale request', async () => {
  const ctx = await fixture();
  const first = await reserve(ctx, 1000, 500);
  await db.query(
    "update loyalty_reservations set expires_at=now()-interval '1 minute' where id=$1",
    [first.reservation_id],
  );
  const next = await reserve(ctx, 600, 300);
  assert.notEqual(first.reservation_id, next.reservation_id);
  await assert.rejects(
    db.query("select commit_loyalty_reservation($1,$2,$3,1000,500,5,'[]')", [
      ctx.customer,
      ctx.order,
      first.reservation_id,
    ]),
  );
});

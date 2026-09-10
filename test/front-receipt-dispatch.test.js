const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
test.before(async () => {
  await require('./helpers/front-stock-schema.cjs')(db);
  await db.exec(`
    alter table kaspi_orders add column fulfillment_type text default 'pickup',
      add column preorder_fulfillment_type text, add column courier_id uuid,
      add column courier_dispatch_status text, add column courier_dispatch_requested_at timestamptz,
      add column courier_dispatch_completed_at timestamptz, add column courier_dispatch_next_attempt_at timestamptz,
      add column courier_dispatch_error text, add column updated_at timestamptz default now();
    create table delivery_jobs(id uuid default gen_random_uuid(), order_id uuid references kaspi_orders(id));
  `);
  await db.exec(
    readFileSync(
      'supabase/migrations/20260910140000_preorder_pickup_and_receipt_dispatch.sql',
      'utf8',
    ),
  );
});
test.after(() => db.close());
async function setup(strict = true, type = 'delivery') {
  const branch = randomUUID(),
    terminal = randomUUID(),
    id = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity) values($1,'bun',10)",
    [branch],
  );
  if (strict) {
    await db.query(
      'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
      [branch, [terminal]],
    );
    await db.query('select front_stock_heartbeat($1,$2,true)', [branch, terminal]);
  }
  await db.query('select reserve_order_inventory($1,$2,$3,$4)', [
    randomUUID(),
    randomUUID(),
    branch,
    [{ id: 'bun', quantity: 2 }],
  ]);
  await db.query(
    'insert into kaspi_orders(id,branch_id,order_number,fulfillment_type,subtotal) values($1,$2,10001,$3,70)',
    [id, branch, type],
  );
  await db.query(
    "update inventory_reservations set order_id=$2,status='committed' where branch_id=$1",
    [branch, id],
  );
  return { branch, terminal, id };
}
async function accept(ctx) {
  await db.query(
    `update kaspi_orders set fulfillment_status='preparing',courier_dispatch_status='pending',
    courier_dispatch_requested_at=now(),courier_dispatch_next_attempt_at=now() where id=$1`,
    [ctx.id],
  );
}
async function receipt(ctx, outcome = 'closed') {
  const receipt = randomUUID();
  const key =
    'bp1:' +
    ctx.branch +
    ':' +
    createHash('sha256')
      .update(ctx.branch + '\0' + receipt)
      .digest('hex');
  await db.query('select authorize_front_stock_sale($1,$2,$3,$4,70,$5,10001)', [
    ctx.branch,
    ctx.terminal,
    receipt,
    { bun: 2 },
    key,
  ]);
  await db.query('select finish_front_stock_sale($1,$2,$3,$4,$5,70)', [
    ctx.branch,
    ctx.terminal,
    receipt,
    outcome,
    { bun: 2 },
  ]);
  return receipt;
}
async function read(ctx) {
  return (await db.query('select * from kaspi_orders where id=$1', [ctx.id])).rows[0];
}

test('tablet accepts while POS is offline; automatic and manual dispatch wait for the receipt', async () => {
  const ctx = await setup();
  await db.query(
    "update front_stock_terminals set last_seen_at=now()-interval '1 hour' where branch_id=$1",
    [ctx.branch],
  );
  await accept(ctx);
  assert.equal((await read(ctx)).courier_dispatch_status, 'awaiting_receipt');
  assert.equal((await read(ctx)).courier_dispatch_next_attempt_at, null);
  await assert.rejects(
    db.query('insert into delivery_jobs(order_id) values($1)', [ctx.id]),
    /кассового чека/,
  );
  await assert.rejects(
    db.query('update kaspi_orders set courier_id=$2 where id=$1', [ctx.id, randomUUID()]),
    /кассового чека/,
  );
  await db.query('select front_stock_heartbeat($1,$2,true)', [ctx.branch, ctx.terminal]);
  await receipt(ctx);
  const order = await read(ctx);
  assert.equal(order.courier_dispatch_status, 'pending');
  assert.ok(order.courier_dispatch_next_attempt_at);
  await db.query('insert into delivery_jobs(order_id) values($1)', [ctx.id]);
  await db.query(
    "update kaspi_orders set courier_dispatch_status='succeeded',courier_dispatch_completed_at=now() where id=$1",
    [ctx.id],
  );
  await db.query('update front_stock_sales set updated_at=now() where online_order_id=$1', [
    ctx.id,
  ]);
  assert.equal((await read(ctx)).courier_dispatch_status, 'succeeded');
});
test('a voided receipt does not start delivery', async () => {
  const ctx = await setup();
  await accept(ctx);
  await receipt(ctx, 'voided');
  assert.equal((await read(ctx)).courier_dispatch_status, 'awaiting_receipt');
});
test('ordinary non-strict delivery keeps existing dispatch flow', async () => {
  const ctx = await setup(false);
  await accept(ctx);
  assert.equal((await read(ctx)).courier_dispatch_status, 'pending');
  await db.query('insert into delivery_jobs(order_id) values($1)', [ctx.id]);
});
test('preorders only allow branch pickup and cannot queue a courier', async () => {
  const ctx = await setup(false, 'preorder');
  await assert.rejects(
    db.query("update kaspi_orders set preorder_fulfillment_type='delivery' where id=$1", [ctx.id]),
    /preorder_pickup_only/,
  );
  await assert.rejects(accept(ctx), /Предзаказ/);
  await assert.rejects(
    db.query('insert into delivery_jobs(order_id) values($1)', [ctx.id]),
    /Предзаказ/,
  );
  await db.query(
    "update kaspi_orders set fulfillment_status='preparing',preorder_fulfillment_type='pickup' where id=$1",
    [ctx.id],
  );
});

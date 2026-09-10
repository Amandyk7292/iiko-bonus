const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(() => require('./helpers/front-tablet-schema.cjs')(db));
test.after(() => db.close());
async function fixture(type = 'delivery') {
  const branch = randomUUID(),
    terminal = randomUUID(),
    id = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity) values($1,'bun',6)",
    [branch],
  );
  await db.query(
    'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
    [branch, [terminal]],
  );
  await db.query('select front_stock_heartbeat($1,$2,true)', [branch, terminal]);
  await db.query('select reserve_order_inventory($1,$2,$3,$4)', [
    randomUUID(),
    randomUUID(),
    branch,
    [{ id: 'bun', quantity: 5 }],
  ]);
  await db.query(
    'insert into kaspi_orders(id,branch_id,order_number,subtotal,discount_amount,bonus_spent,fulfillment_type) values($1,$2,10001,175,15,10,$3)',
    [id, branch, type],
  );
  await db.query(
    "update inventory_reservations set order_id=$2,status='committed' where branch_id=$1",
    [branch, id],
  );
  return { branch, terminal, id };
}
async function order(ctx) {
  return (await db.query('select * from kaspi_orders where id=$1', [ctx.id])).rows[0];
}
async function stock(ctx) {
  return Number(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        ctx.branch,
      ])
    ).rows[0].source_quantity,
  );
}
async function status(ctx, next) {
  const before = await order(ctx);
  const patch = {
    kitchen_status: next,
    fulfillment_status:
      next === 'handed_over'
        ? before.fulfillment_type === 'delivery'
          ? 'ready'
          : 'completed'
        : next,
  };
  if (next === 'preparing' && before.fulfillment_type === 'delivery')
    Object.assign(patch, {
      courier_dispatch_status: 'pending',
      courier_dispatch_requested_at: new Date().toISOString(),
    });
  return (
    await db.query('select apply_staff_order_transition($1,$2,$3,$4,$5) result', [
      ctx.id,
      before.kitchen_status,
      before.fulfillment_status,
      patch,
      'cashier:test',
    ])
  ).rows[0].result;
}
async function fallback(ctx) {
  await db.query('select front_stock_heartbeat($1,$2,false)', [ctx.branch, ctx.terminal]);
  await db.query('select begin_tablet_stock_control($1,$2,$3)', [
    ctx.branch,
    'cashier:test',
    randomUUID(),
  ]);
}
async function authorize(ctx) {
  const receipt = randomUUID();
  const key =
    'bp1:' +
    ctx.branch +
    ':' +
    createHash('sha256')
      .update(ctx.branch + '\0' + receipt)
      .digest('hex');
  await db.query('select authorize_front_stock_sale($1,$2,$3,$4,150,$5,10001)', [
    ctx.branch,
    ctx.terminal,
    receipt,
    { bun: 5 },
    key,
  ]);
  return receipt;
}
async function finish(ctx, receipt, state = 'closed') {
  await db.query('select finish_front_stock_sale($1,$2,$3,$4,$5,150)', [
    ctx.branch,
    ctx.terminal,
    receipt,
    state,
    { bun: 5 },
  ]);
}
test('tablet ready calls delivery and handover works; late POS receipt never charges stock or bonuses twice', async () => {
  const ctx = await fixture();
  await fallback(ctx);
  await status(ctx, 'preparing');
  assert.equal((await order(ctx)).courier_dispatch_status, 'awaiting_receipt');
  await status(ctx, 'ready');
  let current = await order(ctx);
  assert.equal(current.courier_dispatch_status, 'pending');
  assert.equal(current.pos_receipt_due, true);
  assert.equal(current.tablet_ready_by, 'cashier:test');
  assert.equal(await stock(ctx), 1);
  await db.query('insert into delivery_jobs(order_id) values($1)', [ctx.id]);
  await status(ctx, 'handed_over');
  await db.query("update kaspi_orders set fulfillment_status='completed' where id=$1", [ctx.id]);
  assert.equal(await stock(ctx), 1);
  // Main register returns only after recount; simulate its confirmed final mode.
  await db.query("update front_stock_policies set control_mode='front' where branch_id=$1", [
    ctx.branch,
  ]);
  await db.query('select front_stock_heartbeat($1,$2,true)', [ctx.branch, ctx.terminal]);
  const receipt = await authorize(ctx);
  await finish(ctx, receipt);
  await finish(ctx, receipt);
  assert.equal(await stock(ctx), 1);
  current = await order(ctx);
  assert.equal(current.pos_receipt_due, false);
  assert.equal(Number(current.bonus_spent), 10);
  assert.equal(Number(current.subtotal), 175);
  assert.equal(
    (
      await db.query('select count(*) n from front_online_stock_settlements where order_id=$1', [
        ctx.id,
      ])
    ).rows[0].n,
    1,
  );
  assert.equal((await db.query('select count(*) n from loyalty_reservations')).rows[0].n, 0);
});
test('normal strict mode still prevents giving out unreceipted goods', async () => {
  const ctx = await fixture('pickup');
  await status(ctx, 'preparing');
  await status(ctx, 'ready');
  await assert.rejects(status(ctx, 'handed_over'), /Сначала пробейте/);
  assert.equal(await stock(ctx), 6);
});
test('offline POS can reconcile an in-flight online receipt after tablet fallback without another stock debit', async () => {
  const ctx = await fixture('pickup');
  await status(ctx, 'preparing');
  const receipt = await authorize(ctx);
  await fallback(ctx);
  await status(ctx, 'ready');
  await status(ctx, 'handed_over');
  await finish(ctx, receipt);
  assert.equal(await stock(ctx), 1);
  assert.equal((await order(ctx)).pos_receipt_due, false);
});
test('voiding a draft online receipt preserves its reservation for a corrected receipt', async () => {
  const ctx = await fixture('pickup');
  await status(ctx, 'preparing');
  await finish(ctx, await authorize(ctx), 'voided');
  assert.equal(await stock(ctx), 6);
  await finish(ctx, await authorize(ctx));
  assert.equal(await stock(ctx), 1);
});
test('repeated ready and stale acceptance cannot duplicate stock settlement or overwrite cancellation', async () => {
  const ctx = await fixture('pickup');
  await fallback(ctx);
  await status(ctx, 'preparing');
  await status(ctx, 'ready');
  await status(ctx, 'ready');
  assert.equal(await stock(ctx), 1);
  const result = await db.query('select apply_staff_order_transition($1,$2,$3,$4,$5) result', [
    ctx.id,
    'queued',
    'new',
    { kitchen_status: 'preparing' },
    'stale',
  ]);
  assert.equal(result.rows[0].result, null);
});

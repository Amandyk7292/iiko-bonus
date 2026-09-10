const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(async () => {
  await require('./helpers/front-tablet-schema.cjs')(db);
  await require('./helpers/front-refund-schema.cjs')(db);
  for (const name of [
    '20260910147000_preorder_stop_only',
    '20260910148000_tablet_recovery',
    '20260910149000_staff_order_badges',
  ])
    await db.exec(readFileSync('supabase/migrations/' + name + '.sql', 'utf8'));
});
test.after(() => db.close());
async function fixture() {
  const branch = randomUUID(),
    terminal = randomUUID(),
    customer = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
    [branch, [terminal]],
  );
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,manual_stop) values($1,'bun',0,true)",
    [branch],
  );
  return { branch, terminal, customer };
}
async function reserve(ctx, hours = 25, quantity = 5, request = randomUUID()) {
  return db.query(
    'select reserve_preorder_inventory($1,$2,$3,$4,now()+make_interval(hours=>$5)) result',
    [ctx.customer, request, ctx.branch, [{ id: 'bun', quantity }], hours],
  );
}
test('preorder requires 24 hours even with no connected register and no display stock', async () => {
  const ctx = await fixture();
  await assert.rejects(reserve(ctx, 23), /24 часа/);
  await reserve(ctx, 24);
  const rows = (
    await db.query('select * from inventory_reservations where branch_id=$1', [ctx.branch])
  ).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].allocation_kind, 'preorder');
  assert.equal(
    Number(
      (
        await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
          ctx.branch,
        ])
      ).rows[0].source_quantity,
    ),
    0,
  );
});
test('preorder stop uses revision checks and stops new reservations without changing the display', async () => {
  const ctx = await fixture();
  const revision = (
    await db.query('select stock_revision from branch_product_inventory where branch_id=$1', [
      ctx.branch,
    ])
  ).rows[0].stock_revision;
  await db.query("select update_preorder_stop($1,'bun',true,$2)", [ctx.branch, revision]);
  await assert.rejects(reserve(ctx), /временно недоступен/);
  await assert.rejects(
    db.query("select update_preorder_stop($1,'bun',false,$2)", [ctx.branch, revision]),
    /уже изменился/,
  );
  await db.query("select update_preorder_stop($1,'new-product',true,0)", [ctx.branch]);
  assert.equal(
    (
      await db.query(
        "select preorder_stop from branch_product_inventory where branch_id=$1 and product_id='new-product'",
        [ctx.branch],
      )
    ).rows[0].preorder_stop,
    true,
  );
});
test('preorder does not hold display units; tablet handover and late receipt do not debit them', async () => {
  const ctx = await fixture(),
    id = randomUUID();
  await reserve(ctx);
  await db.query(
    "insert into kaspi_orders(id,branch_id,order_number,fulfillment_type,subtotal) values($1,$2,5001,'preorder',175)",
    [id, ctx.branch],
  );
  await db.query('update inventory_reservations set order_id=$2 where branch_id=$1', [
    ctx.branch,
    id,
  ]);
  await db.query('select commit_order_reservations($1)', [id]);
  await db.query('select begin_tablet_stock_control($1,$2,$3)', [
    ctx.branch,
    'cashier',
    randomUUID(),
  ]);
  const revision = (
    await db.query('select stock_revision from branch_product_inventory where branch_id=$1', [
      ctx.branch,
    ])
  ).rows[0].stock_revision;
  await db.query("select update_cashier_inventory($1,'bun','Bun',$2,$3)", [
    ctx.branch,
    revision,
    { sourceQuantity: 2, manualStop: false },
  ]);
  await db.query("select apply_staff_order_transition($1,'queued','new',$2,'cashier')", [
    id,
    { kitchen_status: 'preparing', fulfillment_status: 'preparing' },
  ]);
  await db.query("select apply_staff_order_transition($1,'preparing','preparing',$2,'cashier')", [
    id,
    { kitchen_status: 'ready', fulfillment_status: 'ready' },
  ]);
  await db.query("select apply_staff_order_transition($1,'ready','ready',$2,'cashier')", [
    id,
    { kitchen_status: 'handed_over', fulfillment_status: 'completed' },
  ]);
  await db.query("update front_stock_policies set control_mode='front' where branch_id=$1", [
    ctx.branch,
  ]);
  await db.query('select front_stock_heartbeat($1,$2,true)', [ctx.branch, ctx.terminal]);
  const receipt = randomUUID(),
    key =
      'bp1:' +
      ctx.branch +
      ':' +
      createHash('sha256')
        .update(ctx.branch + '\0' + receipt)
        .digest('hex');
  await db.query('select authorize_front_stock_sale($1,$2,$3,$4,175,$5,5001)', [
    ctx.branch,
    ctx.terminal,
    receipt,
    { bun: 5 },
    key,
  ]);
  await db.query("select finish_front_stock_sale($1,$2,$3,'closed',$4,175)", [
    ctx.branch,
    ctx.terminal,
    receipt,
    { bun: 5 },
  ]);
  assert.equal(
    Number(
      (
        await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
          ctx.branch,
        ])
      ).rows[0].source_quantity,
    ),
    2,
  );
  const order = (await db.query('select * from kaspi_orders where id=$1', [id])).rows[0];
  assert.equal(order.pos_receipt_due, false);
  assert.equal(order.courier_dispatch_status, null);
});
test('tablet recovery invalidates uncertain counts and an interrupted register recount', async () => {
  const ctx = await fixture(),
    recount = randomUUID();
  await db.query('update front_stock_policies set paused=true,recount_id=$2 where branch_id=$1', [
    ctx.branch,
    recount,
  ]);
  const result = (
    await db.query('select begin_tablet_stock_control($1,$2,$3) result', [
      ctx.branch,
      'cashier',
      randomUUID(),
    ])
  ).rows[0].result;
  assert.equal(result.countsRequired, true);
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        ctx.branch,
      ])
    ).rows[0].source_quantity,
    null,
  );
  assert.equal(
    (await db.query('select recount_id from front_stock_policies where branch_id=$1', [ctx.branch]))
      .rows[0].recount_id,
    null,
  );
});

test('staff badges count every paid active order beyond the page limit and only the assigned branch', async () => {
  const ctx = await fixture(),
    other = await fixture();
  await db.query(
    "insert into kaspi_orders(id,branch_id,fulfillment_type) select gen_random_uuid(),$1,'preorder' from generate_series(1,301)",
    [ctx.branch],
  );
  await db.query(
    "insert into kaspi_orders(id,branch_id,fulfillment_type,kitchen_status,fulfillment_status) values(gen_random_uuid(),$1,'pickup','preparing','preparing'),(gen_random_uuid(),$1,'pickup','ready','ready'),(gen_random_uuid(),$2,'preorder','queued','new')",
    [ctx.branch, other.branch],
  );
  await db.query(
    "insert into kaspi_orders(id,branch_id,refund_status) values(gen_random_uuid(),$1,'processing')",
    [ctx.branch],
  );
  const counts = (await db.query('select staff_order_counts($1) counts', [[ctx.branch]])).rows[0]
    .counts;
  assert.deepEqual(counts, { newOrders: 301, preorders: 301, preparing: 1 });
  assert.deepEqual((await db.query('select staff_order_counts($1) counts', [[]])).rows[0].counts, {
    newOrders: 0,
    preorders: 0,
    preparing: 0,
  });
});

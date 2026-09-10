const test = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const db = new PGlite();
test.before(async () => {
  await require('./helpers/front-stock-schema.cjs')(db);
  for (const name of [
    '20260910143000_front_tablet_stock_control',
    '20260910144000_fractional_inventory',
  ])
    await db.exec(readFileSync('supabase/migrations/' + name + '.sql', 'utf8'));
});
test.after(() => db.close());
async function setup(quantity = 10, step = 1) {
  const branch = randomUUID(),
    terminals = [randomUUID(), randomUUID()];
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
    [branch, terminals],
  );
  for (const terminal of terminals)
    await db.query('select front_stock_heartbeat($1,$2,true)', [branch, terminal]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,quantity_step) values($1,'bun',$2,$3)",
    [branch, quantity, step],
  );
  return { branch, terminals };
}
async function pos(ctx, qty, terminal = ctx.terminals[0]) {
  const receipt = randomUUID(),
    key =
      'bp1:' +
      ctx.branch +
      ':' +
      createHash('sha256')
        .update(ctx.branch + '\0' + receipt)
        .digest('hex');
  return db.query('select authorize_front_stock_sale($1,$2,$3,$4,100,$5)', [
    ctx.branch,
    terminal,
    receipt,
    { bun: qty },
    key,
  ]);
}
async function reserve(ctx, quantity) {
  return db.query('select reserve_order_inventory($1,$2,$3,$4)', [
    randomUUID(),
    randomUUID(),
    ctx.branch,
    [{ id: 'bun', quantity }],
  ]);
}
test('one powered-off register does not block the remaining connected register or online reservations', async () => {
  const ctx = await setup();
  await db.query(
    "update front_stock_terminals set last_seen_at=now()-interval '1 hour' where terminal_id=$1",
    [ctx.terminals[1]],
  );
  await pos(ctx, 2);
  await reserve(ctx, 2);
  await assert.rejects(pos(ctx, 1, ctx.terminals[1]), /касса недоступна/);
});
test('fractional POS and online quantities share the exact same pool without rounding to whole items', async () => {
  const ctx = await setup(1.251, 0.001);
  await pos(ctx, 0.5);
  assert.equal(
    Number(
      (
        await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
          ctx.branch,
        ])
      ).rows[0].source_quantity,
    ),
    0.751,
  );
  await reserve(ctx, 0.75);
  await assert.rejects(pos(ctx, 0.002), /зарезервирован/);
  await assert.rejects(reserve(ctx, 0.001), /Количество|Недостаточно/);
});
test('tablet fallback preserves holds, blocks register starts and allows counted adjustments', async () => {
  const ctx = await setup();
  await reserve(ctx, 3);
  await db.query('select begin_tablet_stock_control($1,$2,$3)', [
    ctx.branch,
    'cashier',
    randomUUID(),
  ]);
  await assert.rejects(pos(ctx, 1), /планшета/);
  await assert.rejects(
    db.query("select update_cashier_inventory($1,'bun','Bun',0,$2)", [
      ctx.branch,
      { sourceQuantity: 2 },
    ]),
    /меньше резерва/,
  );
  await db.query("select update_cashier_inventory($1,'bun','Bun',0,$2)", [
    ctx.branch,
    { sourceQuantity: 8 },
  ]);
  await reserve(ctx, 4);
});
test('unknown outcomes block edits only for affected products, never silently restore units', async () => {
  const ctx = await setup();
  await pos(ctx, 2);
  await db.query('select begin_tablet_stock_control($1,$2,$3)', [
    ctx.branch,
    'cashier',
    randomUUID(),
  ]);
  await assert.rejects(
    db.query("select update_cashier_inventory($1,'bun','Bun',1,$2)", [
      ctx.branch,
      { sourceQuantity: 10 },
    ]),
    /незавершённый/,
  );
  await db.query("select update_cashier_inventory($1,'tea','Tea',0,$2)", [
    ctx.branch,
    { sourceQuantity: 5 },
  ]);
});

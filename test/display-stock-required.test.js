const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { branchProductAvailable } = require('../src/services/branch-catalog-source.service');
const { onlineAvailableQuantity } = require('../src/utils/online-stock.util');
const db = new PGlite();
test.before(async () => {
  await require('./helpers/front-tablet-schema.cjs')(db);
  await require('./helpers/front-refund-schema.cjs')(db);
  for (const name of [
    '20260910147000_preorder_stop_only',
    '20260910148000_tablet_recovery',
    '20260910184000_require_display_stock',
  ]) {
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
  }
});
test.after(() => db.close());
async function fixture(quantity) {
  const branch = randomUUID(),
    customer = randomUUID(),
    request = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  if (quantity !== undefined)
    await db.query(
      "insert into branch_product_inventory(branch_id,product_id,product_name,source_quantity) values($1,'bun','Плюшка',$2)",
      [branch, quantity],
    );
  return { branch, customer, request };
}
const reserve = (ctx, quantity = 1) =>
  db.query('select reserve_order_inventory($1,$2,$3,$4) result', [
    ctx.customer,
    ctx.request,
    ctx.branch,
    [{ id: 'bun', quantity }],
  ]);

test('missing and uncounted display stock cannot reserve before payment', async () => {
  for (const quantity of [undefined, null]) {
    const ctx = await fixture(quantity);
    await assert.rejects(reserve(ctx), /остаток не указан/);
    assert.equal(
      (
        await db.query('select count(*)::int n from inventory_reservations where branch_id=$1', [
          ctx.branch,
        ])
      ).rows[0].n,
      0,
    );
  }
});

test('counted stock still protects the final unit and aggregate quantity', async () => {
  for (const quantity of [0, 1])
    await assert.rejects(reserve(await fixture(quantity)), /Недостаточно товара/);
  const ctx = await fixture(6);
  await reserve(ctx, 5);
  await reserve(ctx, 5);
  await assert.rejects(
    reserve({ ...ctx, customer: randomUUID(), request: randomUUID() }),
    /Недостаточно товара/,
  );
});

test('clearing a balance before a late payment cannot commit or reacquire unknown stock', async () => {
  const ctx = await fixture(6),
    order = randomUUID();
  await reserve(ctx, 2);
  await db.query('insert into kaspi_orders(id,branch_id) values($1,$2)', [order, ctx.branch]);
  await db.query('update inventory_reservations set order_id=$1 where client_request_id=$2', [
    order,
    ctx.request,
  ]);
  await db.query('update branch_product_inventory set source_quantity=null where branch_id=$1', [
    ctx.branch,
  ]);
  for (const reacquire of [false, true]) {
    const result = (
      await db.query('select commit_order_reservations($1,$2) result', [order, reacquire])
    ).rows[0].result;
    assert.equal(result.status, 'unavailable');
    assert.equal(result.reason, 'inventory_unknown');
  }
});

test('preorders remain stop-list-only with no display count', async () => {
  const ctx = await fixture(null);
  await db.query("select reserve_preorder_inventory($1,$2,$3,$4,now()+interval '25 hours')", [
    ctx.customer,
    ctx.request,
    ctx.branch,
    [{ id: 'bun', quantity: 5 }],
  ]);
  assert.equal(
    (
      await db.query('select allocation_kind from inventory_reservations where branch_id=$1', [
        ctx.branch,
      ])
    ).rows[0].allocation_kind,
    'preorder',
  );
  await db.query('update branch_product_inventory set preorder_stop=true where branch_id=$1', [
    ctx.branch,
  ]);
  await assert.rejects(
    db.query("select reserve_preorder_inventory($1,$2,$3,$4,now()+interval '25 hours')", [
      ctx.customer,
      randomUUID(),
      ctx.branch,
      [{ id: 'bun', quantity: 1 }],
    ]),
    /временно недоступен/,
  );
});

test('catalogs fail closed for missing display rows, preserving preorder availability', () => {
  assert.equal(onlineAvailableQuantity(null), 0);
  assert.equal(onlineAvailableQuantity(undefined), 0);
  const missing = new Map();
  for (const frontSync of [{ configured: false }, { configured: true, connected: true }]) {
    missing.frontSync = frontSync;
    assert.equal(branchProductAvailable(missing, 'bun'), false);
  }
  missing.preorder = true;
  assert.equal(branchProductAvailable(missing, 'bun'), true);
});

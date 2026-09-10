const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
test.before(() => require('./helpers/front-stock-schema.cjs')(db));
test.after(() => db.close());
async function setup(quantity = 10, registers = 2) {
  const branch = randomUUID(),
    terminals = Array.from({ length: registers }, () => randomUUID());
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    'insert into branch_product_inventory(branch_id,product_id,source_quantity,front_quantity,front_managed) values($1,$2,$3,$3,true)',
    [branch, 'bun', quantity],
  );
  await db.query(
    'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
    [branch, terminals],
  );
  for (const terminal of terminals)
    await db.query('select front_stock_heartbeat($1,$2,true)', [branch, terminal]);
  return { branch, terminals };
}
const key = (branch, receipt) =>
  `bp1:${branch}:${createHash('sha256').update(`${branch}\0${receipt}`).digest('hex')}`;
async function reserve(ctx, quantity = 5, request = randomUUID()) {
  return db.query('select reserve_order_inventory($1,$2,$3,$4)', [
    randomUUID(),
    request,
    ctx.branch,
    [{ id: 'bun', quantity }],
  ]);
}
async function pos(
  ctx,
  quantity = 5,
  receipt = randomUUID(),
  terminal = ctx.terminals[0],
  number = null,
  total = 35,
) {
  const result = await db.query('select authorize_front_stock_sale($1,$2,$3,$4,$5,$6,$7) data', [
    ctx.branch,
    terminal,
    receipt,
    { bun: quantity },
    total,
    key(ctx.branch, receipt),
    number,
  ]);
  return { receipt, terminal, quantity, total, result: result.rows[0].data };
}
async function finish(ctx, sale, state = 'closed') {
  return db.query('select finish_front_stock_sale($1,$2,$3,$4,$5,$6) data', [
    ctx.branch,
    sale.terminal,
    sale.receipt,
    state,
    { bun: sale.quantity },
    sale.total,
  ]);
}
async function count(ctx) {
  return (
    await db.query(
      'select source_quantity from branch_product_inventory where branch_id=$1 and product_id=$2',
      [ctx.branch, 'bun'],
    )
  ).rows[0].source_quantity;
}
async function online(ctx, quantity = 5) {
  await reserve(ctx, quantity);
  const order = randomUUID();
  await db.query(
    "insert into kaspi_orders(id,branch_id,order_number,fulfillment_status) values($1,$2,100001,'preparing')",
    [order, ctx.branch],
  );
  await db.query(
    "update inventory_reservations set order_id=$2,status='committed' where branch_id=$1",
    [ctx.branch, order],
  );
  return order;
}

test('the first confirmed allocation wins: online five prevents both registers from selling the same five', async () => {
  const ctx = await setup(6);
  await reserve(ctx);
  for (const terminal of ctx.terminals)
    await assert.rejects(pos(ctx, 5, randomUUID(), terminal), /Товар уже зарезервирован/);
  await pos(ctx, 1);
  assert.equal(await count(ctx), 5);
});

test('tablet acceptance of a committed paid order remains available when all Front terminals are offline', async () => {
  const ctx = await setup(6);
  const id = await online(ctx);
  await db.query("update kaspi_orders set fulfillment_status='new' where id=$1", [id]);
  await db.query(
    "update front_stock_terminals set last_seen_at=now()-interval '1 hour' where branch_id=$1",
    [ctx.branch],
  );
  await db.query(
    "update kaspi_orders set fulfillment_status='preparing',kitchen_status='preparing' where id=$1",
    [id],
  );
  assert.equal(
    (await db.query('select fulfillment_status from kaspi_orders where id=$1', [id])).rows[0]
      .fulfillment_status,
    'preparing',
  );
  await assert.rejects(reserve(ctx, 1), /касс|связ|учёт/);
  assert.equal(
    (
      await db.query(
        "select sum(quantity) units from inventory_reservations where order_id=$1 and status='committed'",
        [id],
      )
    ).rows[0].units,
    5,
  );
});
test('register wins first: debit is durable before payment and online cannot pay for those units', async () => {
  const ctx = await setup(6);
  await pos(ctx, 5);
  assert.equal(await count(ctx), 1);
  await assert.rejects(reserve(ctx, 1), /Недостаточно товара/);
});

test('online five remains reserved when the last walk-in unit sells before payment settles', async () => {
  const ctx = await setup(6);
  await reserve(ctx, 5);
  const orderId = randomUUID();
  await db.query('insert into kaspi_orders(id,branch_id) values($1,$2)', [orderId, ctx.branch]);
  await db.query('update inventory_reservations set order_id=$2 where branch_id=$1', [
    ctx.branch,
    orderId,
  ]);
  await pos(ctx, 1);
  await db.query(
    "update front_stock_terminals set last_seen_at=now()-interval '1 hour' where branch_id=$1",
    [ctx.branch],
  );
  const result = (await db.query('select commit_order_reservations($1,true) data', [orderId]))
    .rows[0].data;
  assert.equal(result.status, 'committed');
  assert.equal(result.inventoryUnitsCommitted, 5);
  assert.equal(await count(ctx), 5);
});

test('an expired hold must reacquire and cannot consume the final walk-in unit', async () => {
  const ctx = await setup(6);
  await reserve(ctx, 5);
  const orderId = randomUUID();
  await db.query('insert into kaspi_orders(id,branch_id) values($1,$2)', [orderId, ctx.branch]);
  await db.query('update inventory_reservations set order_id=$2 where branch_id=$1', [
    ctx.branch,
    orderId,
  ]);
  await pos(ctx, 1);
  await db.query(
    "update inventory_reservations set status='expired',expires_at=now()-interval '1 second' where order_id=$1",
    [orderId],
  );
  const result = (await db.query('select commit_order_reservations($1,true) data', [orderId]))
    .rows[0].data;
  assert.equal(result.status, 'unavailable');
});
test('two registers cannot allocate five each from six units', async () => {
  const ctx = await setup(6);
  const results = await Promise.allSettled(ctx.terminals.map((t) => pos(ctx, 5, randomUUID(), t)));
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(await count(ctx), 1);
});
test('lost response retries use the receipt ID and debit exactly once', async () => {
  const ctx = await setup(10),
    receipt = randomUUID();
  await pos(ctx, 5, receipt);
  assert.equal((await pos(ctx, 5, receipt)).result.duplicate, true);
  assert.equal(await count(ctx), 5);
  await assert.rejects(pos(ctx, 4, receipt), /другим составом/);
  await assert.rejects(pos(ctx, 5, receipt, ctx.terminals[1]), /другим составом/);
});
test('offline payment adjustments do not debit stock twice', async () => {
  const ctx = await setup(),
    receipt = randomUUID();
  await pos(ctx, 5, receipt);
  const adjusted = await pos(ctx, 5, receipt, ctx.terminals[0], null, 25);
  await finish(ctx, adjusted);
  assert.equal(await count(ctx), 5);
});
test('unknown POS outcome never expires into available stock, even after restart or a day', async () => {
  const ctx = await setup(6),
    sale = await pos(ctx);
  await db.query(
    "update front_stock_sales set created_at=now()-interval '1 day' where branch_id=$1",
    [ctx.branch],
  );
  await assert.rejects(reserve(ctx, 1), /Недостаточно товара/);
  await finish(ctx, sale);
  await finish(ctx, sale);
  await assert.rejects(finish(ctx, sale, 'voided'), /Итог чека уже зафиксирован/);
  assert.equal(await count(ctx), 1);
});
test('a voided cheque does not automatically assume products were physically returned', async () => {
  const ctx = await setup(),
    sale = await pos(ctx);
  await finish(ctx, sale, 'voided');
  await finish(ctx, sale, 'voided');
  assert.equal(await count(ctx), 5);
  await assert.rejects(pos(ctx, 5, sale.receipt), /Чек уже завершён/);
});
test('both online and POS stop when either register is offline; completion can still reconcile', async () => {
  const ctx = await setup(),
    sale = await pos(ctx, 1);
  await db.query(
    "update front_stock_terminals set last_seen_at=now()-interval '1 minute' where terminal_id=$1",
    [ctx.terminals[1]],
  );
  await assert.rejects(reserve(ctx, 1), /нет связи/);
  await assert.rejects(pos(ctx, 1), /нет связи/);
  await finish(ctx, sale);
  await db.query('select front_stock_heartbeat($1,$2,true)', [ctx.branch, ctx.terminals[1]]);
  await reserve(ctx, 1);
});
test('unknown quantities, unsupported receipt data and unregistered terminals cannot authorize a sale', async () => {
  const ctx = await setup(null);
  await assert.rejects(reserve(ctx, 1), /Количество товара не подтверждено/);
  await assert.rejects(pos(ctx, 1), /Нет подтверждённого остатка/);
  await assert.rejects(pos(ctx, 1, randomUUID(), randomUUID()), /Некорректный чек/);
});
test('late Front snapshots and routine stock edits cannot resurrect a POS debit', async () => {
  const ctx = await setup(10);
  await pos(ctx, 5);
  await db.query('select apply_front_inventory_snapshot($1,$2,$3,$4,1,now(),$5)', [
    ctx.branch,
    ctx.terminals[0],
    randomUUID(),
    randomUUID(),
    [{ productId: 'bun', quantity: 10 }],
  ]);
  assert.equal(await count(ctx), 5);
  await assert.rejects(
    db.query(
      'update branch_product_inventory set source_quantity=20,source=$2 where branch_id=$1',
      [ctx.branch, 'admin'],
    ),
    /Используйте сверку/,
  );
});
test('paid online order binds to exactly one matching cheque and does not debit twice', async () => {
  const ctx = await setup(6),
    order = await online(ctx);
  const sale = await pos(ctx, 5, randomUUID(), ctx.terminals[0], 100001);
  assert.equal(await count(ctx), 6);
  await assert.rejects(pos(ctx, 5, randomUUID(), ctx.terminals[1], 100001), /duplicate key/);
  await assert.rejects(pos(ctx, 4, randomUUID(), ctx.terminals[0], 100001), /Состав чека/);
  await assert.rejects(
    db.query("update kaspi_orders set fulfillment_status='completed' where id=$1", [order]),
    /Сначала пробейте/,
  );
  await assert.rejects(
    db.query("update kaspi_orders set refund_status='processing' where id=$1", [order]),
    /Сначала завершите/,
  );
  await finish(ctx, sale);
  await finish(ctx, sale);
  assert.equal(await count(ctx), 1);
  assert.equal(
    (
      await db.query(
        "select count(*) n from inventory_reservations where order_id=$1 and status='committed'",
        [order],
      )
    ).rows[0].n,
    0,
  );
  await db.query("update kaspi_orders set fulfillment_status='completed' where id=$1", [order]);
  assert.equal(await count(ctx), 1);
});
test('linked cheques cannot earn or spend loyalty a second time, including a queued retry', async () => {
  const ctx = await setup(6);
  await online(ctx);
  const sale = await pos(ctx, 5, randomUUID(), ctx.terminals[0], 100001);
  for (const id of [sale.receipt, key(ctx.branch, sale.receipt)])
    await assert.rejects(
      db.query("insert into loyalty_reservations(order_id,status) values($1,'active')", [id]),
      /уже учтены/,
    );
});
test('a prior loyalty operation must be resolved before binding the same cheque online', async () => {
  const ctx = await setup(6);
  await online(ctx);
  const receipt = randomUUID();
  await db.query("insert into loyalty_reservations(order_id,status) values($1,'active')", [
    key(ctx.branch, receipt),
  ]);
  await assert.rejects(
    pos(ctx, 5, receipt, ctx.terminals[0], 100001),
    /отдельную бонусную операцию/,
  );
});
test('after a void, paid goods stay withheld until a recount confirms their physical return', async () => {
  const ctx = await setup(6);
  await online(ctx);
  const sale = await pos(ctx, 5, randomUUID(), ctx.terminals[0], 100001);
  await finish(ctx, sale, 'voided');
  assert.equal(await count(ctx), 1);
  await assert.rejects(pos(ctx, 5, randomUUID(), ctx.terminals[1], 100001), /требует сверки/);
  await recount(ctx, 6);
  const replacement = await pos(ctx, 5, randomUUID(), ctx.terminals[1], 100001);
  await finish(ctx, replacement);
  assert.equal(await count(ctx), 1);
});

async function syncIdentity(ctx) {
  await db.query(
    'insert into branch_front_inventory_sync values($1,$2,$3,$4,1,now(),now()) on conflict(branch_id) do nothing',
    [ctx.branch, ctx.terminals[0], randomUUID(), randomUUID()],
  );
}
async function recount(ctx, quantity, id = randomUUID()) {
  await syncIdentity(ctx);
  const begun = (
    await db.query('select begin_front_stock_recount($1,$2,$3) data', [
      ctx.branch,
      ctx.terminals[0],
      id,
    ])
  ).rows[0].data;
  if (begun.status === 'completed') return begun;
  return (
    await db.query('select finish_front_stock_recount($1,$2,$3,$4) data', [
      ctx.branch,
      ctx.terminals[0],
      begun.recountId,
      [{ productId: 'bun', productName: 'Булочка', quantity }],
    ])
  ).rows[0].data;
}
test('recount pauses sales and cannot forget ambiguous receipts or paid online goods', async () => {
  const ctx = await setup(10),
    sale = await pos(ctx, 2);
  await assert.rejects(recount(ctx, 20), /незавершённые чеки/);
  await finish(ctx, sale);
  await online(ctx, 5);
  await assert.rejects(recount(ctx, 4), /не хватает/);
  assert.equal(
    (await db.query('select front_stock_ready($1) ready', [ctx.branch])).rows[0].ready,
    false,
  );
  await assert.rejects(reserve(ctx, 1), /приостановлены/);
  await recount(ctx, 20);
  assert.equal(await count(ctx), 20);
  assert.equal(
    (await db.query('select front_stock_ready($1) ready', [ctx.branch])).rows[0].ready,
    true,
  );
});
test('recount is idempotent after losing the response and does not re-add the refill', async () => {
  const ctx = await setup(6),
    id = randomUUID();
  await recount(ctx, 20, id);
  await pos(ctx, 5);
  await recount(ctx, 20, id);
  assert.equal(await count(ctx), 15);
});
test('missing Front counts or an unexplained loss automatically pause strict sales', async () => {
  const ctx = await setup(10);
  await db.query('select apply_front_inventory_snapshot($1,$2,$3,$4,1,now(),$5)', [
    ctx.branch,
    ctx.terminals[0],
    randomUUID(),
    randomUUID(),
    [{ productId: 'bun', quantity: 5 }],
  ]);
  assert.equal(
    (await db.query('select front_stock_ready($1) ready', [ctx.branch])).rows[0].ready,
    false,
  );
  await assert.rejects(pos(ctx, 1), /приостановлены/);
});
test('activation requires all physical registers, a fresh main register and a confirmed count', async () => {
  const ctx = await setup(10);
  await db.query('update front_stock_policies set enabled=false where branch_id=$1', [ctx.branch]);
  await assert.rejects(
    db.query('select enable_front_stock_guard($1,$2,true)', [ctx.branch, ctx.terminals]),
    /Не все кассы/,
  );
  await syncIdentity(ctx);
  await assert.rejects(
    db.query('select enable_front_stock_guard($1,$2,false)', [ctx.branch, ctx.terminals]),
    /Подтвердите/,
  );
  await db.query('select enable_front_stock_guard($1,$2,true)', [ctx.branch, ctx.terminals]);
  await assert.rejects(
    db.query('select enable_front_stock_guard($1,$2,true)', [ctx.branch, [ctx.terminals[0]]]),
    /уже включён/,
  );
});
test('branch identities and online amounts are checked before allocating or linking', async () => {
  const ctx = await setup(6),
    other = await setup(6);
  await online(ctx);
  await assert.rejects(
    pos(other, 5, randomUUID(), other.terminals[0], 100001),
    /Онлайн-заказ недоступен/,
  );
  await assert.rejects(pos(ctx, 5, randomUUID(), ctx.terminals[0], 100001, 34), /Сумма товаров/);
  assert.equal(await count(ctx), 6);
  assert.equal(await count(other), 6);
});

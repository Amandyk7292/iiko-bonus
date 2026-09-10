const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const {
  frontAutoReceiptActionSchema,
  frontOfflineReceiptSchema,
} = require('../src/contracts/front-auto-receipt.contract');
async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await require('./helpers/front-tablet-schema.cjs')(db);
  await require('./helpers/front-refund-schema.cjs')(db);
  for (const name of ['20260910147000_preorder_stop_only', '20260910148000_tablet_recovery'])
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
  await db.exec(
    'create table pos_devices(branch_id uuid,terminal_id uuid,active boolean default true)',
  );
  for (const name of [
    '20260910210000_front_automatic_receipts',
    '20260910211000_front_offline_receipts',
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
  const branch = randomUUID(),
    otherBranch = randomUUID(),
    first = randomUUID(),
    second = randomUUID(),
    product = randomUUID();
  await db.query('insert into bulka_locations(id) values($1),($2)', [branch, otherBranch]);
  await db.query('insert into pos_devices(branch_id,terminal_id) values($1,$2),($1,$3)', [
    branch,
    first,
    second,
  ]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,source,manual_counted_at) values($1,$2,10,'admin',now()-interval '1 day')",
    [branch, product],
  );
  const quantity = async () =>
    (
      await db.query(
        'select source_quantity from branch_product_inventory where branch_id=$1 and product_id=$2',
        [branch, product],
      )
    ).rows[0].source_quantity;
  async function order() {
    const id = randomUUID();
    await db.query(
      "insert into kaspi_orders(id,branch_id,order_number,fulfillment_status,kitchen_status,subtotal) values($1,$2,100045,'ready','ready',35)",
      [id, branch],
    );
    await db.query(
      "insert into inventory_reservations(order_id,branch_id,product_id,quantity,status) values($1,$2,$3,1,'committed')",
      [id, branch, product],
    );
    return id;
  }
  const action = async (id, terminal, name, receipt = null, items = null, total = null) =>
    (
      await db.query('select front_receipt_job_action($1,$2,$3,$4,$5,$6,$7) r', [
        branch,
        terminal,
        id,
        name,
        receipt,
        items,
        total,
      ])
    ).rows[0].r;
  const sale = async (
    receipt,
    terminal = first,
    items = { [product]: 2 },
    time = new Date().toISOString(),
  ) =>
    (
      await db.query('select record_front_offline_receipt($1,$2,$3,$4,$5,$6) r', [
        branch,
        terminal,
        receipt,
        time,
        items,
        70,
      ])
    ).rows[0].r;
  return { db, branch, otherBranch, first, second, product, quantity, order, action, sale };
}
test('external receipt owner and UUID survive retries; second register, wrong items, sum and refund are blocked', async (t) => {
  const f = await fixture(t),
    id = await f.order(),
    receipt = randomUUID();
  await f.db.query(
    "update kaspi_orders set kitchen_status='handed_over',fulfillment_status='completed' where id=$1",
    [id],
  );
  assert.equal((await f.action(id, f.first, 'claim')).status, 'assigned');
  await assert.rejects(f.action(id, f.second, 'claim'), /другой кассой/);
  await f.action(id, f.first, 'bind', receipt);
  assert.equal((await f.action(id, f.first, 'claim')).receiptId, receipt);
  await assert.rejects(f.action(id, f.first, 'bind', randomUUID()), /другим чеком/);
  await assert.rejects(
    f.action(id, f.first, 'verify', receipt, { [f.product]: 2 }, 35),
    /Состав или сумма/,
  );
  await assert.rejects(
    f.action(id, f.first, 'verify', receipt, { [f.product]: 1 }, 36),
    /Состав или сумма/,
  );
  assert.equal(
    (await f.action(id, f.first, 'verify', receipt, { [f.product]: 1 }, 35)).status,
    'verified',
  );
  assert.equal((await f.sale(receipt)).reason, 'already_accounted');
  assert.equal(Number(await f.quantity()), 10);
  await f.action(id, f.first, 'complete', receipt, { [f.product]: 1 }, 35);
  await f.action(id, f.first, 'complete', receipt, { [f.product]: 1 }, 35);
  await assert.rejects(
    f.action(id, f.first, 'verify', receipt, { [f.product]: 1 }, 35),
    /уже закрыт/,
  );
  assert.equal(
    (await f.db.query('select pos_receipt_due from kaspi_orders where id=$1', [id])).rows[0]
      .pos_receipt_due,
    false,
  );
  await assert.rejects(f.action(id, f.first, 'return', receipt), /Сначала оформите/);
  await f.db.query("update kaspi_orders set refund_status='succeeded' where id=$1", [id]);
  await assert.rejects(
    f.action(id, f.first, 'return', receipt, { [f.product]: 1 }, 36),
    /Состав или сумма возврата/,
  );
  await assert.rejects(
    f.action(id, f.first, 'return', receipt, { [f.product]: 2 }, 35),
    /Состав или сумма возврата/,
  );
  assert.equal(
    (await f.action(id, f.first, 'return', receipt, { [f.product]: 1 }, 35)).status,
    'refunded',
  );
  await assert.rejects(
    f.db.query('select front_receipt_job_action($1,$2,$3,$4)', [
      f.otherBranch,
      f.first,
      id,
      'claim',
    ]),
    /не привязана/,
  );
});
test('ordinary sales decrement manual inventory once across both registers; late receipts do not overwrite a recount', async (t) => {
  const f = await fixture(t),
    receipt = randomUUID();
  assert.equal((await f.sale(receipt)).changed, true);
  assert.equal(Number(await f.quantity()), 8);
  assert.equal((await f.sale(receipt, f.second)).duplicate, true);
  assert.equal(Number(await f.quantity()), 8);
  await assert.rejects(f.sale(receipt, f.first, { [f.product]: 3 }), /чек изменился/);
  await f.db.query(
    'update branch_product_inventory set source_quantity=7,manual_counted_at=now() where branch_id=$1',
    [f.branch],
  );
  assert.equal(
    (
      await f.sale(
        randomUUID(),
        f.second,
        { [f.product]: 5 },
        new Date(Date.now() - 60000).toISOString(),
      )
    ).changed,
    false,
  );
  assert.equal(Number(await f.quantity()), 7);
  await f.sale(
    randomUUID(),
    f.second,
    { [f.product]: 0.125 },
    new Date(Date.now() + 1000).toISOString(),
  );
  assert.equal(Number(await f.quantity()), 6.875);
  await f.db.exec("begin; select set_config('bulka.stock_follow_iiko','true',true)");
  await f.db.query(
    "update branch_product_inventory set source='iiko',source_quantity=5 where branch_id=$1",
    [f.branch],
  );
  await f.db.exec('commit');
  assert.equal((await f.sale(randomUUID())).changed, false);
  assert.equal(Number(await f.quantity()), 5);
});
test('unpaid/cancelled orders do not queue; historical handovers and unrelated updates do not create extra receipts', async (t) => {
  const f = await fixture(t),
    id = await f.order();
  await f.db.query(
    "update kaspi_orders set status='pending',kitchen_status='handed_over' where id=$1",
    [id],
  );
  assert.equal((await f.db.query('select count(*) n from front_receipt_jobs')).rows[0].n, 0);
  await f.db.query("update kaspi_orders set status='paid' where id=$1", [id]);
  assert.equal((await f.db.query('select count(*) n from front_receipt_jobs')).rows[0].n, 0);
});
test('receipt contracts reject branch spoofing and incomplete validation requests', () => {
  const body = { terminalId: randomUUID(), orderId: randomUUID(), action: 'verify' };
  assert.equal(frontAutoReceiptActionSchema.safeParse(body).success, false);
  assert.equal(frontAutoReceiptActionSchema.safeParse({ ...body, action: 'claim' }).success, true);
  assert.equal(
    frontAutoReceiptActionSchema.safeParse({ ...body, action: 'claim', branchId: randomUUID() })
      .success,
    false,
  );
  assert.equal(
    frontOfflineReceiptSchema.safeParse({
      terminalId: body.terminalId,
      receiptId: randomUUID(),
      items: [{ productId: randomUUID(), quantity: 0.125 }],
      total: 35,
      closedAt: new Date().toISOString(),
    }).success,
    true,
  );
});
test('strict shared inventory settles assembled goods once and allows courier handover before the deferred receipt', async (t) => {
  const f = await fixture(t),
    id = await f.order(),
    receipt = randomUUID();
  await f.db.query(
    "update kaspi_orders set kitchen_status='preparing',fulfillment_status='preparing',fulfillment_type='delivery' where id=$1",
    [id],
  );
  await f.db.query(
    "insert into front_stock_policies(branch_id,enabled,terminal_ids,control_mode) values($1,true,$2,'front')",
    [f.branch, [f.first, f.second]],
  );
  await f.db.query(
    "update kaspi_orders set kitchen_status='ready',fulfillment_status='ready' where id=$1",
    [id],
  );
  assert.equal(Number(await f.quantity()), 9);
  assert.equal(
    (await f.db.query('select front_delivery_receipt_ready($1,$2) ready', [f.branch, id])).rows[0]
      .ready,
    true,
  );
  await f.db.query("update kaspi_orders set kitchen_status='handed_over' where id=$1", [id]);
  await f.action(id, f.first, 'claim');
  await f.action(id, f.first, 'bind', receipt);
  await f.action(id, f.first, 'verify', receipt, { [f.product]: 1 }, 35);
  await f.action(id, f.first, 'complete', receipt, { [f.product]: 1 }, 35);
  assert.equal(Number(await f.quantity()), 9);
});

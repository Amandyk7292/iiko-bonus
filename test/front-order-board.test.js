const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const {
  frontBoardQuerySchema,
  frontBoardActionSchema,
} = require('../src/contracts/front-order-board.contract');
const { PGlite } = require('@electric-sql/pglite');
const { readFileSync } = require('node:fs');

test('board permits only scoped transitions, with no customer code or arbitrary status', () => {
  const body = { orderId: randomUUID(), terminalId: randomUUID(), action: 'hand_over' };
  assert.equal(frontBoardActionSchema.safeParse(body).success, true);
  for (const change of [{ action: 'completed' }, { branchId: randomUUID() }, { pin: '123456' }])
    assert.equal(frontBoardActionSchema.safeParse({ ...body, ...change }).success, false);
  assert.equal(frontBoardQuerySchema.safeParse({ new: '2' }).success, true);
  assert.equal(frontBoardQuerySchema.safeParse({ new: '0' }).success, false);
});

test('board polling includes changes on other registers, stays small and isolates branches', async () => {
  const db = new PGlite();
  try {
    await require('./helpers/front-tablet-schema.cjs')(db);
    await db.exec(`alter table delivery_jobs add column updated_at timestamptz default now();
      alter table kaspi_orders add column if not exists created_at timestamptz default now();`);
    const polling = readFileSync(
      'supabase/migrations/20260910132000_front_tablet_fallback.sql',
      'utf8',
    );
    await db.exec(
      polling.slice(
        0,
        polling.indexOf('create or replace function public.enqueue_staff_push_reminder'),
      ),
    );
    await db.exec(readFileSync('supabase/migrations/20260910185000_front_order_board.sql', 'utf8'));
    await db.exec(
      readFileSync('supabase/migrations/20260910203000_front_order_alert_number.sql', 'utf8'),
    );
    const branch = randomUUID(),
      foreign = randomUUID(),
      terminal = randomUUID(),
      order = randomUUID();
    await db.query('insert into bulka_locations(id) values($1),($2)', [branch, foreign]);
    const poll = async () =>
      (await db.query('select poll_front_order_board($1,$2) r', [branch, terminal])).rows[0].r;
    const empty = await poll();
    await db.query(
      "insert into kaspi_orders(id,branch_id,status,order_number) values($1,$2,'paid',100010)",
      [order, branch],
    );
    const added = await poll();
    assert.equal(added.total, 1);
    assert.equal(added.newestOrderNumber, 100010);
    assert.notEqual(empty.revision, added.revision);
    await db.query(
      "insert into kaspi_orders(id,branch_id,status,order_number) values($1,$2,'paid',100011)",
      [randomUUID(), foreign],
    );
    assert.equal((await poll()).revision, added.revision);
    assert.equal((await poll()).newestOrderNumber, 100010);
    await db.query(
      "update kaspi_orders set fulfillment_status='preparing',kitchen_status='preparing' where id=$1",
      [order],
    );
    const accepted = await poll();
    assert.equal(accepted.total, 0);
    assert.equal(accepted.newestOrderNumber, 0);
    assert.notEqual(accepted.revision, added.revision);
    await db.query('insert into delivery_jobs(order_id) values($1)', [order]);
    assert.notEqual((await poll()).revision, accepted.revision);
    assert.ok(JSON.stringify(await poll()).length < 250);
    const second = randomUUID();
    await db.query(
      "insert into kaspi_orders(id,branch_id,status,order_number,created_at) values($1,$2,'paid',100012,now()-interval '1 minute'),($3,$2,'paid',100013,now())",
      [randomUUID(), branch, second],
    );
    const beforeReplacement = await poll();
    await db.query("update kaspi_orders set fulfillment_status='preparing' where id=$1", [second]);
    await db.query(
      "insert into kaspi_orders(id,branch_id,status,order_number) values($1,$2,'paid',100014)",
      [randomUUID(), branch],
    );
    const replaced = await poll();
    assert.equal(replaced.total, beforeReplacement.total);
    assert.equal(replaced.orders[0].id, beforeReplacement.orders[0].id);
    assert.equal(replaced.newestOrderNumber, 100014);
    await assert.rejects(
      db.query('select poll_front_order_board($1,$2)', [randomUUID(), terminal]),
      /не активен/,
    );
  } finally {
    await db.close();
  }
});

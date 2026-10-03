const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { receiptDraft } = require('../src/services/front-receipt-draft.service');
const { remainingOrder } = require('../src/services/front-remaining-order.service');

async function fixture(
  t,
  { quantity = 2, price = 300, discount = 0, bonus = 0, delivery = 0, resolution = false } = {},
) {
  const db = new PGlite();
  t.after(() => db.close());
  await require('./helpers/front-tablet-schema.cjs')(db);
  await require('./helpers/front-refund-schema.cjs')(db);
  for (const file of ['20260910147000_preorder_stop_only', '20260910148000_tablet_recovery'])
    await db.exec(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
  await db.exec(`create table pos_devices(branch_id uuid,terminal_id uuid,active boolean default true);
    create table front_order_inbox_terminals(branch_id uuid,terminal_id uuid,last_seen_at timestamptz,primary key(branch_id,terminal_id));
    create table order_partial_refund_adjustments(order_id uuid,spent_bonus_restored numeric);
    alter table delivery_jobs add column updated_at timestamptz default now();`);
  await db.exec(
    readFileSync('supabase/migrations/20260910210000_front_automatic_receipts.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260915110000_front_remaining_receipts.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260924030000_front_assembly_tickets.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260924040000_assembly_preserve_refunds.sql', 'utf8'),
  );
  if (resolution) {
    await db.exec('alter table kaspi_orders add column delivery_resolution jsonb');
    await db.exec(
      readFileSync(
        'supabase/migrations/20261003161000_delivery_resolution_print_guard.sql',
        'utf8',
      ),
    );
    const feeSql = readFileSync(
      'supabase/migrations/20261003162000_delivery_fee_loyalty_adjustment.sql',
      'utf8',
    );
    const start = feeSql.indexOf('create or replace function public.claim_partial_refund(');
    await db.exec(feeSql.slice(start, feeSql.indexOf('\n$$;', start) + 4));
    await db.exec(`alter table order_partial_refunds add column if not exists provider_reference text,
      add column if not exists kaspi_reference text,add column if not exists last_reconciled_at timestamptz,
      add column if not exists next_reconcile_at timestamptz,add column if not exists updated_at timestamptz default now();
      alter table kaspi_orders add column if not exists refund_amount numeric,add column if not exists refund_reference text,
        add column if not exists refunded_at timestamptz;`);
    const complete = feeSql.indexOf('create or replace function public.complete_partial_refund(');
    await db.exec(feeSql.slice(complete, feeSql.indexOf('\n$$;', complete) + 4));
  }
  const branch = randomUUID(),
    terminal = randomUUID(),
    id = randomUUID(),
    product = randomUUID();
  const gross = Math.round(quantity * price);
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query('insert into pos_devices(branch_id,terminal_id) values($1,$2)', [
    branch,
    terminal,
  ]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,quantity_step,unit) values($1,$2,10,0.001,'кг')",
    [branch, product],
  );
  await db.query(
    `insert into kaspi_orders(id,branch_id,order_number,fulfillment_status,kitchen_status,cart_items,subtotal,amount,discount_amount,bonus_spent,delivery_fee)
    values($1,$2,123456,'preparing','preparing',$3,$4,$5,$6,$7,$8)`,
    [
      id,
      branch,
      [
        {
          id: product,
          iikoProductId: product,
          name: 'Test product',
          price,
          quantity,
          lineTotal: gross,
          quantityStep: 0.001,
        },
      ],
      gross,
      gross - discount - bonus + delivery,
      discount,
      bonus,
      delivery,
    ],
  );
  await db.query(
    "insert into inventory_reservations(order_id,branch_id,product_id,quantity,status) values($1,$2,$3,$4,'committed')",
    [id, branch, product, quantity],
  );
  async function refund(qty, amount) {
    const rid = randomUUID();
    await db.query(
      "insert into order_partial_refunds(id,order_id,status,amount) values($1,$2,'succeeded',$3)",
      [rid, id, amount],
    );
    await db.query(
      'insert into order_partial_refund_items(refund_id,product_id,line_key,quantity,refund_amount) values($1,$2,$3,$4,$5)',
      [rid, product, `${product}:0`, qty, amount],
    );
    await db.query(
      "update kaspi_orders set refund_status='partial',partially_refunded_amount=partially_refunded_amount+$2 where id=$1",
      [id, amount],
    );
    return rid;
  }
  const snapshot = async () =>
    (await db.query('select front_remaining_receipt($1) r', [id])).rows[0].r;
  const quantityLeft = async () =>
    Number(
      (
        await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
          branch,
        ])
      ).rows[0].source_quantity,
    );
  return { db, id, branch, terminal, product, refund, snapshot, quantityLeft };
}

test('accept queues assembly once, locks one register and delays fiscal payment until handover', async (t) => {
  const f = await fixture(t);
  const receipt = randomUUID(),
    second = randomUUID();
  await f.db.query('insert into pos_devices(branch_id,terminal_id) values($1,$2)', [
    f.branch,
    second,
  ]);
  await f.db.query("update kaspi_orders set kitchen_status='queued' where id=$1", [f.id]);
  await f.db.query("update kaspi_orders set kitchen_status='preparing' where id=$1", [f.id]);
  const read = async () =>
    (await f.db.query('select * from front_receipt_jobs where order_id=$1', [f.id])).rows[0];
  assert.equal((await read()).fiscal_due, false);
  assert.equal((await read()).assembly_status, 'pending');
  // An accepted job must survive a multi-day register outage.
  await f.db.query(
    "update front_receipt_jobs set created_at=now()-interval '48 hours',updated_at=now()-interval '48 hours' where order_id=$1",
    [f.id],
  );
  const act = async (action, terminal = f.terminal) =>
    (
      await f.db.query('select front_receipt_job_action($1,$2,$3,$4,$5,$6,$7) r', [
        f.branch,
        terminal,
        f.id,
        action,
        receipt,
        { [f.product]: 2 },
        600,
      ])
    ).rows[0].r;
  await act('claim');
  await act('bind');
  await assert.rejects(act('claim', second), /другой кассой/);
  assert.equal((await act('assembly-claim')).status, 'print');
  await assert.rejects(act('assembly-claim'), /Печать сборочного/);
  await assert.rejects(act('verify'), /Фискальная печать ожидает/);
  await act('assembly-complete');
  await act('assembly-complete');
  assert.equal((await act('assembly-claim')).status, 'printed');
  await f.db.query("update kaspi_orders set kitchen_status='ready' where id=$1", [f.id]);
  assert.equal((await read()).fiscal_due, false);
  await f.db.query("update kaspi_orders set kitchen_status='handed_over' where id=$1", [f.id]);
  assert.equal((await read()).fiscal_due, true);
  assert.equal((await read()).assembly_status, 'printed');
  assert.equal((await read()).receipt_id, receipt);
  assert.equal((await act('verify')).status, 'verified');
});

test('assembly binding does not block partial refunds and fiscal claim uses remaining merchandise', async (t) => {
  const f = await fixture(t),
    receipt = randomUUID();
  await f.db.query("update kaspi_orders set kitchen_status='queued' where id=$1", [f.id]);
  await f.db.query("update kaspi_orders set kitchen_status='preparing' where id=$1", [f.id]);
  const act = async (action) =>
    (
      await f.db.query('select front_receipt_job_action($1,$2,$3,$4,$5,$6,$7) r', [
        f.branch,
        f.terminal,
        f.id,
        action,
        receipt,
        { [f.product]: 1 },
        300,
      ])
    ).rows[0].r;
  await act('claim');
  await act('bind');
  await act('assembly-claim');
  await act('assembly-complete');
  assert.equal(
    (await f.db.query('select fiscal_started from front_receipt_jobs where order_id=$1', [f.id]))
      .rows[0].fiscal_started,
    false,
  );
  await f.db.query('select assert_front_partial_refund($1,300)', [f.id]);
  await f.refund(1, 300);
  await f.db.query("update kaspi_orders set kitchen_status='handed_over' where id=$1", [f.id]);
  await act('claim');
  assert.equal((await act('verify')).status, 'verified');
  await assert.rejects(
    f.db.query('select assert_front_partial_refund($1,300)', [f.id]),
    /завершите связанный чек/,
  );
});

test('unresolved delivery decisions block stale print actions and approval preserves the installed terminal print ledger', async (t) => {
  const f = await fixture(t, { resolution: true, bonus: 50, delivery: 100 });
  const receipt = randomUUID();
  await f.db.query("update kaspi_orders set kitchen_status='queued' where id=$1", [f.id]);
  await f.db.query("update kaspi_orders set kitchen_status='preparing' where id=$1", [f.id]);
  const act = async (action) =>
    (
      await f.db.query('select front_receipt_job_action($1,$2,$3,$4,$5,$6,$7) r', [
        f.branch,
        f.terminal,
        f.id,
        action,
        receipt,
        { [f.product]: 2 },
        650,
      ])
    ).rows[0].r;
  const job = async () =>
    (await f.db.query('select * from front_receipt_jobs where order_id=$1', [f.id])).rows[0];
  const money = async () =>
    (
      await f.db.query('select amount,bonus_spent,delivery_fee from kaspi_orders where id=$1', [
        f.id,
      ])
    ).rows[0];
  await act('claim');
  await act('bind');
  await act('assembly-claim');
  await act('assembly-complete');
  const before = await job();
  const paid = await money();
  for (const status of [
    'pending',
    'pickup_cancelling',
    'cancel_cancelling',
    'pickup_pending_approval',
    'pickup_accepting',
    'pickup_rejecting',
    'cancel_refunding',
  ]) {
    await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
      f.id,
      { id: 'resolution-1', status },
    ]);
    for (const action of ['claim', 'bind', 'assembly-claim', 'verify', 'complete'])
      await assert.rejects(act(action), /Замена доставки ожидает/);
    assert.deepEqual(await job(), before);
  }
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id: 'resolution-1', status: 'pickup_accepted' },
  ]);
  const approved = await job();
  assert.equal(approved.assembly_status, 'printed');
  for (const field of [
    'receipt_id',
    'terminal_id',
    'status',
    'fiscal_due',
    'fiscal_started',
    'expected_items',
    'expected_total',
  ])
    assert.deepEqual(approved[field], before[field]);
  assert.deepEqual(await money(), paid);
  assert.equal((await act('assembly-claim')).status, 'printed');
  await act('assembly-complete');
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id: 'resolution-1', status: 'pickup_accepted', reviewedAt: new Date().toISOString() },
  ]);
  assert.equal((await job()).assembly_status, 'printed');
  await f.db.query(
    "update front_receipt_jobs set status='completed',fiscal_started=true where order_id=$1",
    [f.id],
  );
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id: 'resolution-2', status: 'pickup_pending_approval' },
  ]);
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id: 'resolution-2', status: 'pickup_accepted' },
  ]);
  assert.equal((await job()).assembly_status, 'printed');
  assert.equal((await job()).status, 'completed');
});

test('fee refund claim serializes with the cashier decision and cannot refund goods or a foreign resolution', async (t) => {
  const f = await fixture(t, { resolution: true, bonus: 50, delivery: 100 });
  const resolutionId = randomUUID();
  const processor = randomUUID();
  const line = {
    line_key: '__delivery_fee__',
    product_id: 'delivery_fee',
    product_name: 'Доставка',
    quantity: 1,
    original_quantity: 1,
    unit_amount: 100,
    refund_amount: 100,
  };
  const claim = (id = resolutionId, items = [line], amount = 100) =>
    f.db.query('select to_jsonb(claim_partial_refund($1,$2,$3,$4,$5,$6,$7)) r', [
      f.id,
      id,
      processor,
      amount,
      'Replacement',
      'delivery-replacement',
      items,
    ]);
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id: resolutionId, status: 'pickup_pending_approval' },
  ]);
  await assert.rejects(claim(), /conflicts with current decision/);
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id: resolutionId, status: 'pickup_accepting' },
  ]);
  await assert.rejects(claim(randomUUID()), /conflicts with current decision/);
  await assert.rejects(
    claim(resolutionId, [{ ...line, line_key: `${f.product}:0` }]),
    /conflicts with current decision/,
  );
  await assert.rejects(
    claim(resolutionId, [{ ...line, refund_amount: 90 }], 90),
    /conflicts with current decision/,
  );
  const first = (await claim()).rows[0].r;
  const second = (await claim()).rows[0].r;
  assert.equal(first.id, second.id);
  assert.equal(Number(first.amount), 100);
  assert.equal(
    Number(
      (await f.db.query('select count(*) n from order_partial_refunds where order_id=$1', [f.id]))
        .rows[0].n,
    ),
    1,
  );
  assert.equal(
    Number(
      (await f.db.query('select amount from kaspi_orders where id=$1', [f.id])).rows[0].amount,
    ),
    650,
  );
});

test('returning all cash for a delivery fee retains free merchandise and never cancels or releases it', async (t) => {
  const f = await fixture(t, { resolution: true, discount: 600, delivery: 100 });
  const id = randomUUID();
  await f.db.query('update kaspi_orders set delivery_resolution=$2 where id=$1', [
    f.id,
    { id, status: 'pickup_accepting' },
  ]);
  const line = {
    line_key: '__delivery_fee__',
    product_id: 'delivery_fee',
    product_name: 'Доставка',
    quantity: 1,
    original_quantity: 1,
    unit_amount: 100,
    refund_amount: 100,
  };
  const record = (
    await f.db.query('select to_jsonb(claim_partial_refund($1,$2,$3,100,$4,$5,$6)) r', [
      f.id,
      id,
      randomUUID(),
      'Replacement',
      'delivery-replacement',
      [line],
    ])
  ).rows[0].r;
  const complete = async () =>
    (
      await f.db.query('select to_jsonb(complete_partial_refund($1,$2)) r', [
        record.id,
        'bank-confirmed',
      ])
    ).rows[0].r;
  const result = await complete();
  assert.equal(result.status, 'paid');
  assert.equal(result.refund_status, 'partial');
  assert.equal(result.fulfillment_status, 'preparing');
  assert.equal(result.kitchen_status, 'preparing');
  assert.equal(Number(result.partially_refunded_amount), 100);
  assert.equal(Number(result.amount), 100);
  assert.equal((await complete()).status, 'paid');
  assert.equal(
    (await f.db.query('select status from inventory_reservations where order_id=$1', [f.id]))
      .rows[0].status,
    'committed',
  );
});

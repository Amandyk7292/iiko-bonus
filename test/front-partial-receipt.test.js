const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { receiptDraft } = require('../src/services/front-receipt-draft.service');
const { remainingOrder } = require('../src/services/front-remaining-order.service');

async function fixture(
  t,
  { quantity = 2, price = 300, discount = 0, bonus = 0, delivery = 0 } = {},
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

test('partial refund -> correct weighted cash receipt -> stock settles once -> handover', async (t) => {
  const f = await fixture(t, {
    quantity: 0.7,
    price: 1500,
    discount: 50,
    bonus: 200,
    delivery: 1200,
  });
  await f.refund(0.3, 343);
  await f.db.query(
    'insert into order_partial_refund_adjustments(order_id,spent_bonus_restored) values($1,85.75)',
    [f.id],
  );
  const snapshot = await f.snapshot();
  assert.deepEqual(snapshot.items, { [f.product]: 0.4 });
  assert.equal(snapshot.subtotal, 600);
  assert.equal(snapshot.total, 457);
  assert.equal(snapshot.amount, 1657);
  const order = (await f.db.query('select * from kaspi_orders where id=$1', [f.id])).rows[0];
  assert.equal(receiptDraft(remainingOrder(order, snapshot)).merchandiseTotal, 457);
  await f.db.query(
    "insert into front_stock_policies(branch_id,enabled,terminal_ids,control_mode) values($1,true,$2,'front')",
    [f.branch, [f.terminal]],
  );
  await f.db.query('select front_stock_heartbeat($1,$2,true)', [f.branch, f.terminal]);
  const receipt = randomUUID();
  const key = `bp1:${f.branch}:${createHash('sha256').update(`${f.branch}\0${receipt}`).digest('hex')}`;
  await assert.rejects(
    f.db.query('select authorize_front_stock_sale($1,$2,$3,$4,$5,$6,123456)', [
      f.branch,
      f.terminal,
      receipt,
      { [f.product]: 0.7 },
      800,
      key,
    ]),
    /Состав чека/,
  );
  await f.db.query('select authorize_front_stock_sale($1,$2,$3,$4,$5,$6,123456)', [
    f.branch,
    f.terminal,
    receipt,
    snapshot.items,
    457,
    key,
  ]);
  await f.db.query("select finish_front_stock_sale($1,$2,$3,'closed',$4,$5)", [
    f.branch,
    f.terminal,
    receipt,
    snapshot.items,
    457,
  ]);
  await f.db.query("select finish_front_stock_sale($1,$2,$3,'closed',$4,$5)", [
    f.branch,
    f.terminal,
    receipt,
    snapshot.items,
    457,
  ]);
  assert.equal(await f.quantityLeft(), 9.6);
  await f.db.query(
    "update kaspi_orders set fulfillment_status='ready',kitchen_status='ready' where id=$1",
    [f.id],
  );
  await f.db.query(
    "update kaspi_orders set fulfillment_status='completed',kitchen_status='handed_over' where id=$1",
    [f.id],
  );
  assert.equal(await f.quantityLeft(), 9.6);
});

test('partial order queues remaining automatic receipt and rejects duplicate or mismatched settlement', async (t) => {
  const f = await fixture(t);
  await f.refund(1, 300);
  await f.db.query(
    "insert into front_stock_policies(branch_id,enabled,terminal_ids,control_mode) values($1,true,$2,'front')",
    [f.branch, [f.terminal]],
  );
  await f.db.query(
    "update kaspi_orders set kitchen_status='ready',fulfillment_status='ready' where id=$1",
    [f.id],
  );
  assert.equal(await f.quantityLeft(), 9);
  await f.db.query(
    "update kaspi_orders set kitchen_status='handed_over',fulfillment_status='completed' where id=$1",
    [f.id],
  );
  const receipt = randomUUID();
  const action = (name, items = null, total = null) =>
    f.db.query('select front_receipt_job_action($1,$2,$3,$4,$5,$6,$7) r', [
      f.branch,
      f.terminal,
      f.id,
      name,
      receipt,
      items,
      total,
    ]);
  await action('claim');
  await action('bind');
  await assert.rejects(action('verify', { [f.product]: 2 }, 600), /Состав или сумма/);
  await action('verify', { [f.product]: 1 }, 300);
  await action('complete', { [f.product]: 1 }, 300);
  await assert.rejects(action('verify', { [f.product]: 1 }, 300), /уже закрыт/);
  assert.equal(await f.quantityLeft(), 9);
});

test('completed removal is not subtracted twice and an unfinished substitution blocks receipt', async (t) => {
  const f = await fixture(t);
  const request = randomUUID(),
    customer = randomUUID();
  await f.db.query('insert into customers(id) values($1)', [customer]);
  await f.db.query('update kaspi_orders set customer_id=$2,client_request_id=$3 where id=$1', [
    f.id,
    customer,
    randomUUID(),
  ]);
  await f.db.query(
    "insert into order_substitution_requests(id,order_id,customer_id,line_key,product_id,product_name,quantity,action,status,requested_by) values($1,$2,$3,$4,$5,'Test product',1,'remove_refund','processing','test')",
    [request, f.id, customer, `${f.product}:0`, f.product],
  );
  await f.db.query('select prepare_order_substitution_execution($1,$2,null)', [f.id, request]);
  assert.equal((await f.snapshot()).ready, false);
  const refund = await f.refund(1, 300);
  await f.db.query('select complete_order_substitution_execution($1,$2,$3)', [
    f.id,
    request,
    refund,
  ]);
  await f.db.query('select complete_order_substitution_execution($1,$2,$3)', [
    f.id,
    request,
    refund,
  ]);
  const result = await f.snapshot();
  assert.deepEqual(result.items, { [f.product]: 1 });
  assert.equal(result.total, 300);
  for (const state of ['processing', 'unknown', 'succeeded']) {
    await f.db.query('update kaspi_orders set refund_status=$2 where id=$1', [f.id, state]);
    assert.equal((await f.snapshot()).ready, false);
  }
});

test('cheaper replacement uses the final basket and only the confirmed price difference', async (t) => {
  const f = await fixture(t),
    replacement = randomUUID(),
    request = randomUUID(),
    customer = randomUUID();
  await f.db.query('insert into customers(id) values($1)', [customer]);
  await f.db.query('update kaspi_orders set customer_id=$2,client_request_id=$3 where id=$1', [
    f.id,
    customer,
    randomUUID(),
  ]);
  await f.db.query(
    'insert into branch_product_inventory(branch_id,product_id,source_quantity) values($1,$2,10)',
    [f.branch, replacement],
  );
  await f.db.query(
    "insert into order_substitution_requests(id,order_id,customer_id,line_key,product_id,product_name,quantity,action,status,replacement_product_id,replacement_product_name,requested_by) values($1,$2,$3,$4,$5,'Original',1,'replace_with_approval','approved',$6,'Replacement','test')",
    [request, f.id, customer, `${f.product}:0`, f.product, replacement],
  );
  const prepared = (
    await f.db.query('select prepare_order_substitution_execution($1,$2,$3) r', [
      f.id,
      request,
      {
        id: replacement,
        iikoProductId: replacement,
        name: 'Replacement',
        price: 200,
        quantityStep: 1,
      },
    ])
  ).rows[0].r;
  assert.equal(Number(prepared.refundAmount), 100);
  const refund = randomUUID();
  await f.db.query(
    "insert into order_partial_refunds(id,order_id,status,amount) values($1,$2,'succeeded',100)",
    [refund, f.id],
  );
  await f.db.query(
    'insert into order_partial_refund_items(refund_id,product_id,line_key,quantity,refund_amount) values($1,$2,$3,1,100)',
    [refund, replacement, `substitution:${request}`],
  );
  await f.db.query(
    "update kaspi_orders set refund_status='partial',partially_refunded_amount=100 where id=$1",
    [f.id],
  );
  await f.db.query('select complete_order_substitution_execution($1,$2,$3)', [
    f.id,
    request,
    refund,
  ]);
  const result = await f.snapshot();
  assert.deepEqual(result.items, { [f.product]: 1, [replacement]: 1 });
  assert.equal(result.total, 500);
  await f.db.query("select settle_front_online_stock($1,'front','test')", [f.id]);
  assert.equal(await f.quantityLeft(), 9);
  assert.equal(
    Number(
      (
        await f.db.query(
          'select source_quantity from branch_product_inventory where product_id=$1',
          [replacement],
        )
      ).rows[0].source_quantity,
    ),
    9,
  );
});

test('bound automatic receipt blocks financial changes before the bank, including with disabled stock policy', async (t) => {
  const f = await fixture(t);
  await f.db.query(
    "update kaspi_orders set kitchen_status='handed_over',fulfillment_status='completed' where id=$1",
    [f.id],
  );
  const receipt = randomUUID();
  const action = (name) =>
    f.db.query('select front_receipt_job_action($1,$2,$3,$4,$5,$6,$7)', [
      f.branch,
      f.terminal,
      f.id,
      name,
      receipt,
      { [f.product]: 2 },
      600,
    ]);
  await action('claim');
  await action('bind');
  const claim = (quantity = 1) =>
    f.db.query('select claim_partial_refund($1,$2,$3,$4,$5,$6,$7)', [
      f.id,
      randomUUID(),
      randomUUID(),
      300 * quantity,
      'Test refund',
      'test',
      [
        {
          line_key: `${f.product}:0`,
          product_id: f.product,
          quantity,
          original_quantity: 2,
          unit_amount: 300,
          refund_amount: 300 * quantity,
        },
      ],
    ]);
  await assert.rejects(claim(), /Сначала завершите связанный чек/);
  assert.equal(
    Number(
      (await f.db.query('select count(*) c from order_partial_refunds where order_id=$1', [f.id]))
        .rows[0].c,
    ),
    0,
  );
  await assert.rejects(
    f.db.query("update kaspi_orders set cart_items='[]' where id=$1", [f.id]),
    /Сначала завершите связанный чек/,
  );
  await action('verify');
  await action('complete');
  await assert.rejects(claim(), /Чек уже пробит/);
  assert.equal(
    Number(
      (await f.db.query('select count(*) c from order_partial_refunds where order_id=$1', [f.id]))
        .rows[0].c,
    ),
    0,
  );
  await claim(2);
});

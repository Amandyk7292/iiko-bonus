const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
test.before(async () => {
  await require('./helpers/front-tablet-schema.cjs')(db);
  await require('./helpers/front-refund-schema.cjs')(db);
  await db.exec(readFileSync('supabase/migrations/20260910147000_preorder_stop_only.sql', 'utf8'));
});
test.after(() => db.close());
async function fixture(preorder = false) {
  const id = randomUUID(),
    branch = randomUUID(),
    customer = randomUUID(),
    request = randomUUID(),
    substitution = randomUUID();
  await db.query('insert into customers values($1)', [customer]);
  await db.query('insert into bulka_locations(id) values($1)', [branch]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,quantity_step,unit) values($1,'a',0,0.001,'кг'),($1,'b',5,0.001,'кг')",
    [branch],
  );
  await db.query(
    'insert into kaspi_orders(id,branch_id,customer_id,client_request_id,fulfillment_type,cart_items,amount,subtotal) values($1,$2,$3,$4,$5,$6,1050,1050)',
    [
      id,
      branch,
      customer,
      request,
      preorder ? 'preorder' : 'pickup',
      [
        {
          id: 'a',
          name: 'Weight',
          quantity: 0.7,
          quantityStep: 0.001,
          price: 1500,
          lineTotal: 1050,
          lineKey: 'a:0',
        },
      ],
    ],
  );
  await db.query(
    "insert into inventory_reservations(order_id,branch_id,customer_id,client_request_id,product_id,quantity,status,allocation_kind,preorder_for) values($1,$2,$3,$4,'a',0.7,'committed',$5,now()+interval '2 days')",
    [id, branch, customer, request, preorder ? 'preorder' : 'display'],
  );
  await db.query(
    "insert into order_substitution_requests(id,order_id,customer_id,line_key,product_id,product_name,quantity,action,status,replacement_product_id,replacement_product_name,requested_by) values($1,$2,$3,'a:0','a','Weight',0.3,'replace_with_approval','approved','b','Replacement','cashier')",
    [substitution, id, customer],
  );
  return { id, branch, customer, request, substitution };
}
test('a fractional replacement keeps exact line totals and repeated completion is idempotent', async () => {
  const ctx = await fixture();
  const payload = (
    await db.query('select prepare_order_substitution_execution($1,$2,$3) result', [
      ctx.id,
      ctx.substitution,
      { id: 'b', name: 'Replacement', price: 1500, quantityStep: 0.001, unit: 'кг' },
    ])
  ).rows[0].result;
  assert.equal(Number(payload.refundAmount), 0);
  await db.query('select complete_order_substitution_execution($1,$2,null)', [
    ctx.id,
    ctx.substitution,
  ]);
  await db.query('select complete_order_substitution_execution($1,$2,null)', [
    ctx.id,
    ctx.substitution,
  ]);
  const order = (await db.query('select * from kaspi_orders where id=$1', [ctx.id])).rows[0];
  assert.deepEqual(
    order.cart_items.map((i) => [i.quantity, i.lineTotal]),
    [
      [0.4, 600],
      [0.3, 450],
    ],
  );
  assert.equal(Number(order.subtotal), 1050);
});

test('a past partial refund cannot be counted twice through a later cart substitution', async () => {
  const ctx = await fixture();
  await db.query('update kaspi_orders set partially_refunded_amount=150 where id=$1', [ctx.id]);
  await assert.rejects(
    db.query('select prepare_order_substitution_execution($1,$2,$3)', [
      ctx.id,
      ctx.substitution,
      { id: 'b', name: 'Replacement', price: 1500, quantityStep: 0.001, unit: 'кг' },
    ]),
    /После частичного возврата/,
  );
  const row = (await db.query('select cart_items,subtotal from kaspi_orders where id=$1', [ctx.id]))
    .rows[0];
  assert.equal(Number(row.subtotal), 1050);
  assert.equal(row.cart_items[0].quantity, 0.7);
});
test('a preorder replacement uses only preorder stop state and keeps preorder allocation', async () => {
  const ctx = await fixture(true);
  await db.query(
    "update branch_product_inventory set source_quantity=0,manual_stop=true where branch_id=$1 and product_id='b'",
    [ctx.branch],
  );
  await db.query('select prepare_order_substitution_execution($1,$2,$3)', [
    ctx.id,
    ctx.substitution,
    { id: 'b', name: 'Replacement', price: 1500, quantityStep: 0.001, unit: 'кг' },
  ]);
  const row = (
    await db.query("select * from inventory_reservations where order_id=$1 and product_id='b'", [
      ctx.id,
    ])
  ).rows[0];
  assert.equal(row.allocation_kind, 'preorder');
  assert.equal(Number(row.quantity), 0.3);
});
test('fractional partial refund claims cannot over-refund quantity or duplicate an idempotency key', async () => {
  const ctx = await fixture(),
    key = randomUUID(),
    token = randomUUID();
  const item = {
    line_key: 'a:0',
    product_id: 'a',
    product_name: 'Weight',
    quantity: 0.3,
    original_quantity: 0.7,
    unit_amount: 1500,
    refund_amount: 450,
  };
  const args = [ctx.id, key, token, 450, 'reason', 'cashier', [item]];
  const first = (await db.query('select (claim_partial_refund($1,$2,$3,$4,$5,$6,$7)).*', args))
    .rows[0];
  const duplicate = (await db.query('select (claim_partial_refund($1,$2,$3,$4,$5,$6,$7)).*', args))
    .rows[0];
  assert.equal(first.id, duplicate.id);
  await db.query("update order_partial_refunds set status='succeeded' where id=$1", [first.id]);
  await db.query(
    'update kaspi_orders set refund_status=null,partially_refunded_amount=450 where id=$1',
    [ctx.id],
  );
  await assert.rejects(
    db.query('select claim_partial_refund($1,$2,$3,$4,$5,$6,$7)', [
      ctx.id,
      randomUUID(),
      randomUUID(),
      500,
      'reason',
      'cashier',
      [{ ...item, quantity: 0.5, refund_amount: 500 }],
    ]),
    /quantity already claimed/,
  );
});

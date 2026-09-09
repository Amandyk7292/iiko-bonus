const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table bulka_locations(id uuid primary key, active boolean default true,
      pickup_slot_capacity integer default 10, delivery_slot_capacity integer default 10,
      preorder_slot_capacity integer default 10);
    create table kaspi_orders(id uuid primary key, status text, kitchen_status text, fulfillment_status text);
    create table order_partial_refunds(id uuid primary key, order_id uuid, status text);
    create table custom_products(id uuid primary key);
    create table order_partial_refund_items(refund_id uuid, product_id text, quantity integer);
    create table branch_product_inventory(id uuid default gen_random_uuid(), branch_id uuid, product_id text, product_name text,
      source_quantity integer, manual_stop boolean default false, source text default 'iiko', last_synced_at timestamptz,
      preparation_minutes integer, updated_at timestamptz default now(),
      primary key(branch_id,product_id));
    create table inventory_reservations(id uuid default gen_random_uuid(), customer_id uuid, client_request_id uuid,
      branch_id uuid, product_id text, quantity integer, status text, expires_at timestamptz,
      order_id uuid, updated_at timestamptz default now());
    create table fulfillment_slot_reservations(id uuid default gen_random_uuid(),
      order_id uuid, branch_id uuid, fulfillment_type text, scheduled_at timestamptz,
      status text, expires_at timestamptz, updated_at timestamptz default now());`);
  const reserve = readFileSync(
    'supabase/migrations/20260729090000_inventory_reservation_integrity.sql',
    'utf8',
  );
  await db.exec(
    reserve.slice(0, reserve.indexOf('drop function if exists public.reserve_fulfillment_slot')),
  );
  await db.exec(readFileSync('supabase/migrations/20260909230000_cashier_inventory.sql', 'utf8'));
  await db.exec(
    readFileSync('supabase/migrations/20260909232000_front_inventory_sync.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20260910003000_cashier_inventory_guardrails.sql', 'utf8'),
  );
  await db.exec(readFileSync('supabase/migrations/20260910013000_online_stock_buffer.sql', 'utf8'));
});
function frontSender(branchId) {
  const terminal = randomUUID(),
    group = randomUUID(),
    session = randomUUID();
  const started = Date.now() - 10_000;
  let sequence = 0;
  return async (quantity, override = {}) => {
    sequence++;
    return (
      await db.query('select apply_front_inventory_snapshot($1,$2,$3,$4,$5,$6,$7) as data', [
        branchId,
        terminal,
        override.group || group,
        session,
        override.sequence || sequence,
        new Date(override.capturedAt || started + sequence * 100).toISOString(),
        quantity === null ? [] : [{ productId: 'bun', productName: 'Хот дог', quantity }],
      ])
    ).rows[0].data;
  };
}
test('cash-register sale 10 to 5 updates the same product and keeps online reservations', async () => {
  const id = await branch(),
    other = await branch();
  const send = frontSender(id),
    otherSend = frontSender(other);
  await send(10);
  await otherSend(20);
  await reserve(id);
  await reserve(id);
  await send(5);
  const quantity = (
    await db.query(
      'select source_quantity - (select coalesce(sum(quantity),0) from inventory_reservations where branch_id=$1 and status=$2) as available from branch_product_inventory where branch_id=$1',
      [id, 'active'],
    )
  ).rows[0].available;
  assert.equal(Number(quantity), 3);
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        other,
      ])
    ).rows[0].source_quantity,
    20,
  );
  await db.query(
    "update branch_product_inventory set source_quantity=10,source='iiko' where branch_id=$1",
    [id],
  );
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        id,
      ])
    ).rows[0].source_quantity,
    5,
    'late cloud snapshot cannot overwrite Front',
  );
});
test('Front stop, removal, duplicates and out-of-order snapshots preserve correct stock', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(10);
  await send(0);
  await assert.rejects(() => reserve(id), /Недостаточно товара/);
  const duplicate = await send(10, { sequence: 1 });
  assert.equal(duplicate.applied, false);
  const stale = await send(10, { capturedAt: Date.now() - 60_000 });
  assert.equal(stale.applied, false);
  await assert.rejects(() => send(10, { group: randomUUID() }), /Another iikoFront group/);
  await send(null);
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        id,
      ])
    ).rows[0].source_quantity,
    null,
  );
});
test('manual stop leaves register counts live instead of silently freezing the quantity', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(10);
  await db.query('select update_cashier_inventory($1,$2,$3,0,$4)', [
    id,
    'bun',
    'Хот-дог',
    { manualStop: true },
  ]);
  await send(5);
  let row = (await db.query('select * from branch_product_inventory where branch_id=$1', [id]))
    .rows[0];
  assert.equal(row.source_quantity, 5);
  assert.equal(row.source, 'iiko');
  assert.equal(row.manual_stop, true);
  await db.query('select update_cashier_inventory($1,$2,$3,$4,$5)', [
    id,
    'bun',
    'Хот-дог',
    Number(row.stock_revision),
    { manualStop: false },
  ]);
  await send(3);
  row = (await db.query('select * from branch_product_inventory where branch_id=$1', [id])).rows[0];
  assert.equal(row.source_quantity, 3);
  assert.equal(row.manual_stop, false);
});
test('an independent custom product stays manual when only its stop switch is changed', async () => {
  const id = await branch(),
    product = randomUUID();
  await db.query('insert into custom_products values($1)', [product]);
  const result = await db.query('select update_cashier_inventory($1,$2,$3,0,$4) as data', [
    id,
    product,
    'Свой товар',
    { manualStop: true },
  ]);
  assert.equal(result.rows[0].data.source, 'admin');
});
test('retrying an old checkout cannot renew its reservation while Front is disconnected', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(10);
  const request = await reserve(id);
  const row = (
    await db.query('select customer_id from inventory_reservations where client_request_id=$1', [
      request,
    ])
  ).rows[0];
  await db.query("update inventory_reservations set status='expired' where client_request_id=$1", [
    request,
  ]);
  await db.query(
    "update branch_front_inventory_sync set last_seen_at=now()-interval '1 minute' where branch_id=$1",
    [id],
  );
  await assert.rejects(
    () =>
      db.query('select reserve_order_inventory($1,$2,$3,$4,35,null)', [
        row.customer_id,
        request,
        id,
        [{ id: 'bun', quantity: 1 }],
      ]),
    /требует подтверждения/,
  );
});
test('full Front snapshots clear old cloud counts but preserve independent custom stock', async () => {
  const id = await branch(),
    send = frontSender(id);
  await db.query(
    `insert into branch_product_inventory(branch_id,product_id,source_quantity,source)
    values($1,'old-cloud',9,'iiko'),($1,'custom-dessert',7,'custom')`,
    [id],
  );
  await send(5);
  const rows = (
    await db.query(
      'select product_id,source_quantity from branch_product_inventory where branch_id=$1',
      [id],
    )
  ).rows;
  assert.equal(rows.find((row) => row.product_id === 'old-cloud').source_quantity, null);
  assert.equal(rows.find((row) => row.product_id === 'custom-dessert').source_quantity, 7);
});
test('explicit administrator reset restores the latest Front count', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(10);
  await stock(id, 4);
  await send(5);
  const result = await db.query('select update_admin_inventory($1) as data', [
    {
      branch_id: id,
      product_id: 'bun',
      source_quantity: null,
      manual_stop: false,
    },
  ]);
  assert.equal(result.rows[0].data.source_quantity, 5);
  assert.equal(result.rows[0].data.source, 'iiko');
});
test('handover never subtracts a Front sale a second time', async () => {
  const id = await branch(),
    send = frontSender(id),
    order = randomUUID();
  await send(10);
  const request = await reserve(id);
  await db.query("insert into kaspi_orders values($1,'paid','handed_over','completed')", [order]);
  await db.query(
    "update inventory_reservations set status='committed',order_id=$1 where client_request_id=$2",
    [order, request],
  );
  await send(9);
  await db.query("update inventory_reservations set status='released' where order_id=$1", [order]);
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        id,
      ])
    ).rows[0].source_quantity,
    9,
  );
});
test('offline register requires manual stock; recovery does not erase it before explicit handback', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(10);
  await db.query(
    "update branch_front_inventory_sync set last_seen_at=now()-interval '1 minute' where branch_id=$1",
    [id],
  );
  await assert.rejects(() => reserve(id), /требует подтверждения/);
  let row = (await db.query('select * from branch_product_inventory where branch_id=$1', [id]))
    .rows[0];
  await stock(id, 4, Number(row.stock_revision));
  await reserve(id);
  await send(5);
  row = (await db.query('select * from branch_product_inventory where branch_id=$1', [id])).rows[0];
  assert.equal(row.source_quantity, 4);
  assert.equal(row.front_quantity, 5);
  const result = await db.query('select update_cashier_inventory($1,$2,$3,$4,$5) as data', [
    id,
    'bun',
    'Хот-дог',
    Number(row.stock_revision),
    { useIiko: true },
  ]);
  assert.equal(result.rows[0].data.source_quantity, 5);
  assert.equal(result.rows[0].data.source, 'iiko');
});
test.after(() => db.close());
async function branch() {
  const id = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [id]);
  return id;
}
async function stock(id, quantity, revision = 0) {
  return (
    await db.query('select update_cashier_inventory($1, $2, $3, $4, $5) as data', [
      id,
      'bun',
      'Плюшка',
      revision,
      JSON.stringify({ sourceQuantity: quantity }),
    ])
  ).rows[0].data;
}
async function reserve(id, quantity = 1) {
  const request = randomUUID();
  await db.query('select reserve_order_inventory($1,$2,$3,$4,35,null)', [
    randomUUID(),
    request,
    id,
    JSON.stringify([{ id: 'bun', quantity }]),
  ]);
  return request;
}
test('two remaining units admit one online checkout and keep one unit at each branch', async () => {
  const first = await branch(),
    other = await branch();
  await stock(first, 2);
  await stock(other, 2);
  const attempts = await Promise.allSettled([reserve(first), reserve(first), reserve(first)]);
  assert.equal(attempts.filter((v) => v.status === 'fulfilled').length, 1);
  assert.equal(
    attempts.filter((v) => v.status === 'rejected' && /Недостаточно товара/.test(v.reason.message))
      .length,
    2,
  );
  await reserve(other);
});

test('zero or one counted unit cannot be reserved online, including direct RPC calls', async () => {
  for (const quantity of [0, 1]) {
    const id = await branch();
    await stock(id, quantity);
    await assert.rejects(() => reserve(id), /Доступно: 0/);
    const rows = await db.query('select * from inventory_reservations where branch_id=$1', [id]);
    assert.equal(rows.rows.length, 0);
  }
});

test('an order may take five of six units, but never five of five or split variants to bypass the buffer', async () => {
  const id = await branch(),
    other = await branch();
  await stock(id, 6);
  await stock(other, 5);
  await assert.rejects(() => reserve(other, 5), /Доступно: 4/);
  await assert.rejects(
    () =>
      db.query('select reserve_order_inventory($1,$2,$3,$4,35,null)', [
        randomUUID(),
        randomUUID(),
        other,
        [
          { id: 'bun', quantity: 2, configuration: { size: 'a' } },
          { id: 'bun', quantity: 3, configuration: { size: 'b' } },
        ],
      ]),
    /Доступно: 4/,
  );
  const request = await reserve(id, 5);
  const reservation = (
    await db.query('select * from inventory_reservations where client_request_id=$1', [request])
  ).rows[0];
  await db.query('select reserve_order_inventory($1,$2,$3,$4,35,null)', [
    reservation.customer_id,
    request,
    id,
    [{ id: 'bun', quantity: 5 }],
  ]);
  assert.equal(
    (
      await db.query(
        'select count(*)::integer as n from inventory_reservations where branch_id=$1',
        [id],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(() => reserve(id), /Доступно: 0/);
  await db.query("update inventory_reservations set status='released' where client_request_id=$1", [
    request,
  ]);
  await reserve(id, 5);
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        id,
      ])
    ).rows[0].source_quantity,
    6,
  );
});

test('Front sale between loading the cart and checkout blocks payment reservation', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(6);
  await send(1);
  await assert.rejects(() => reserve(id, 5), /Доступно: 0/);
});

test('unknown stock remains unlimited and an expired hold releases only the online capacity', async () => {
  const id = await branch(),
    send = frontSender(id);
  await send(2);
  const request = await reserve(id);
  await db.query(
    "update inventory_reservations set expires_at=now()-interval '1 second' where client_request_id=$1",
    [request],
  );
  await reserve(id);
  await assert.rejects(() => reserve(id), /Доступно: 0/);
  await send(null);
  await reserve(id, 99);
});

test('a rejected multi-product checkout rolls back earlier reservations in the same transaction', async () => {
  const id = await branch();
  await stock(id, 2);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,source) values($1,'last-unit',1,'admin')",
    [id],
  );
  await assert.rejects(
    () =>
      db.query('select reserve_order_inventory($1,$2,$3,$4,35,null)', [
        randomUUID(),
        randomUUID(),
        id,
        [
          { id: 'bun', quantity: 1 },
          { id: 'last-unit', quantity: 1 },
        ],
      ]),
    /Доступно: 0/,
  );
  assert.equal(
    (
      await db.query(
        'select count(*)::integer as n from inventory_reservations where branch_id=$1',
        [id],
      )
    ).rows[0].n,
    0,
  );
});

async function checkoutOrder(branchId, requestId) {
  const order = randomUUID();
  await db.query("insert into kaspi_orders values($1,'pending','new','pending')", [order]);
  await db.query('update inventory_reservations set order_id=$1 where client_request_id=$2', [
    order,
    requestId,
  ]);
  await db.query(
    "insert into fulfillment_slot_reservations(order_id,branch_id,fulfillment_type,scheduled_at,status,expires_at) values($1,$2,'pickup',now()+interval '1 hour','active',now()+interval '35 minutes')",
    [order, branchId],
  );
  return order;
}

test('payment confirmation and late recovery both recheck the last-unit buffer without partially committing a slot', async () => {
  for (const allowReacquire of [false, true]) {
    const id = await branch(),
      send = frontSender(id);
    await send(2);
    const request = await reserve(id),
      order = await checkoutOrder(id, request);
    if (allowReacquire) {
      await db.query("update inventory_reservations set status='expired' where order_id=$1", [
        order,
      ]);
      await db.query(
        "update fulfillment_slot_reservations set status='expired' where order_id=$1",
        [order],
      );
    }
    await send(1);
    const failed = (
      await db.query('select commit_order_reservations($1,$2) as data', [order, allowReacquire])
    ).rows[0].data;
    assert.equal(failed.status, 'unavailable');
    assert.equal(failed.reason, 'inventory');
    assert.equal(failed.productId, 'bun');
    assert.equal(
      (
        await db.query('select status from fulfillment_slot_reservations where order_id=$1', [
          order,
        ])
      ).rows[0].status,
      allowReacquire ? 'expired' : 'active',
    );
    await send(2);
    const committed = (
      await db.query('select commit_order_reservations($1,$2) as data', [order, allowReacquire])
    ).rows[0].data;
    assert.equal(committed.status, 'committed');
    assert.equal(committed.inventoryUnitsCommitted, 1);
    assert.equal(committed.slotCommitted, 1);
    await send(1);
    const repeat = (
      await db.query('select commit_order_reservations($1,$2) as data', [order, allowReacquire])
    ).rows[0].data;
    assert.equal(
      repeat.status,
      'already_committed',
      'settled orders are not cancelled by the buffer',
    );
  }
});
test('manual quantity survives an iiko refresh and a stale cashier cannot overwrite it', async () => {
  const id = await branch();
  const row = await stock(id, 5);
  await db.query(
    "update branch_product_inventory set source_quantity=100,source='iiko' where branch_id=$1",
    [id],
  );
  const saved = (await db.query('select * from branch_product_inventory where branch_id=$1', [id]))
    .rows[0];
  assert.equal(saved.source_quantity, 5);
  assert.equal(saved.stock_revision, row.stock_revision);
  const next = await stock(id, 2, Number(row.stock_revision));
  await assert.rejects(() => stock(id, 8, Number(row.stock_revision)), /Остаток уже изменился/);
  assert.equal(next.source_quantity, 2);
});
test('stop toggle preserves quantity and zero prevents reservation before payment', async () => {
  const id = await branch();
  const row = await stock(id, 4);
  const call = (changes, revision) =>
    db.query('select update_cashier_inventory($1,$2,$3,$4,$5)', [
      id,
      'bun',
      'Плюшка',
      revision,
      changes,
    ]);
  await call({ manualStop: true }, Number(row.stock_revision));
  await assert.rejects(() => reserve(id), /временно недоступен/);
  await call({ manualStop: false, sourceQuantity: 0 }, Number(row.stock_revision) + 1);
  await assert.rejects(() => reserve(id), /Недостаточно товара/);
});
test('handing over consumes manual stock exactly once; cancelling preserves it', async () => {
  for (const completed of [true, false]) {
    const id = await branch(),
      order = randomUUID();
    await stock(id, 2);
    const request = await reserve(id);
    await db.query('insert into kaspi_orders values($1,$2,$3,$4)', [
      order,
      completed ? 'paid' : 'refunded',
      completed ? 'handed_over' : 'cancelled',
      completed ? 'completed' : 'cancelled',
    ]);
    await db.query(
      "update inventory_reservations set status='committed',order_id=$1 where client_request_id=$2",
      [order, request],
    );
    for (let attempt = 0; attempt < 2; attempt++)
      await db.query("update inventory_reservations set status='released' where order_id=$1", [
        order,
      ]);
    const quantity = (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        id,
      ])
    ).rows[0].source_quantity;
    assert.equal(quantity, completed ? 1 : 2);
  }
});
test('cashier stock RPC rejects extra scope fields, unlimited stock and invalid quantities', async () => {
  const id = await branch();
  for (const changes of [
    { branchId: id, sourceQuantity: 1 },
    { sourceQuantity: null },
    { sourceQuantity: 1.5 },
    { sourceQuantity: -1 },
    { sourceQuantity: 100001 },
  ]) {
    await assert.rejects(() =>
      db.query('select update_cashier_inventory($1,$2,$3,0,$4)', [id, 'bun', 'Плюшка', changes]),
    );
  }
  const { rows } = await db.query(
    "select has_function_privilege('anon','update_cashier_inventory(uuid,text,text,bigint,jsonb)','execute') as allowed",
  );
  assert.equal(rows[0].allowed, false);
});
test('handover consumes only units not refunded before handover', async () => {
  const id = await branch(),
    order = randomUUID(),
    refund = randomUUID();
  await stock(id, 3);
  const request = await reserve(id);
  await db.query('insert into kaspi_orders values($1,$2,$3,$4)', [
    order,
    'paid',
    'handed_over',
    'completed',
  ]);
  await db.query(
    "update inventory_reservations set quantity=3,status='committed',order_id=$1 where client_request_id=$2",
    [order, request],
  );
  await db.query("insert into order_partial_refunds values($1,$2,'succeeded')", [refund, order]);
  await db.query("insert into order_partial_refund_items values($1,'bun',1)", [refund]);
  await db.query("update inventory_reservations set status='released' where order_id=$1", [order]);
  assert.equal(
    (
      await db.query('select source_quantity from branch_product_inventory where branch_id=$1', [
        id,
      ])
    ).rows[0].source_quantity,
    1,
  );
});

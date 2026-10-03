const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const legacyKg = randomUUID(),
  conflict = randomUUID(),
  seededBranch = randomUUID(),
  legacyReservation = randomUUID();
test.before(async () => {
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
    '20260912120000_cashier_stock_reports',
    '20260912150000_cashier_stock_change_reasons',
    '20260912170000_cashier_stock_delta_updates',
    '20260926110000_offline_stock_arrival_watermark',
  ])
    await db.exec(readFileSync(`supabase/migrations/${name}.sql`, 'utf8'));
  const other = randomUUID();
  await db.query('insert into bulka_locations(id) values($1),($2)', [seededBranch, other]);
  await db.query(
    `insert into branch_product_inventory(branch_id,product_id,source_quantity,unit,quantity_step,source)
    values($1,$3,0.125,'кг',0.001,'admin'),($1,$4,3,'шт',1,'admin'),($2,$4,2,'кг',0.001,'admin')`,
    [seededBranch, other, legacyKg, conflict],
  );
  await db.exec('alter table inventory_reservations add primary key(id)');
  const expiredBranch = randomUUID(),
    expiredProduct = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [expiredBranch]);
  await db.query(
    "insert into branch_product_inventory(branch_id,product_id,source_quantity,unit,quantity_step,source) values($1,$2,3,'шт',1,'admin')",
    [expiredBranch, expiredProduct],
  );
  await db.query(
    "insert into inventory_reservations(id,branch_id,product_id,quantity,status,expires_at) values($1,$2,$3,1,'active',now()-interval '1 day')",
    [legacyReservation, expiredBranch, expiredProduct],
  );
  await db.query(
    'insert into front_stock_policies(branch_id,enabled,paused,terminal_ids) values($1,true,true,$2)',
    [expiredBranch, [randomUUID()]],
  );
  await db.exec(
    readFileSync('supabase/migrations/20261003220000_global_product_inventory_units.sql', 'utf8'),
  );
});
test.after(() => db.close());
const rpc = async (name, args) =>
  (await db.query(`select ${name}(${args.map((_, i) => '$' + (i + 1))}) r`, args)).rows[0].r;
const branch = async () => {
  const id = randomUUID();
  await db.query('insert into bulka_locations(id) values($1)', [id]);
  return id;
};
const row = async (b, p) =>
  (
    await db.query('select * from branch_product_inventory where branch_id=$1 and product_id=$2', [
      b,
      p,
    ])
  ).rows[0];
const configure = (p, unit) => rpc('set_product_inventory_unit', [p, unit, 'owner']);
const mutate = (
  b,
  p,
  quantity,
  { unit, reason = 'correction', revision = 0, operationId = randomUUID() } = {},
) =>
  rpc('update_cashier_inventory', [
    b,
    p,
    'Товар',
    revision,
    { sourceQuantity: quantity, stockReason: reason, operationId, ...(unit ? { unit } : {}) },
  ]);

test('migration preserves unambiguous legacy kg, exposes conflicts and never rewrites quantities', async () => {
  assert.equal(
    (
      await db.query('select unit from inventory_reservation_units where reservation_id=$1', [
        legacyReservation,
      ])
    ).rows[0].unit,
    'шт',
  );
  assert.deepEqual(await rpc('get_product_inventory_unit', [legacyKg]), {
    unit: 'кг',
    configured: false,
  });
  assert.deepEqual(await rpc('get_product_inventory_unit', [conflict]), {
    unit: null,
    configured: false,
  });
  assert.equal(Number((await row(seededBranch, legacyKg)).source_quantity), 0.125);
  await assert.rejects(() => configure(legacyKg, 'шт'), /обнулите/);
  await assert.rejects(() => configure(conflict, 'шт'), /обнулите/);
  const legacy = await row(seededBranch, conflict);
  await assert.rejects(
    () =>
      mutate(seededBranch, conflict, 2, { unit: 'кг', revision: Number(legacy.stock_revision) }),
    /разные единицы/,
  );
  const zero = await mutate(seededBranch, conflict, 0, {
    unit: 'шт',
    revision: Number(legacy.stock_revision),
  });
  assert.equal(zero.unit, 'шт');
  await configure(conflict, 'кг');
  assert.equal((await row(seededBranch, conflict)).unit, 'кг');
  assert.equal(Number((await row(seededBranch, conflict)).source_quantity), 0);
  const matchingLegacy = (
    await db.query(
      'select source_quantity from branch_product_inventory where product_id=$1 and branch_id<>$2',
      [conflict, seededBranch],
    )
  ).rows[0];
  assert.equal(Number(matchingLegacy.source_quantity), 2);
});

test('cashier forged unit changes fail for existing and missing stocks; missing global row remains pieces', async () => {
  const b = await branch(),
    p = randomUUID();
  await assert.rejects(() => mutate(b, p, 0.125, { unit: 'кг' }), /администратор/);
  assert.equal(await row(b, p), undefined);
  const saved = await mutate(b, p, 3, { unit: 'шт' });
  await assert.rejects(
    () => mutate(b, p, 0, { unit: 'кг', revision: Number(saved.stock_revision) }),
    /администратор/,
  );
  assert.equal(Number((await row(b, p)).source_quantity), 3);
});

test('global kg applies to future cashier/admin/Front rows; contradictory external metadata rolls back', async () => {
  const p = randomUUID(),
    b = await branch(),
    adminBranch = await branch(),
    frontBranch = await branch();
  assert.equal((await configure(p, 'кг')).configured, true);
  const saved = await mutate(b, p, 0.125);
  assert.equal(saved.unit, 'кг');
  assert.equal(Number(saved.quantity_step), 0.001);
  const admin = await rpc('update_admin_inventory', [
    { branch_id: adminBranch, product_id: p, source_quantity: 1.375 },
  ]);
  assert.equal(admin.unit, 'кг');
  assert.equal(Number(admin.source_quantity), 1.375);
  const terminal = randomUUID(),
    group = randomUUID(),
    session = randomUUID();
  const snapshot = (sequence, items) =>
    rpc('apply_front_inventory_snapshot', [
      frontBranch,
      terminal,
      group,
      session,
      sequence,
      new Date().toISOString(),
      items,
    ]);
  await assert.rejects(
    () =>
      snapshot(1, [
        { productId: p, productName: 'Товар', quantity: 1, unit: 'шт', quantityStep: 1 },
      ]),
    /iiko/,
  );
  assert.equal(await row(frontBranch, p), undefined);
  await snapshot(1, [{ productId: p, productName: 'Товар', quantity: 0.125 }]);
  assert.equal((await row(frontBranch, p)).unit, 'кг');
  await assert.rejects(
    () =>
      db.query(
        'update branch_product_inventory set unit=$3,quantity_step=1 where branch_id=$1 and product_id=$2',
        [b, p, 'шт'],
      ),
    /администратор/,
  );
  await assert.rejects(
    () =>
      rpc('update_admin_inventory', [
        { branch_id: b, product_id: p, source_quantity: 0, unit: 'шт' },
      ]),
    /администратор/,
  );
});

test('unit change requires empty stocks and no active orders; revision blocks stale count and report history keeps original unit', async () => {
  const b = await branch(),
    p = randomUUID();
  const initial = await mutate(b, p, 3);
  const zero = await mutate(b, p, 0, { revision: Number(initial.stock_revision) });
  await db.query(
    `insert into inventory_reservations(branch_id,product_id,quantity,status,expires_at)
    values($1,$2,1,'active',now()+interval '1 hour')`,
    [b, p],
  );
  await assert.rejects(() => configure(p, 'кг'), /активные заказы/);
  await db.query(
    "update inventory_reservations set status='released' where branch_id=$1 and product_id=$2",
    [b, p],
  );
  const history = (
    await db.query(
      'select * from display_stock_changes where product_id=$1 order by created_at,id',
      [p],
    )
  ).rows;
  await configure(p, 'кг');
  const changed = await row(b, p);
  assert.equal(changed.unit, 'кг');
  assert.equal(Number(changed.source_quantity), 0);
  await assert.rejects(
    () => mutate(b, p, 5, { revision: Number(zero.stock_revision) }),
    /Остаток уже изменился/,
  );
  assert.deepEqual(
    (
      await db.query(
        'select * from display_stock_changes where product_id=$1 order by created_at,id',
        [p],
      )
    ).rows,
    history,
  );
});

test('receipts preserve idempotency and original absolute-count watermark after unit enforcement', async () => {
  const b = await branch(),
    p = randomUUID();
  const first = await mutate(b, p, 10);
  await db.query(
    "update branch_product_inventory set manual_counted_at=now()-interval '1 day' where branch_id=$1 and product_id=$2",
    [b, p],
  );
  const before = await row(b, p),
    op = randomUUID();
  const payload = {
    reason: 'receipt',
    unit: 'шт',
    revision: Number(first.stock_revision),
    operationId: op,
  };
  await mutate(b, p, 5, payload);
  assert.equal((await mutate(b, p, 5, payload)).duplicate, true);
  assert.equal(Number((await row(b, p)).source_quantity), 15);
  assert.equal(
    new Date((await row(b, p)).manual_counted_at).getTime(),
    new Date(before.manual_counted_at).getTime(),
  );
  const terminal = randomUUID();
  await db.query('insert into pos_devices(branch_id,terminal_id) values($1,$2)', [b, terminal]);
  await rpc('record_front_offline_receipt', [
    b,
    terminal,
    randomUUID(),
    new Date(Date.now() - 3600000).toISOString(),
    { [p]: 2 },
    200,
  ]);
  assert.equal(Number((await row(b, p)).source_quantity), 13);
});

test('canonical table and alternate RPCs cannot be mutated by public users or direct service table writes', async () => {
  const { rows } = await db.query(`select
    has_table_privilege('service_role','product_inventory_units','update') table_write,
    has_table_privilege('service_role','inventory_reservation_units','update') snapshot_write,
    has_function_privilege('anon','set_product_inventory_unit(text,text,text)','execute') anon_write,
    has_function_privilege('authenticated','update_cashier_inventory(uuid,text,text,bigint,jsonb)','execute') authenticated_write,
    has_function_privilege('authenticated','update_admin_inventory(jsonb)','execute') admin_bypass,
    has_function_privilege('service_role','update_cashier_inventory_before_global_unit(uuid,text,text,bigint,jsonb)','execute') bypass`);
  assert.deepEqual(rows[0], {
    table_write: false,
    snapshot_write: false,
    anon_write: false,
    authenticated_write: false,
    admin_bypass: false,
    bypass: false,
  });
  for (const name of [
    'get_product_inventory_unit(text)',
    'set_product_inventory_unit(text,text,text)',
    'update_cashier_inventory(uuid,text,text,bigint,jsonb)',
    'update_admin_inventory(jsonb)',
    'apply_front_inventory_snapshot(uuid,uuid,uuid,uuid,bigint,timestamp with time zone,jsonb)',
  ]) {
    const grants = (
      await db.query(
        "select has_function_privilege('anon',$1,'execute') a,has_function_privilege('authenticated',$1,'execute') u,has_function_privilege('service_role',$1,'execute') s",
        [name],
      )
    ).rows[0];
    assert.deepEqual(grants, { a: false, u: false, s: true });
  }
  assert.deepEqual(
    (
      await db.query(
        "select relname,relrowsecurity from pg_class where relname in ('product_inventory_units','inventory_reservation_units') order by relname",
      )
    ).rows,
    [
      { relname: 'inventory_reservation_units', relrowsecurity: true },
      { relname: 'product_inventory_units', relrowsecurity: true },
    ],
  );
});

test('released reservations retain immutable units and cannot be recovered under a later global unit', async () => {
  const b = await branch(),
    p = randomUUID();
  const initial = await mutate(b, p, 5);
  const reservation = randomUUID();
  await db.query(
    `insert into inventory_reservations(id,branch_id,product_id,quantity,status,expires_at)
    values($1,$2,$3,1,'active',now()+interval '1 hour')`,
    [reservation, b, p],
  );
  assert.equal(
    (
      await db.query('select unit from inventory_reservation_units where reservation_id=$1', [
        reservation,
      ])
    ).rows[0].unit,
    'шт',
  );
  await db.query("update inventory_reservations set status='released' where id=$1", [reservation]);
  await mutate(b, p, 0, { revision: Number(initial.stock_revision) });
  await configure(p, 'кг');
  await assert.rejects(
    () =>
      db.query("update inventory_reservations set status='committed' where id=$1", [reservation]),
    /изменилась после/,
  );
  assert.equal(
    (await db.query('select status from inventory_reservations where id=$1', [reservation])).rows[0]
      .status,
    'released',
  );
});

test('replaying a committed arrival after a later empty-stock unit change never adds it again', async () => {
  const b = await branch(),
    p = randomUUID(),
    operationId = randomUUID();
  const receipt = await mutate(b, p, 5, { reason: 'receipt', unit: 'шт', operationId });
  await mutate(b, p, 0, { revision: Number(receipt.stock_revision) });
  await configure(p, 'кг');
  const repeat = await mutate(b, p, 5, { reason: 'receipt', unit: 'шт', operationId });
  assert.equal(repeat.duplicate, true);
  assert.equal(repeat.unit, 'кг');
  assert.equal(Number(repeat.source_quantity), 0);
  const omitted = await mutate(b, p, 5, { reason: 'receipt', operationId });
  assert.equal(omitted.duplicate, true);
  await assert.rejects(
    () => mutate(b, p, 6, { reason: 'receipt', unit: 'шт', operationId }),
    /уже использован/,
  );
});

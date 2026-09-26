const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

async function fixture(run) {
  const db = new PGlite();
  try {
    await require('./helpers/front-tablet-schema.cjs')(db);
    await require('./helpers/front-refund-schema.cjs')(db);
    await db.exec(
      readFileSync('supabase/migrations/20260910147000_preorder_stop_only.sql', 'utf8'),
    );
    await db.exec(
      'alter table branch_product_inventory add column manual_counted_at timestamptz not null default now();',
    );
    await db.exec(
      readFileSync('supabase/migrations/20260926113000_iiko_outgoing_stock.sql', 'utf8'),
    );
    const branch = randomUUID(),
      product = randomUUID(),
      lease = randomUUID();
    await db.query('insert into bulka_locations(id) values($1)', [branch]);
    await db.query(
      "insert into branch_product_inventory(branch_id,product_id,source_quantity,source,manual_counted_at) values($1,$2,10,'admin',now()-interval '2 hours')",
      [branch, product],
    );
    await db.query('select claim_iiko_outgoing_sync($1,$2)', ['aktau', lease]);
    await db.exec("update iiko_outgoing_sync set started_at=now()-interval '1 day'");
    const document = {
      id: randomUUID(),
      number: '000123',
      postedAt: new Date(Date.now() - 3600000).toISOString(),
      status: 'PROCESSED',
      items: [{ branchId: branch, productId: product, quantity: 3, unit: 'шт' }],
    };
    const apply = async (doc = document, token = lease) =>
      (await db.query('select apply_iiko_outgoing_invoice($1,$2,$3) r', ['aktau', token, doc]))
        .rows[0].r;
    const quantity = async () =>
      Number(
        (
          await db.query(
            'select source_quantity from branch_product_inventory where branch_id=$1 and product_id=$2',
            [branch, product],
          )
        ).rows[0].source_quantity,
      );
    await run({ db, branch, product, lease, document, apply, quantity });
  } finally {
    await db.close();
  }
}

test('outgoing stock: posting, duplicate/lost reply, revision and cancellation are atomic', async () =>
  fixture(async ({ document, apply, quantity }) => {
    assert.equal((await apply()).changed, true);
    assert.equal(await quantity(), 7);
    assert.equal((await apply()).duplicate, true);
    assert.equal(await quantity(), 7);
    const revised = { ...document, items: [{ ...document.items[0], quantity: 5 }] };
    await apply(revised);
    assert.equal(await quantity(), 5);
    await apply({ ...revised, status: 'NEW', items: [] });
    assert.equal(await quantity(), 10);
    await apply(revised);
    assert.equal(await quantity(), 5);
    await apply({ ...revised, status: 'DELETED', items: [] });
    assert.equal(await quantity(), 10);
  }));

test('outgoing stock: drafts and history before first worker activation do not reduce stock', async () =>
  fixture(async ({ db, document, apply, quantity }) => {
    await apply({ ...document, status: 'NEW', items: [] });
    assert.equal(await quantity(), 10);
    assert.equal(
      (
        await apply({
          ...document,
          id: randomUUID(),
          postedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
        })
      ).reason,
      'before_tracking',
    );
    assert.equal(await quantity(), 10);
    assert.equal(
      Number((await db.query('select count(*) n from iiko_outgoing_stock_documents')).rows[0].n),
      1,
    );
    await apply();
    assert.equal(await quantity(), 7);
  }));

test('outgoing stock: a later physical count includes old documents and prevents cancellation from inflating stock', async () =>
  fixture(async ({ db, document, apply, quantity }) => {
    await apply();
    await db.exec('update branch_product_inventory set source_quantity=4,manual_counted_at=now()');
    await apply({ ...document, status: 'DELETED', items: [] });
    assert.equal(await quantity(), 4);
    await apply({ ...document, id: randomUUID() });
    assert.equal(await quantity(), 4);
  }));

test('outgoing stock: shortage records actual deduction and cancellation cannot create missing goods', async () =>
  fixture(async ({ document, apply, quantity }) => {
    const large = { ...document, items: [{ ...document.items[0], quantity: 12 }] };
    assert.equal((await apply(large)).shortage, true);
    assert.equal(await quantity(), 0);
    assert.equal(
      (await apply({ ...large, items: [{ ...large.items[0], quantity: 11 }] })).shortage,
      true,
    );
    assert.equal(await quantity(), 0);
    await apply({ ...large, items: [{ ...large.items[0], quantity: 9 }] });
    assert.equal(await quantity(), 1);
    await apply({ ...large, status: 'DELETED', items: [] });
    assert.equal(await quantity(), 10);
  }));

test('outgoing stock: backdating across a count requires reconciliation instead of guessing physical stock', async () =>
  fixture(async ({ db, document, apply, quantity }) => {
    await apply();
    const backdated = { ...document, postedAt: new Date(Date.now() - 3 * 3600000).toISOString() };
    await assert.rejects(apply(backdated), /date crossed a physical count/);
    assert.equal(await quantity(), 7);
    await db.exec('update branch_product_inventory set source_quantity=6,manual_counted_at=now()');
    await apply(backdated);
    assert.equal(await quantity(), 6);
  }));

test('outgoing stock: absolute iiko quantities are not deducted twice; shared ledger quantities are deducted', async () =>
  fixture(async ({ db, branch, apply, quantity }) => {
    await db.exec(
      "select set_config('bulka.stock_follow_iiko','true',false); update branch_product_inventory set source='iiko'",
    );
    assert.equal((await apply()).changed, false);
    assert.equal(await quantity(), 10);
    await db.query(
      'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
      [branch, [randomUUID()]],
    );
    const other = {
      id: randomUUID(),
      number: '2',
      postedAt: new Date(Date.now() - 3000000).toISOString(),
      status: 'PROCESSED',
      items: [
        {
          branchId: branch,
          productId: (await db.query('select product_id from branch_product_inventory')).rows[0]
            .product_id,
          quantity: 2,
          unit: 'шт',
        },
      ],
    };
    await apply(other);
    assert.equal(await quantity(), 8);
  }));

test('outgoing stock: foreign or expired worker lease is rejected and failed pass keeps its cursor', async () =>
  fixture(async ({ db, lease, apply, quantity }) => {
    await assert.rejects(apply(undefined, randomUUID()), /lease expired/);
    const state = (await db.query('select * from iiko_outgoing_sync')).rows[0];
    assert.equal(
      (await db.query('select claim_iiko_outgoing_sync($1,$2) r', ['aktau', randomUUID()])).rows[0]
        .r,
      null,
    );
    await db.query('select finish_iiko_outgoing_sync($1,$2,$3)', ['aktau', lease, null]);
    assert.deepEqual(
      (await db.query('select scan_date from iiko_outgoing_sync')).rows[0].scan_date,
      state.scan_date,
    );
    await assert.rejects(apply(), /lease expired/);
    assert.equal(await quantity(), 10);
  }));

test('outgoing stock: mixed unit or invalid document rolls back without recording its identity', async () =>
  fixture(async ({ db, document, apply, quantity }) => {
    await assert.rejects(
      apply({ ...document, items: [{ ...document.items[0], unit: 'кг' }] }),
      /units differ/,
    );
    await assert.rejects(
      apply({ ...document, items: [{ ...document.items[0], quantity: -1 }] }),
      /Invalid outgoing invoice items/,
    );
    await assert.rejects(
      apply({ ...document, items: [...document.items, ...document.items] }),
      /Invalid outgoing invoice items/,
    );
    assert.equal(
      Number((await db.query('select count(*) n from iiko_outgoing_stock_documents')).rows[0].n),
      0,
    );
    assert.equal(await quantity(), 10);
    await apply();
    assert.equal(await quantity(), 7);
  }));

test('outgoing stock: fractional weight and another product in one invoice roll back together on a unit conflict', async () =>
  fixture(async ({ db, branch, document, apply, quantity }) => {
    const weighted = randomUUID();
    await db.query(
      "insert into branch_product_inventory(branch_id,product_id,source_quantity,source,manual_counted_at,unit,quantity_step) values($1,$2,2,'admin',now()-interval '2 hours','кг',0.001)",
      [branch, weighted],
    );
    const line = { branchId: branch, productId: weighted, quantity: 0.375, unit: 'кг' };
    const bad = { ...document, items: [line, { ...document.items[0], unit: 'л' }] };
    await assert.rejects(apply(bad), /units differ/);
    assert.equal(await quantity(), 10);
    const weight = async () =>
      Number(
        (
          await db.query(
            'select source_quantity from branch_product_inventory where branch_id=$1 and product_id=$2',
            [branch, weighted],
          )
        ).rows[0].source_quantity,
      );
    assert.equal(await weight(), 2);
    const valid = { ...document, items: [line, ...document.items] };
    await apply(valid);
    assert.equal(await weight(), 1.625);
    assert.equal(await quantity(), 7);
    await apply(valid);
    assert.equal(await weight(), 1.625);
  }));

test('outgoing stock: completed Front recount is respected even when manual count timestamp is old', async () =>
  fixture(async ({ db, branch, document, apply, quantity }) => {
    await apply();
    await db.query(
      'insert into front_stock_recounts(id,branch_id,terminal_id,items) values($1,$2,$3,$4)',
      [randomUUID(), branch, randomUUID(), []],
    );
    await db.exec('update branch_product_inventory set source_quantity=4');
    await apply({ ...document, status: 'DELETED', items: [] });
    assert.equal(await quantity(), 4);
  }));

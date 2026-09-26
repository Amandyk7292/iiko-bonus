// Read-only audit of production source; runs migrations in disposable PGlite memory.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

require('node:test')(
  'delayed sale survives an additive arrival but not a later physical count',
  async () => {
    const db = new PGlite();
    try {
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
      const branch = randomUUID(),
        terminal = randomUUID(),
        product = randomUUID();
      await db.query('insert into bulka_locations(id) values($1)', [branch]);
      await db.query('insert into pos_devices(branch_id,terminal_id) values($1,$2)', [
        branch,
        terminal,
      ]);
      await db.query(
        "insert into branch_product_inventory(branch_id,product_id,source_quantity,source,manual_counted_at) values($1,$2,10,'admin',now()-interval '1 day')",
        [branch, product],
      );
      const snapshot = async () =>
        (
          await db.query(
            'select source_quantity,stock_revision,manual_counted_at from branch_product_inventory where branch_id=$1 and product_id=$2',
            [branch, product],
          )
        ).rows[0];
      const before = await snapshot();
      // Register sold two an hour ago during its WAN outage. Tablet stays online.
      const closedAt = new Date(Date.now() - 3600000).toISOString();
      const addition = (
        await db.query('select update_cashier_inventory($1,$2,$3,$4,$5) r', [
          branch,
          product,
          'Audit product',
          Number(before.stock_revision),
          { sourceQuantity: 5, stockReason: 'receipt', operationId: randomUUID(), unit: 'шт' },
        ])
      ).rows[0].r;
      const afterAddition = await snapshot();
      const receipt = randomUUID();
      const delivery = (
        await db.query('select record_front_offline_receipt($1,$2,$3,$4,$5,$6) r', [
          branch,
          terminal,
          receipt,
          closedAt,
          { [product]: 2 },
          200,
        ])
      ).rows[0].r;
      const final = await snapshot();
      assert.equal(Number(addition.addedQuantity), 5);
      assert.equal(Number(final.source_quantity), 13);
      assert.equal(delivery.changed, true);
      assert.equal(
        new Date(afterAddition.manual_counted_at).getTime(),
        new Date(before.manual_counted_at).getTime(),
      );
      const duplicate = (
        await db.query('select record_front_offline_receipt($1,$2,$3,$4,$5,$6) r', [
          branch,
          terminal,
          receipt,
          closedAt,
          { [product]: 2 },
          200,
        ])
      ).rows[0].r;
      assert.equal(duplicate.duplicate, true);
      assert.equal(Number((await snapshot()).source_quantity), 13);
      await db.query('select update_cashier_inventory($1,$2,$3,$4,$5)', [
        branch,
        product,
        'Audit product',
        Number(final.stock_revision),
        { sourceQuantity: 7, stockReason: 'correction', operationId: randomUUID(), unit: 'шт' },
      ]);
      const late = (
        await db.query('select record_front_offline_receipt($1,$2,$3,$4,$5,$6) r', [
          branch,
          terminal,
          randomUUID(),
          closedAt,
          { [product]: 1 },
          100,
        ])
      ).rows[0].r;
      assert.equal(late.changed, false);
      assert.equal(Number((await snapshot()).source_quantity), 7);
    } finally {
      await db.close();
    }
  },
);

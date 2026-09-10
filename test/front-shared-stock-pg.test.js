const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { Client } = require('pg');
const { readFileSync } = require('node:fs');
async function createSchema(db) {
  await require('./helpers/front-tablet-schema.cjs')(db);
  await require('./helpers/front-refund-schema.cjs')(db);
  for (const migration of [
    '20260910147000_preorder_stop_only',
    '20260910148000_tablet_recovery',
    '20260910149000_staff_order_badges',
  ])
    await db.exec(readFileSync(`supabase/migrations/${migration}.sql`, 'utf8'));
}
const url = process.env.FRONT_STOCK_PG_TEST_URL;
const isolated = process.env.FRONT_STOCK_PG_TEST_CONFIRM === 'isolated';

(url && isolated ? test : test.skip)(
  'PostgreSQL: independent cashier and online transactions serialize allocations',
  async (t) => {
    assert.equal(new URL(url).pathname, '/bulka_front_guard_test');
    const admin = new Client({ connectionString: url, application_name: 'bulka-stock-test-admin' });
    const first = new Client({ connectionString: url, application_name: 'bulka-stock-test-first' });
    const second = new Client({
      connectionString: url,
      application_name: 'bulka-stock-test-second',
    });
    await Promise.all([admin.connect(), first.connect(), second.connect()]);
    t.after(async () => {
      await Promise.allSettled([first.query('rollback'), second.query('rollback')]);
      await Promise.allSettled([admin.end(), first.end(), second.end()]);
    });
    assert.equal(
      (
        await admin.query(
          "select count(*)::int n from information_schema.tables where table_schema='public'",
        )
      ).rows[0].n,
      0,
      'Requires a new isolated database',
    );
    await createSchema({ exec: (sql) => admin.query(sql) });
    async function fixture() {
      const branch = randomUUID(),
        terminals = [randomUUID(), randomUUID()];
      await admin.query('insert into bulka_locations(id) values($1)', [branch]);
      await admin.query(
        "insert into branch_product_inventory(branch_id,product_id,source_quantity,front_quantity,front_managed) values($1,'bun',6,6,true)",
        [branch],
      );
      await admin.query(
        'insert into front_stock_policies(branch_id,enabled,terminal_ids) values($1,true,$2)',
        [branch, terminals],
      );
      for (const terminal of terminals)
        await admin.query('select front_stock_heartbeat($1,$2,true)', [branch, terminal]);
      return { branch, terminals };
    }
    const reserve = (client, b) =>
      client.query('select reserve_order_inventory($1,$2,$3,$4)', [
        randomUUID(),
        randomUUID(),
        b.branch,
        JSON.stringify([{ id: 'bun', quantity: 5 }]),
      ]);
    const pos = (client, b, index = 0) => {
      const receipt = randomUUID();
      const key = `bp1:${b.branch}:${createHash('sha256').update(`${b.branch}\0${receipt}`).digest('hex')}`;
      return client.query('select authorize_front_stock_sale($1,$2,$3,$4,$5,$6)', [
        b.branch,
        b.terminals[index],
        receipt,
        { bun: 5 },
        35,
        key,
      ]);
    };
    async function blocked() {
      for (let attempt = 0; attempt < 50; attempt++) {
        const rows = (
          await admin.query(
            "select wait_event_type from pg_stat_activity where application_name='bulka-stock-test-second'",
          )
        ).rows;
        if (rows[0]?.wait_event_type === 'Lock') return;
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.fail('The competing database session did not wait on the allocation lock');
    }
    const outcome = (p) =>
      p.then(
        () => ({ ok: true }),
        (error) => ({ ok: false, code: error.code, message: error.message }),
      );

    await t.test(
      'online reserves five; concurrent cashier blocks then cannot sell the same five',
      async () => {
        const b = await fixture();
        await first.query('begin');
        await reserve(first, b);
        const pending = outcome(pos(second, b));
        await blocked();
        await first.query('commit');
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.code, 'P0001');
        assert.match(result.message, /зарезервирован/);
      },
    );
    await t.test(
      'cashier sells five; concurrent online checkout blocks then rejects overselling',
      async () => {
        const b = await fixture();
        await first.query('begin');
        await pos(first, b);
        const pending = outcome(reserve(second, b));
        await blocked();
        await first.query('commit');
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.code, 'P0001');
        assert.match(result.message, /Недостаточно товара/);
      },
    );
    await t.test(
      'two physical registers share the same lock and cannot both sell five from six',
      async () => {
        const b = await fixture();
        await first.query('begin');
        await pos(first, b, 0);
        const pending = outcome(pos(second, b, 1));
        await blocked();
        await first.query('commit');
        const result = await pending;
        assert.equal(result.ok, false);
        assert.equal(result.code, 'P0001');
        assert.equal(
          Number(
            (
              await admin.query(
                'select source_quantity from branch_product_inventory where branch_id=$1',
                [b.branch],
              )
            ).rows[0].source_quantity,
          ),
          1,
        );
      },
    );
  },
);

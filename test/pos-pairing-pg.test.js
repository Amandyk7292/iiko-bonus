const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { Client } = require('pg');
const url = process.env.POS_PAIRING_PG_TEST_URL;
const enabled = url && process.env.POS_PAIRING_PG_TEST_CONFIRM === 'isolated';

(enabled ? test : test.skip)(
  'PostgreSQL: activation codes serialize across independent POS connections',
  async (t) => {
    assert.match(new URL(url).pathname, /^\/bulka_pos_pairing_test_[0-9_]+$/);
    assert.equal(new URL(url).hostname, '127.0.0.1');
    const a = new Client({ connectionString: url }),
      b = new Client({ connectionString: url });
    await Promise.all([a.connect(), b.connect()]);
    t.after(async () => {
      await Promise.allSettled([a.query('rollback'), b.query('rollback')]);
      await Promise.allSettled([a.end(), b.end()]);
    });
    assert.equal(
      (
        await a.query(
          "select count(*)::int n from information_schema.tables where table_schema='public'",
        )
      ).rows[0].n,
      0,
    );
    await a.query(`create table bulka_locations(id uuid primary key,name text,active boolean default true);
    create table front_stock_policies(branch_id uuid primary key,enabled boolean default false,
      terminal_ids uuid[] check(cardinality(terminal_ids)<=8),updated_at timestamptz default now());`);
    await a.query(
      readFileSync('supabase/migrations/20260910160000_pos_device_pairing.sql', 'utf8'),
    );
    await a.query(
      readFileSync('supabase/migrations/20260910161000_pos_pairing_lock_order.sql', 'utf8'),
    );
    const hash = () => randomUUID().replaceAll('-', '').repeat(2);
    async function fixture() {
      const branch = randomUUID(),
        code = hash(),
        group = randomUUID();
      await a.query('insert into bulka_locations(id,name) values($1,$2)', [branch, 'Test']);
      await a.query('select issue_pos_pairing_code($1,$2)', [branch, code]);
      return { branch, code, group };
    }
    const sql = 'select activate_pos_device($1,$2,$3,$4,$5) result';
    const f = await fixture(),
      t1 = randomUUID(),
      t2 = randomUUID(),
      token1 = hash();
    await a.query('begin');
    await a.query(sql, [f.code, t1, f.group, 'Register 1', token1]);
    let completed = false;
    const losing = b.query(sql, [f.code, t2, f.group, 'Register 2', hash()]).then((result) => {
      completed = true;
      return result;
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
      completed,
      false,
      'The second activation waits for the transaction holding the code',
    );
    await a.query('commit');
    assert.deepEqual((await losing).rows[0].result, { error: 'invalid_code' });
    const code2 = hash();
    await a.query('select issue_pos_pairing_code($1,$2)', [f.branch, code2]);
    await b.query(sql, [code2, t2, f.group, 'Register 2', hash()]);
    const devices = (
      await a.query('select terminal_id,token_hash from pos_devices where branch_id=$1', [f.branch])
    ).rows;
    assert.equal(devices.length, 2);
    assert.equal(devices.find((row) => row.terminal_id === t1).token_hash, token1);
    const retry = await fixture();
    await a.query('begin');
    await a.query(sql, [retry.code, randomUUID(), retry.group, 'Rolled back', hash()]);
    const winner = b.query(sql, [retry.code, randomUUID(), retry.group, 'Retried', hash()]);
    await a.query('rollback');
    assert.equal((await winner).rows[0].result.branchId, retry.branch);
    const replacing = await fixture();
    await a.query('begin');
    await a.query('select 1 from bulka_locations where id=$1 for update', [replacing.branch]);
    const waitingActivation = b.query(sql, [
      replacing.code,
      randomUUID(),
      replacing.group,
      'Late register',
      hash(),
    ]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    await a.query('select issue_pos_pairing_code($1,$2)', [replacing.branch, hash()]);
    await a.query('commit');
    assert.deepEqual((await waitingActivation).rows[0].result, { error: 'invalid_code' });
  },
);

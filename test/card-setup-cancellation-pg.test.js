const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');

test('card closure migration preserves private ownership and encrypted late reconciliation without erasing financial state', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table customer_payment_method_setups (
        id uuid primary key, customer_id uuid not null,
        status text not null check(status in ('pending','paid','failed','expired')),
        created_at timestamptz not null default now(), checkout_token_ciphertext text,
        constraint customer_payment_method_setups_token_check check (
          (status='pending' and char_length(checkout_token_ciphertext) between 40 and 2000
           and checkout_token_ciphertext like 'v2.%')
          or (status<>'pending' and checkout_token_ciphertext is null)
        )
      );
      alter table customer_payment_method_setups enable row level security;
      revoke all on customer_payment_method_setups from public, anon, authenticated;
      grant all on customer_payment_method_setups to service_role;
      create policy service_only on customer_payment_method_setups for all to service_role using(true) with check(true);
    `);
    const sql = fs.readFileSync(
      path.join(
        __dirname,
        '../supabase/migrations/20261006190000_forte_card_setup_cancellation.sql',
      ),
      'utf8',
    );
    await db.exec(sql);
    await db.exec(sql);
    const id = '11111111-1111-4111-8111-111111111111';
    const encrypted = `v2.${'a'.repeat(64)}`;
    await db.query(
      'insert into customer_payment_method_setups(id,customer_id,status,checkout_token_ciphertext) values($1,$2,$3,$4)',
      [id, '22222222-2222-4222-8222-222222222222', 'pending', encrypted],
    );
    await db.query(
      'update customer_payment_method_setups set cancel_requested_at=now() where id=$1',
      [id],
    );
    const closed = (
      await db.query('select * from customer_payment_method_setups where id=$1', [id])
    ).rows[0];
    assert.equal(closed.status, 'pending');
    assert.equal(closed.checkout_token_ciphertext, encrypted);
    assert.ok(closed.cancel_requested_at);
    for (const status of ['failed', 'expired']) {
      await db.query('update customer_payment_method_setups set status=$1 where id=$2', [
        status,
        id,
      ]);
      assert.equal(
        (
          await db.query(
            'select checkout_token_ciphertext from customer_payment_method_setups where id=$1',
            [id],
          )
        ).rows[0].checkout_token_ciphertext,
        encrypted,
      );
    }
    await assert.rejects(
      db.query("update customer_payment_method_setups set status='paid' where id=$1", [id]),
      /token_check/,
    );
    await assert.rejects(
      db.query(
        "update customer_payment_method_setups set checkout_token_ciphertext='plaintext' where id=$1",
        [id],
      ),
      /token_check/,
    );
    await db.query(
      "update customer_payment_method_setups set status='paid', checkout_token_ciphertext=null where id=$1",
      [id],
    );
    await assert.rejects(
      db.query("update customer_payment_method_setups set status='pending' where id=$1", [id]),
      /token_check/,
    );
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(
        db.query('select * from customer_payment_method_setups'),
        /permission denied/,
      );
      await assert.rejects(
        db.query('update customer_payment_method_setups set cancel_requested_at=null'),
        /permission denied/,
      );
      await db.exec('reset role');
    }
  } finally {
    await db.close();
  }
});

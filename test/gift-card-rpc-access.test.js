const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

const targets = [
  ['reserve_gift_card_for_iiko', 'text,uuid,text,numeric,uuid,integer'],
  ['prepare_gift_card_for_iiko', 'uuid,uuid,uuid'],
  ['commit_gift_card_for_iiko', 'uuid,uuid'],
  ['cancel_gift_card_for_iiko', 'uuid,uuid'],
  ['redeem_gift_card', 'text,uuid'],
  ['activate_gift_certificate_purchase', 'uuid'],
  ['prepare_gift_certificate_refund', 'uuid'],
  ['rollback_gift_certificate_refund', 'uuid'],
  ['finalize_gift_certificate_refund', 'uuid'],
  [
    'issue_admin_gift_card',
    'uuid,text,text,text,text,numeric,uuid,uuid,text,text,timestamptz,text,numeric,integer',
  ],
];

test('gift RPC ACL migration removes explicit Supabase grants and preserves backend settlement', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create role untrusted_role;
      grant usage on schema public to anon,authenticated,service_role,untrusted_role;
      alter default privileges in schema public grant execute on functions to anon,authenticated;
      create table gift_cards(id uuid primary key,balance numeric,active boolean,expires_at timestamptz,
        redeemed_at timestamptz,recipient_customer_id uuid);
      create table gift_card_pos_reservations(id uuid primary key,gift_card_id uuid,status text,
        amount numeric,expires_at timestamptz,prepared_at timestamptz,prepare_request_id uuid,
        commit_request_id uuid,balance_after numeric,committed_at timestamptz,updated_at timestamptz);
      create table gift_card_transactions(gift_card_id uuid,customer_id uuid,order_id uuid,
        pos_reservation_id uuid,type text,amount numeric);`);
    for (const [name, argumentsSql] of targets) {
      // Lightweight bodies isolate privilege behavior for the other entry points.
      // The settlement function below uses the exact shipped financial SQL body.
      if (name === 'commit_gift_card_for_iiko') continue;
      await db.exec(`create function public.${name}(${argumentsSql}) returns jsonb
        language sql security definer as $$ select '{}'::jsonb $$;`);
    }
    const preparation = readFileSync(
      'supabase/migrations/20260926112000_pos_settlement_preparation.sql',
      'utf8',
    );
    const start = preparation.indexOf(
      'create or replace function public.commit_gift_card_for_iiko(',
    );
    const commitSql = preparation.slice(start, preparation.indexOf('$$;', start) + 3);
    await db.exec(commitSql);
    // Historical revoke-PUBLIC leaves explicit anon/authenticated grants intact.
    await db.exec(
      'revoke all on function public.commit_gift_card_for_iiko(uuid,uuid) from public;',
    );
    await db.exec(commitSql);
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('anon','public.commit_gift_card_for_iiko(uuid,uuid)','EXECUTE') allowed",
        )
      ).rows[0].allowed,
      true,
    );
    const before = (
      await db.query("select prosrc from pg_proc where proname='commit_gift_card_for_iiko'")
    ).rows[0].prosrc;
    const migration = readFileSync(
      'supabase/migrations/20260926115000_gift_card_rpc_access.sql',
      'utf8',
    );
    await db.exec(migration);
    // ACL-only migrations are safe to retry and must not rewrite the financial body.
    await db.exec(migration);
    assert.equal(
      (await db.query("select prosrc from pg_proc where proname='commit_gift_card_for_iiko'"))
        .rows[0].prosrc,
      before,
    );
    for (const role of ['anon', 'authenticated', 'untrusted_role', 'service_role']) {
      for (const [name, argumentsSql] of targets) {
        const { rows } = await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [
          role,
          `public.${name}(${argumentsSql})`,
        ]);
        assert.equal(rows[0].allowed, role === 'service_role', `${role}: ${name}`);
      }
    }
    const card = randomUUID(),
      reservation = randomUUID(),
      request = randomUUID();
    await db.query('insert into gift_cards(id,balance,active) values($1,1000,true)', [card]);
    await db.query(
      "insert into gift_card_pos_reservations(id,gift_card_id,status,amount,expires_at) values($1,$2,'active',250,now()+interval '1 hour')",
      [reservation, card],
    );
    for (const role of ['anon', 'authenticated', 'untrusted_role']) {
      await db.exec(`set role ${role}`);
      try {
        await assert.rejects(
          db.query('select commit_gift_card_for_iiko($1,$2)', [reservation, request]),
          { code: '42501' },
        );
        for (const [name, argumentsSql] of targets) {
          if (name === 'commit_gift_card_for_iiko') continue;
          const nulls = argumentsSql
            .split(',')
            .map((type) => `null::${type}`)
            .join(',');
          await assert.rejects(db.query(`select public.${name}(${nulls})`), { code: '42501' });
        }
      } finally {
        await db.exec('reset role');
      }
    }
    assert.equal(
      Number(
        (await db.query('select balance from gift_cards where id=$1', [card])).rows[0].balance,
      ),
      1000,
    );
    await db.exec('set role service_role');
    try {
      const first = (
        await db.query('select commit_gift_card_for_iiko($1,$2) result', [reservation, request])
      ).rows[0].result;
      const retry = (
        await db.query('select commit_gift_card_for_iiko($1,$2) result', [reservation, request])
      ).rows[0].result;
      assert.equal(first.balanceAfter, 750);
      assert.equal(retry.duplicate, true);
    } finally {
      await db.exec('reset role');
    }
    assert.equal(
      Number(
        (await db.query('select balance from gift_cards where id=$1', [card])).rows[0].balance,
      ),
      750,
    );
    assert.equal(
      (await db.query('select count(*)::integer count from gift_card_transactions')).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});

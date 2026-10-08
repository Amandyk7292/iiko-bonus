const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const test = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const migration = (name) => readFileSync(`supabase/migrations/${name}`, 'utf8');
const body = (file, name) =>
  migration(file).match(
    new RegExp(`create(?: or replace)? function public\\.${name}\\([\\s\\S]*?\\$\\$;`, 'i'),
  )[0];

test('manual withdrawals preserve live POS holds and their idempotent retries', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,deleted_at timestamptz);
    create table personal_accounts(customer_id uuid primary key,balance_minor bigint,updated_at timestamptz);
    create table personal_account_entries(id uuid default gen_random_uuid(),customer_id uuid,amount_minor bigint,kind text,source_key text unique,description text,created_by text);
    create table personal_account_admin_adjustments(customer_id uuid,request_id uuid unique,entry_id uuid,amount_minor bigint,reason text,admin_subject text);
    create table personal_account_pos_payments(id uuid primary key,customer_id uuid,amount_minor bigint,status text,expires_at timestamptz,family_member_id uuid,family_qr_version int,family_qr_expires_at timestamptz);
    create table family_members(id uuid,group_id uuid,status text,blocked boolean,qr_version int);
    create table family_groups(id uuid,owner_customer_id uuid);`);
  await db.exec(
    body('20261004100000_personal_account_authorized_holds.sql', 'personal_account_held_minor'),
  );
  await db.exec(migration('20261008150000_admin_adjustment_available_balance.sql'));
  const customer = randomUUID();
  await db.query('insert into customers values($1,null)', [customer]);
  await db.query('insert into personal_accounts(customer_id,balance_minor) values($1,100000)', [
    customer,
  ]);
  await db.query(
    "insert into personal_account_pos_payments(id,customer_id,amount_minor,status,expires_at) values($1,$2,50000,'authorized',now()+interval '5 minutes')",
    [randomUUID(), customer],
  );
  const adjust = (amount, key = randomUUID()) =>
    db.query("select admin_adjust_personal_account($1,$2,$3,'fixture adjustment','owner') result", [
      customer,
      amount,
      key,
    ]);
  await assert.rejects(adjust(-60000), /insufficient personal account balance/);
  assert.equal(
    (await db.query('select count(*)::int n from personal_account_entries')).rows[0].n,
    0,
  );
  const request = randomUUID();
  assert.equal((await adjust(-50000, request)).rows[0].result.balanceMinor, 50000);
  assert.equal((await adjust(-50000, request)).rows[0].result.duplicate, true);
  await assert.rejects(adjust(-1), /insufficient personal account balance/);
  await db.exec("update personal_account_pos_payments set expires_at=now()-interval '1 second'");
  assert.equal((await adjust(-50000)).rows[0].result.balanceMinor, 0);
});

test('gift settlement and cancellation atomically require the reservation branch', async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table gift_cards(id uuid primary key,balance numeric,active boolean,expires_at timestamptz,redeemed_at timestamptz,recipient_customer_id uuid);
    create table gift_card_pos_reservations(id uuid primary key,branch_id uuid,gift_card_id uuid,status text,amount numeric,expires_at timestamptz,prepared_at timestamptz,prepare_request_id uuid,commit_request_id uuid,balance_after numeric,committed_at timestamptz,cancel_request_id uuid,cancelled_at timestamptz,updated_at timestamptz);
    create table gift_card_transactions(gift_card_id uuid,customer_id uuid,order_id uuid,pos_reservation_id uuid,type text,amount numeric);`);
  await db.exec(body('20260926112000_pos_settlement_preparation.sql', 'commit_gift_card_for_iiko'));
  await db.exec(body('20260729160000_business_foundation.sql', 'cancel_gift_card_for_iiko'));
  await db.exec(migration('20261008150100_gift_card_branch_mutations.sql'));
  const branch = randomUUID(),
    other = randomUUID(),
    card = randomUUID();
  await db.query('insert into gift_cards(id,balance,active) values($1,1000,true)', [card]);
  for (const action of ['commit', 'cancel']) {
    const reservation = randomUUID(),
      request = randomUUID();
    await db.query(
      "insert into gift_card_pos_reservations(id,branch_id,gift_card_id,status,amount,expires_at) values($1,$2,$3,'active',250,now()+interval '1 hour')",
      [reservation, branch, card],
    );
    const mutate = (owner) =>
      db.query(`select ${action}_gift_card_for_iiko_scoped($1,$2,$3) result`, [
        owner,
        reservation,
        request,
      ]);
    await assert.rejects(mutate(other), { code: '42501' });
    await assert.rejects(mutate(null), { code: '42501' });
    assert.equal(
      (await db.query('select status from gift_card_pos_reservations where id=$1', [reservation]))
        .rows[0].status,
      'active',
    );
    assert.equal(
      (await mutate(branch)).rows[0].result.status,
      action === 'commit' ? 'committed' : 'cancelled',
    );
    assert.equal((await mutate(branch)).rows[0].result.duplicate, true);
    await assert.rejects(mutate(other), { code: '42501' });
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.equal(
        (
          await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [
            role,
            `public.${action}_gift_card_for_iiko_scoped(uuid,uuid,uuid)`,
          ])
        ).rows[0].allowed,
        role === 'service_role',
      );
    }
  }
  assert.equal(Number((await db.query('select balance from gift_cards')).rows[0].balance), 750);
  assert.equal((await db.query('select count(*)::int n from gift_card_transactions')).rows[0].n, 1);
});

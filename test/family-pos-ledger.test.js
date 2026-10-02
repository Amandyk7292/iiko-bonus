const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const one = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const rpc = async (sql, args = []) => (await one(`select ${sql} as r`, args)).r;
const passwordHash = bcrypt.hashSync('Child2026', 4);
const fingerprint = 'b'.repeat(64);
let phoneSequence = 0;

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,name text not null,phone text not null,
      balance numeric default 0,total_spent numeric default 0,created_at timestamptz default now(),
      deleted_at timestamptz,preferred_language text default 'ru');
    create table bulka_locations(id uuid primary key,active boolean default true,name text);
    create table customer_notifications(id uuid primary key,customer_id uuid,title text,body text,type text,payload jsonb);
    create table kaspi_orders(id uuid primary key,customer_id uuid,payment_method text,order_kind text default 'product',
      status text default 'pending',fulfillment_status text default 'pending',amount numeric,provider_status text,
      payment_reconciled_at timestamptz,updated_at timestamptz default now());`);
  for (const migration of [
    '20260912090000_personal_account.sql',
    '20260924010000_personal_account_pos.sql',
    '20260924050000_personal_pos_terminal_state.sql',
    '20260924160000_personal_pos_notice_amount.sql',
    '20261002170000_customer_family.sql',
    '20261002171000_family_pos_wallet.sql',
  ])
    await db.exec(fs.readFileSync(`supabase/migrations/${migration}`, 'utf8'));
});
test.after(() => db.close());

test('invitations create a durable inbox record only for the addressed recipient', async () => {
  const owner = await customer('Parent');
  const adult = await customer('Adult');
  const result = await rpc('family_invite($1,$2,$3,$4)', [owner.id, adult.phone, 'sister', 0]);
  assert.equal(result.status, 'ok');
  const notice = await one(
    'select customer_id,title,body,payload from customer_notifications where id=$1',
    [result.notificationId],
  );
  assert.equal(notice.customer_id, adult.id);
  assert.ok(notice.body.includes('Parent'));
  assert.ok(notice.body.includes('принять или отклонить'));
  assert.equal(notice.payload.invitationId, result.invitationId);
  assert.equal(
    (await rpc('family_invite($1,$2,$3,$4)', [owner.id, adult.phone, 'sister', 0])).status,
    'rate_limited',
  );
  assert.equal(
    Number(
      (await one('select count(*) n from customer_notifications where customer_id=$1', [adult.id]))
        .n,
    ),
    1,
  );
});

test('owner deletion respects the unsettled-wallet guard and revokes family access once deletion is allowed', async () => {
  const funded = await fixture();
  const hold = payment(funded, 10000);
  assert.equal((await start(hold)).status, 'authorized');
  await assert.rejects(
    db.query('update customers set deleted_at=now() where id=$1', [funded.owner.id]),
    /unsettled funds/,
  );
  assert.equal(
    (await one('select status from family_members where id=$1', [funded.member])).status,
    'active',
  );
  assert.equal(
    (await one('select status from personal_account_pos_payments where id=$1', [hold.id])).status,
    'authorized',
  );
  const f = await fixture({ wallet: 0 });
  const adult = await customer();
  assert.equal(
    (await rpc('family_invite($1,$2,$3,$4)', [f.owner.id, adult.phone, 'wife', 0])).status,
    'ok',
  );
  await db.query('update customers set deleted_at=now() where id=$1', [f.owner.id]);
  const member = await one('select status,blocked,auth_version from family_members where id=$1', [
    f.member,
  ]);
  assert.equal(member.status, 'removed');
  assert.equal(member.blocked, true);
  assert.equal(Number(member.auth_version), 2);
  const removal = await one(
    'select action,details from family_audit where member_id=$1 order by id desc limit 1',
    [f.member],
  );
  assert.equal(removal.action, 'member_removed');
  assert.equal(removal.details.reason, 'account_deleted');
  assert.equal(
    (await one('select status from family_invitations where recipient_customer_id=$1', [adult.id]))
      .status,
    'cancelled',
  );
});

async function customer(name = 'Adult') {
  const id = crypto.randomUUID();
  const phone = `7700${String(++phoneSequence).padStart(7, '0')}`;
  await db.query(
    'insert into customers(id,name,phone,balance,total_spent) values($1,$2,$3,321,987)',
    [id, name, phone],
  );
  return { id, phone };
}
async function createChild(owner, limit = 60000) {
  const result = await rpc('family_create_child($1,$2,$3,$4,$5,$6)', [
    owner.id,
    'Child',
    `kid_${crypto.randomUUID().replaceAll('-', '')}`.slice(0, 32),
    'child@example.com',
    passwordHash,
    limit,
  ]);
  assert.equal(result.status, 'ok');
  return result.memberId;
}
async function fixture({ limit = 60000, wallet = 100000 } = {}) {
  const owner = await customer('Parent');
  const member = await createChild(owner, limit);
  const branch = crypto.randomUUID();
  await db.query('insert into bulka_locations(id,name) values($1,$2)', [branch, 'Bulka']);
  await db.query('insert into personal_accounts(customer_id,balance_minor) values($1,$2)', [
    owner.id,
    wallet,
  ]);
  return { owner, member, branch };
}
function payment(f, amount = 40000) {
  return {
    ...f,
    id: crypto.randomUUID(),
    request: crypto.randomUUID(),
    order: crypto.randomUUID(),
    txn: crypto.randomUUID(),
    amount,
  };
}
async function start(p, overrides = {}) {
  return rpc('family_pos_start($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [
    p.id,
    p.request,
    p.member,
    overrides.version ?? 1,
    overrides.expiresAt || new Date(Date.now() + 240000).toISOString(),
    p.branch,
    p.order,
    p.amount,
    fingerprint,
    'a'.repeat(64),
    crypto.randomUUID(),
  ]);
}
async function action(p, value, overrides = {}) {
  return rpc('personal_account_pos_action($1,$2,$3,$4,$5,$6,$7,$8)', [
    p.id,
    overrides.branch || p.branch,
    p.order,
    overrides.amount || p.amount,
    overrides.fingerprint || fingerprint,
    value,
    null,
    overrides.txn || p.txn,
  ]);
}
async function update(f, limit = null, blocked = null, hash = null) {
  return rpc('family_update_member($1,$2,$3,$4,$5)', [f.owner.id, f.member, limit, blocked, hash]);
}
async function wallet(f) {
  return Number(
    (await one('select balance_minor from personal_accounts where customer_id=$1', [f.owner.id]))
      .balance_minor,
  );
}

test('only the addressed adult can decide; joining preserves existing individual bonuses', async () => {
  const owner = await customer('Parent');
  const adult = await customer('Wife');
  const stranger = await customer('Stranger');
  const invited = await rpc('family_invite($1,$2,$3,$4)', [owner.id, adult.phone, 'wife', 50000]);
  assert.equal(invited.status, 'ok');
  assert.equal(
    (await rpc('family_answer_invitation($1,$2,true)', [stranger.id, invited.invitationId])).status,
    'not_found',
  );
  assert.equal(
    (await rpc('family_answer_invitation($1,$2,true)', [adult.id, invited.invitationId])).status,
    'accepted',
  );
  assert.equal(
    (await rpc('family_answer_invitation($1,$2,true)', [adult.id, invited.invitationId])).status,
    'accepted',
  );
  const membership = await one('select * from family_members where customer_id=$1', [adult.id]);
  assert.equal(membership.relation, 'wife');
  assert.equal(Number(membership.daily_limit_minor), 50000);
  assert.equal((await one('select family_bonus_owner($1) owner', [adult.id])).owner, owner.id);
  assert.equal(
    Number((await one('select balance from customers where id=$1', [adult.id])).balance),
    321,
  );
  assert.equal(
    (await one('select count(*) n from family_members where customer_id=$1', [adult.id])).n,
    1,
  );
});

test('declining or expiring an invitation creates no family access', async () => {
  const owner = await customer();
  const adult = await customer();
  const invitation = await rpc('family_invite($1,$2,$3,0)', [owner.id, adult.phone, 'brother']);
  assert.equal(
    (await rpc('family_answer_invitation($1,$2,false)', [adult.id, invitation.invitationId]))
      .status,
    'declined',
  );
  assert.equal(
    (await rpc('family_answer_invitation($1,$2,true)', [adult.id, invitation.invitationId])).status,
    'declined',
  );
  assert.equal((await one('select family_bonus_owner($1) owner', [adult.id])).owner, adult.id);
  const next = await rpc('family_invite($1,$2,$3,0)', [owner.id, adult.phone, 'brother']);
  await db.query("update family_invitations set expires_at=now()-interval '1 second' where id=$1", [
    next.invitationId,
  ]);
  assert.equal(
    (await rpc('family_answer_invitation($1,$2,true)', [adult.id, next.invitationId])).status,
    'expired',
  );
});

test('an empty previous family does not shadow a subsequently accepted family', async () => {
  const owner = await customer('Joined family owner');
  const adult = await customer('Joining adult');
  await one('select family_owner_group($1) gid', [adult.id]);
  const invitation = await rpc('family_invite($1,$2,$3,0)', [owner.id, adult.phone, 'sister']);
  await rpc('family_answer_invitation($1,$2,true)', [adult.id, invitation.invitationId]);
  const summary = await rpc('family_summary($1)', [adult.id]);
  assert.equal(summary.isOwner, false);
  assert.equal(summary.ownerName, 'Joined family owner');
  assert.ok(summary.memberId);
});

test('only the owner changes a member; adults can leave only their own membership', async () => {
  const f = await fixture();
  const stranger = await customer();
  assert.equal(
    (await rpc('family_update_member($1,$2,1,true,null)', [stranger.id, f.member])).status,
    'not_found',
  );
  assert.equal(
    (await rpc('family_remove_member($1,$2)', [stranger.id, f.member])).status,
    'not_found',
  );
  const adult = await customer();
  const invitation = await rpc('family_invite($1,$2,$3,0)', [f.owner.id, adult.phone, 'mother']);
  await rpc('family_answer_invitation($1,$2,true)', [adult.id, invitation.invitationId]);
  const member = (await one('select id from family_members where customer_id=$1', [adult.id])).id;
  assert.equal(
    (await rpc('family_update_member($1,$2,null,null,$3)', [f.owner.id, member, passwordHash]))
      .status,
    'forbidden',
  );
  assert.equal(
    (
      await rpc('family_create_child($1,$2,$3,$4,$5,0)', [
        adult.id,
        'Child',
        'not_owner',
        'x@example.com',
        passwordHash,
      ])
    ).status,
    'forbidden',
  );
  assert.equal(
    (await rpc('family_remove_member($1,$2)', [adult.id, f.member])).status,
    'not_found',
  );
  assert.equal((await rpc('family_remove_member($1,$2)', [adult.id, member])).status, 'removed');
});

test('child credentials require a hash, remain unique after removal and are private from other members', async () => {
  const f = await fixture();
  const child = await one('select * from family_members where id=$1', [f.member]);
  assert.equal(child.customer_id, null);
  assert.equal(await bcrypt.compare('Child2026', child.password_hash), true);
  for (const [login, hash] of [
    [null, passwordHash],
    ['null_hash', null],
    ['plain_hash', 'Child2026'],
  ]) {
    await assert.rejects(
      db.query(
        "insert into family_members(group_id,name,relation,login,email,password_hash) values($1,'Invalid','child',$2,'x@example.com',$3)",
        [child.group_id, login, hash],
      ),
      /check constraint/i,
    );
  }
  await rpc('family_remove_member($1,$2)', [f.owner.id, f.member]);
  assert.equal(
    (
      await rpc('family_create_child($1,$2,$3,$4,$5,0)', [
        f.owner.id,
        'Replacement',
        child.login,
        child.email,
        passwordHash,
      ])
    ).status,
    'conflict',
  );
  const nextChild = await createChild(f.owner);
  const adult = await customer();
  const invite = await rpc('family_invite($1,$2,$3,0)', [f.owner.id, adult.phone, 'father']);
  await rpc('family_answer_invitation($1,$2,true)', [adult.id, invite.invitationId]);
  const summary = await rpc('family_summary($1)', [adult.id]);
  const visibleChild = summary.members.find((member) => member.id === nextChild);
  assert.equal(visibleChild.login, null);
  assert.equal(visibleChild.email, null);
  assert.equal(visibleChild.dailyLimit, null);
  assert.equal(JSON.stringify(summary).includes(passwordHash), false);
});

test('family records and privileged functions are unavailable to public and authenticated database roles', async () => {
  for (const role of ['anon', 'authenticated']) {
    for (const table of [
      'family_groups',
      'family_members',
      'family_invitations',
      'family_child_sessions',
      'family_audit',
    ]) {
      assert.equal(
        (await one('select has_table_privilege($1,$2,$3) allowed', [role, table, 'SELECT']))
          .allowed,
        false,
      );
    }
    for (const signature of [
      'family_summary(uuid)',
      'family_create_child(uuid,text,text,text,text,bigint)',
      'family_update_member(uuid,uuid,bigint,boolean,text)',
      'family_pos_start(uuid,uuid,uuid,integer,timestamp with time zone,uuid,uuid,bigint,text,text,uuid)',
      'personal_account_pos_action(uuid,uuid,uuid,bigint,text,text,text,uuid)',
    ]) {
      assert.equal(
        (await one('select has_function_privilege($1,$2,$3) allowed', [role, signature, 'EXECUTE']))
          .allowed,
        false,
      );
    }
  }
});

test('simultaneous authorizations reserve the daily cap; duplicated payment and refund each affect money once', async () => {
  const f = await fixture({ limit: 60000 });
  const p = payment(f, 40000);
  const other = payment(f, 30000);
  const attempts = await Promise.all([start(p), start(other)]);
  assert.deepEqual(
    attempts.map((r) => r.status),
    ['authorized', 'family_limit'],
  );
  assert.equal(attempts[0].familyBonusCustomerId, f.owner.id);
  assert.equal(await wallet(f), 100000);
  assert.equal((await start(p)).id, p.id);
  const payments = await Promise.all([action(p, 'pay'), action(p, 'pay')]);
  assert.deepEqual(
    payments.map((r) => r.status),
    ['paid', 'paid'],
  );
  assert.ok(payments.every((r) => r.familyBonusCustomerId === f.owner.id));
  assert.equal((await action(p, 'status')).familyBonusCustomerId, f.owner.id);
  assert.equal(await wallet(f), 60000);
  assert.equal(Number((await rpc('family_member_wallet_stats($1)', [f.member])).spentToday), 400);
  assert.equal((await start(other)).status, 'family_limit');
  await rpc('family_remove_member($1,$2)', [f.owner.id, f.member]);
  const refunded = await action(p, 'refund');
  assert.equal(refunded.status, 'refunded');
  assert.equal(refunded.familyBonusCustomerId, f.owner.id);
  assert.equal((await action(p, 'refund')).status, 'refunded');
  assert.equal(await wallet(f), 100000);
  assert.equal(
    Number(
      (
        await one('select count(*) n from personal_account_entries where customer_id=$1', [
          f.owner.id,
        ])
      ).n,
    ),
    2,
  );
});

test('different family members reserve the same owner wallet and cannot collectively exceed its balance', async () => {
  const f = await fixture({ limit: 100000, wallet: 70000 });
  const secondMember = await createChild(f.owner, 100000);
  const first = payment(f, 50000);
  const second = payment({ ...f, member: secondMember }, 40000);
  const results = await Promise.all([start(first), start(second)]);
  assert.deepEqual(
    results.map((r) => r.status),
    ['authorized', 'insufficient'],
  );
  await action(first, 'cancel');
  assert.equal((await start(second)).status, 'authorized');
  assert.equal(await wallet(f), 70000);
});

test('payment is bound to branch, order fingerprint, amount and transaction identity', async () => {
  const f = await fixture();
  const p = payment(f);
  await start(p);
  assert.equal((await action(p, 'confirm')).status, 'unauthorized');
  assert.equal((await action(p, 'pay', { branch: crypto.randomUUID() })).status, 'not_found');
  assert.equal((await action(p, 'pay', { amount: p.amount + 1 })).status, 'mismatch');
  assert.equal((await action(p, 'pay', { fingerprint: 'c'.repeat(64) })).status, 'mismatch');
  assert.equal(await wallet(f), 100000);
  assert.equal((await action(p, 'pay')).status, 'paid');
  assert.equal((await action(p, 'pay', { txn: crypto.randomUUID() })).status, 'mismatch');
  assert.equal(await wallet(f), 60000);
});

test('limit changes, blocking, password changes and removal revoke outstanding payment QR', async () => {
  for (const change of ['limit', 'block', 'password', 'remove']) {
    const f = await fixture();
    const p = payment(f);
    await start(p);
    if (change === 'remove') await rpc('family_remove_member($1,$2)', [f.owner.id, f.member]);
    else
      await update(
        f,
        change === 'limit' ? 30000 : null,
        change === 'block' ? true : null,
        change === 'password' ? passwordHash : null,
      );
    assert.equal((await action(p, 'pay')).status, 'family_blocked', change);
    assert.equal(await wallet(f), 100000, change);
    assert.equal((await start(payment(f))).status, 'family_blocked', change);
    if (change === 'limit') {
      assert.equal((await start(payment(f, 20000), { version: 2 })).status, 'authorized');
      const row = await one('select auth_version,qr_version from family_members where id=$1', [
        f.member,
      ]);
      assert.equal(row.auth_version, 1);
      assert.equal(row.qr_version, 2);
    }
  }
});

test('expired proof cannot authorize or pay, and Kazakhstan midnight resets only the daily allowance', async () => {
  const f = await fixture({ limit: 50000, wallet: 150000 });
  assert.equal(
    (await start(payment(f), { expiresAt: new Date(Date.now() - 1000).toISOString() })).status,
    'expired',
  );
  const previous = payment(f, 50000);
  await start(previous);
  await action(previous, 'pay');
  assert.equal((await start(payment(f, 100))).status, 'family_limit');
  await db.query(
    "update personal_account_pos_payments set family_paid_at=(date_trunc('day',now() at time zone 'Asia/Almaty') at time zone 'Asia/Almaty')-interval '1 second' where id=$1",
    [previous.id],
  );
  const today = payment(f, 50000);
  assert.equal((await start(today)).status, 'authorized');
  await db.query(
    "update personal_account_pos_payments set family_qr_expires_at=now()-interval '1 second',expires_at=now()-interval '1 second' where id=$1",
    [today.id],
  );
  assert.equal((await action(today, 'pay')).status, 'expired');
  assert.equal(await wallet(f), 100000);
});

test('blocked owner wallet displays no spendable family allowance', async () => {
  const f = await fixture();
  await db.query('update personal_accounts set blocked=true where customer_id=$1', [f.owner.id]);
  assert.equal(Number((await rpc('family_member_wallet_stats($1)', [f.member])).remainingToday), 0);
  assert.equal((await start(payment(f))).status, 'blocked');
});

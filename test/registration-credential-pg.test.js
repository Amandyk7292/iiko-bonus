const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
const { ensureRegistrationCredential } = require('../src/services/customer-password-auth.service');
const db = new PGlite();
const passwordHash = '$2b$12$' + 'a'.repeat(53);
let sequence = 3000000;
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, phone text unique, name text, deleted_at timestamptz, app_registered_at timestamptz);
    create table whatsapp_sessions(id text primary key, data jsonb, expires_at timestamptz, updated_at timestamptz);
    create table customer_refresh_tokens(customer_id uuid, revoked_at timestamptz);
    create table credential_test_failure(operation text);
    insert into credential_test_failure values(null);`);
  await db.exec(
    readFileSync('supabase/migrations/20260722223000_customer_password_auth.sql', 'utf8'),
  );
  await db.exec(
    readFileSync('supabase/migrations/20261003231000_registration_credential_atomic.sql', 'utf8'),
  );
  await db.exec(`create function credential_test_fault() returns trigger language plpgsql as $$
    begin
      if exists(select 1 from credential_test_failure where operation = TG_ARGV[0]) then
        raise exception 'Injected storage failure';
      end if;
      if TG_OP = 'DELETE' then return OLD; end if;
      return NEW;
    end; $$;
    create trigger credential_test_insert before insert on customer_credentials for each row execute function credential_test_fault('credential');
    create trigger credential_test_grant_delete before delete on whatsapp_sessions for each row execute function credential_test_fault('grant');`);
});
test.after(() => db.close());
async function person() {
  const p = {
    id: randomUUID(),
    phone: '+7700' + ++sequence,
    grantId: randomUUID().replace(/-/g, '') + 'ExtraGrantToken',
  };
  p.grantKey = 'registration_grant_' + createHash('sha256').update(p.grantId).digest('hex');
  await db.query('insert into customers(id,phone,name) values($1,$2,$3)', [
    p.id,
    p.phone,
    'Новый Гость',
  ]);
  await saveGrant(p);
  return p;
}
async function saveGrant(p, changes = {}) {
  const payload = { phone: p.phone, passwordHash, expires: Date.now() + 600000, ...changes };
  await db.query(
    "insert into whatsapp_sessions(id,data,expires_at) values($1,$2,now()+interval '10 minutes')",
    [p.grantKey, payload],
  );
}
async function ensure(p) {
  return (
    await db.query('select create_customer_credential_from_registration_grant($1,$2,$3) version', [
      p.id,
      p.phone,
      p.grantKey,
    ])
  ).rows[0].version;
}
async function counts(p) {
  const credential = (
    await db.query(
      'select password_hash,auth_version from customer_credentials where customer_id=$1',
      [p.id],
    )
  ).rows[0];
  const grant = (await db.query('select id from whatsapp_sessions where id=$1', [p.grantKey]))
    .rows[0];
  return { credential, grant };
}
test('credential write and grant consumption succeed together and repeated verified retries keep the same password', async () => {
  const p = await person();
  assert.equal(await ensure(p), 1);
  assert.deepEqual((await counts(p)).credential, { password_hash: passwordHash, auth_version: 1 });
  assert.equal((await counts(p)).grant, undefined);
  assert.equal(await ensure(p), 1);
  assert.equal((await counts(p)).credential.password_hash, passwordHash);
});
test('legacy digits-only customer phone accepts the same verified canonical +7 grant', async () => {
  const p = await person();
  await db.query('update customers set phone=$2 where id=$1', [p.id, p.phone.slice(1)]);
  assert.equal(await ensure(p), 1);
  assert.equal((await counts(p)).grant, undefined);
});
test('faults before credential insert or after insert at grant deletion roll everything back and permit retry', async () => {
  for (const operation of ['credential', 'grant']) {
    const p = await person();
    await db.query('update credential_test_failure set operation=$1', [operation]);
    await assert.rejects(ensure(p), /Injected storage failure/);
    assert.equal((await counts(p)).credential, undefined);
    assert.equal((await counts(p)).grant.id, p.grantKey);
    await db.query('update credential_test_failure set operation=null');
    assert.equal(await ensure(p), 1);
    assert.equal((await counts(p)).grant, undefined);
  }
});
test('mismatched phones, expired grants, invalid hashes and established/deleted customers never consume a grant', async () => {
  for (const changes of [
    { phone: '+77001234567' },
    { expires: 1 },
    { passwordHash: 'plain-password' },
  ]) {
    const p = await person();
    await db.query('update whatsapp_sessions set data=data || $2::jsonb where id=$1', [
      p.grantKey,
      changes,
    ]);
    await assert.rejects(ensure(p), /Invalid registration grant/);
    assert.ok((await counts(p)).grant);
    assert.equal((await counts(p)).credential, undefined);
  }
  const expired = await person();
  await db.query("update whatsapp_sessions set expires_at=now()-interval '1 minute' where id=$1", [
    expired.grantKey,
  ]);
  await assert.rejects(ensure(expired), /Invalid registration grant/);
  const established = await person();
  await db.query("update customers set name='Постоянный Клиент' where id=$1", [established.id]);
  await assert.rejects(ensure(established), /already registered/);
  const deleted = await person();
  await db.query('update customers set deleted_at=now() where id=$1', [deleted.id]);
  await assert.rejects(ensure(deleted), /Invalid registration grant/);
  for (const p of [expired, established, deleted]) assert.ok((await counts(p)).grant);
});
test('a different customer ID cannot use a verified phone grant and anonymous roles cannot invoke the function', async () => {
  const p = await person(),
    other = await person();
  await assert.rejects(
    db.query('select create_customer_credential_from_registration_grant($1,$2,$3)', [
      other.id,
      p.phone,
      p.grantKey,
    ]),
    /Invalid registration grant/,
  );
  assert.ok((await counts(p)).grant);
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      (
        await db.query(
          "select has_function_privilege($1,'create_customer_credential_from_registration_grant(uuid,text,text)','EXECUTE') ok",
          [role],
        )
      ).rows[0].ok,
      false,
    );
  }
});
test('server helper sends a storage digest, normalizes the verified phone and maps expired grants safely', async () => {
  const p = await person();
  let args;
  const fake = {
    async rpc(name, value) {
      assert.equal(name, 'create_customer_credential_from_registration_grant');
      args = value;
      return { data: 1 };
    },
  };
  assert.equal(
    await ensureRegistrationCredential(
      { customerId: p.id, phone: '8' + p.phone.slice(2), grantId: p.grantId },
      { db: fake },
    ),
    1,
  );
  assert.equal(args.p_phone, p.phone);
  assert.equal(args.p_grant_key, p.grantKey);
  assert.equal(JSON.stringify(args).includes(p.grantId), false);
  assert.equal(args.passwordHash, undefined);
  await assert.rejects(
    ensureRegistrationCredential(
      { customerId: p.id, phone: p.phone, grantId: p.grantId },
      {
        db: {
          rpc: async () => ({
            error: { code: '22023', message: 'Internal invalid payload details' },
          }),
        },
      },
    ),
    { code: 'INVALID_GRANT', statusCode: 401 },
  );
});

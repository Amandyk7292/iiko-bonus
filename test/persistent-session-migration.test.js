const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');

test('persistent session migrations preserve revocation, finite operator links and SQL expiry checks', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table customer_credentials(customer_id int primary key, auth_version int);
      create table customer_refresh_tokens(id int primary key, customer_id int, token_hash text unique,
        expires_at timestamptz not null, revoked_at timestamptz, last_used_at timestamptz, replaced_by int);
      create table admin_sessions(id int primary key, role text, revoked_at timestamptz,
        expires_at timestamptz not null);
      insert into customer_credentials values(1,7);
      insert into customer_refresh_tokens values
        (1,1,'active',now()+interval '1 day',null,null,null),
        (2,1,'expired',now()-interval '1 day',null,null,null),
        (3,1,'revoked',now()+interval '1 day',now(),null,null);
      insert into admin_sessions values
        (1,'admin',null,now()+interval '1 hour'),
        (2,'cashier',null,now()+interval '1 hour'),
        (3,'whatsapp_operator',null,now()+interval '1 hour'),
        (4,'admin',null,now()-interval '1 hour'),
        (5,'admin',now(),now()+interval '1 hour');`);
    for (const file of [
      '20260909220000_customer_persistent_sessions.sql',
      '20260909221000_admin_persistent_sessions.sql',
    ]) {
      const sql = fs.readFileSync(`supabase/migrations/${file}`, 'utf8');
      await db.exec(sql);
      await db.exec(sql);
    }
    const customer = (await db.query('select * from customer_refresh_tokens order by id')).rows;
    assert.equal(customer[0].expires_at, null);
    assert.equal(customer[0].auth_version, 7);
    assert.ok(customer[1].expires_at);
    assert.ok(customer[2].revoked_at);
    const admin = (
      await db.query(
        "select id, expires_at::text as expiry, expires_at > now()+interval '20 years' as durable from admin_sessions order by id",
      )
    ).rows;
    assert.deepEqual(
      admin.slice(0, 2).map((r) => r.durable),
      [true, true],
    );
    assert.ok(admin.slice(2).every((r) => r.expiry !== 'infinity'));
    await db.exec(`insert into customer_refresh_tokens(id,customer_id,token_hash,expires_at,last_used_at,revoked_at,replaced_by,rotation_key_hash)
      values (4,1,'parent',null,now(),now(),5,'proof'),(5,1,'child',null,null,null,null,null);`);
    await db.query('select revoke_customer_refresh_session($1)', ['parent']);
    const chain = (await db.query('select * from customer_refresh_tokens where id in(4,5)')).rows;
    assert.ok(
      chain.every((r) => r.revoked_at && r.last_used_at === null && r.rotation_key_hash === null),
    );
    await db.exec('set role anon');
    await assert.rejects(
      db.query('select revoke_customer_refresh_session($1)', ['active']),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});

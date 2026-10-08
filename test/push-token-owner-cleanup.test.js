const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test, before, beforeEach, after } = require('node:test');
const { PGlite } = require('@electric-sql/pglite');
const { deliverPushOutbox } = require('../src/services/push-outbox.service');

const pg = new PGlite();
const sql = (name) => readFileSync(path.join(__dirname, '..', 'supabase', 'migrations', name), 'utf8');
const cleanupSql = sql('20261008150300_push_token_owner_cleanup.sql');
const token = 'shared-installation-push-token-123';
const otherToken = 'other-installation-push-token-456';
const ids = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

before(async () => {
  await pg.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, fcm_token text, preferred_language text,
      deleted_at timestamptz, created_at timestamptz default now(), updated_at timestamptz);`);
  await pg.exec(sql('20260715193000_push_device_tokens.sql'));
  await pg.exec(sql('20260729170000_push_notification_outbox.sql').replace('create extension if not exists pgcrypto;', ''));
  await pg.exec(sql('20260729171000_push_outbox_leases.sql'));
  await pg.exec(sql('20260922161000_push_uncertain_delivery.sql'));
});
beforeEach(async () => {
  await pg.exec('truncate customers cascade');
  for (const id of ids) await pg.query('insert into customers(id) values($1)', [id]);
  await pg.exec(cleanupSql);
});
after(() => pg.close());

const register = (customerId, pushToken = token, installation = 'shared-device-123') =>
  pg.query("select register_customer_push_token($1,$2,'android',$3,'kz')", [customerId, pushToken, installation]);
const legacy = async (id) => (await pg.query('select fcm_token from customers where id=$1', [id])).rows[0].fcm_token;

// Translate only the worker's table operations to the disposable PostgreSQL.
// Token registration, logout, outbox claim and state updates use the real SQL.
function workerDb() {
  return {
    async rpc(name, args) {
      assert.equal(name, 'claim_push_notification_outbox');
      return { data: (await pg.query('select * from claim_push_notification_outbox($1,$2)', [args.p_limit, args.p_message_id])).rows };
    },
    from(table) {
      assert.ok(['customers', 'customer_push_tokens', 'push_notification_outbox'].includes(table));
      const filters = [], values = [];
      let fields = '*', patch = null;
      const column = (value) => {
        assert.match(value, /^[a-z_]+$/);
        return value;
      };
      const execute = async () => {
        let statement = `select ${fields} from ${table}`;
        if (patch) {
          const assignments = Object.entries(patch).map(([key, value]) => {
            values.push(Array.isArray(value) || (value && typeof value === 'object') ? JSON.stringify(value) : value);
            return `${column(key)}=$${values.length}`;
          });
          statement = `update ${table} set ${assignments.join(',')}`;
        }
        if (filters.length) statement += ` where ${filters.map(([key, value, multiple]) => {
          values.push(value);
          return `${column(key)} ${multiple ? '= any' : '='}($${values.length}${multiple ? '::text[]' : ''})`;
        }).join(' and ')}`;
        if (patch) statement += ` returning ${fields}`;
        return { data: (await pg.query(statement, values)).rows };
      };
      const query = {
        select(value) { assert.match(value, /^(?:\*|[a-z_,]+)$/); fields = value; return this; },
        eq(key, value) { filters.push([key, value, false]); return this; },
        in(key, value) { filters.push([key, value, true]); return this; },
        update(value) { patch = value; return this; },
        async maybeSingle() { const result = await execute(); return { data: result.data[0] || null }; },
        then(resolve, reject) { return execute().then(resolve, reject); },
      };
      return query;
    },
  };
}

test('A registration, B transfer and B logout cannot resurrect a queued private A push', async () => {
  const [a, b] = ids;
  await register(a);
  await pg.query(`insert into push_notification_outbox(dedupe_key,customer_id,title,body,pending_tokens)
    values('private-a-order',$1,'Private order','A customer payload',$2::jsonb)`, [a, JSON.stringify([token])]);
  await register(b);
  assert.equal(await legacy(a), null);
  assert.equal(await legacy(b), token);
  await pg.query('select unregister_customer_push_token($1,$2,null)', [b, 'shared-device-123']);
  assert.equal(await legacy(a), null);
  assert.equal(await legacy(b), null);
  let sends = 0;
  const [result] = await deliverPushOutbox({ sendToken: async () => { sends++; return { delivered: true }; } }, { db: workerDb() });
  assert.equal(sends, 0);
  assert.equal(result.status, 'skipped');
  assert.equal((await pg.query('select status from push_notification_outbox')).rows[0].status, 'skipped');
});

test('installation transfer with a rotated token removes the former token fallback', async () => {
  const [a, b] = ids;
  await register(a);
  await register(b, otherToken);
  assert.equal(await legacy(a), null);
  assert.equal(await legacy(b), otherToken);
  assert.deepEqual((await pg.query('select customer_id,token from customer_push_tokens')).rows, [{ customer_id: b, token: otherToken }]);
});

test('transfers preserve another current device and replace only a stale legacy fallback', async () => {
  const [a, b] = ids;
  await register(a, otherToken, 'other-device-123');
  await register(a);
  await register(b);
  assert.equal(await legacy(a), otherToken);
  await register(a, token, 'shared-device-123');
  await pg.query('update customers set fcm_token=$2 where id=$1', [a, otherToken]);
  await register(b);
  assert.equal(await legacy(a), otherToken);
  assert.equal((await pg.query('select preferred_language from customers where id=$1', [b])).rows[0].preferred_language, 'kk');
});

test('backfill repairs known duplicate ownership without dropping unclaimed legacy tokens', async () => {
  const [a, b, duplicate, unclaimed] = ids;
  await register(a, otherToken, 'other-device-123');
  await register(b);
  await pg.query('update customers set fcm_token=$1 where id=any($2::uuid[])', [token, [a, duplicate]]);
  await pg.query('update customers set fcm_token=$2 where id=$1', [unclaimed, 'unclaimed-legacy-push-token-789']);
  await pg.exec(cleanupSql);
  assert.equal(await legacy(a), otherToken);
  assert.equal(await legacy(duplicate), null);
  assert.equal(await legacy(b), token);
  assert.equal(await legacy(unclaimed), 'unclaimed-legacy-push-token-789');
  await pg.exec(cleanupSql);
  assert.equal(await legacy(unclaimed), 'unclaimed-legacy-push-token-789');
  assert.equal(await legacy(a), otherToken);
});

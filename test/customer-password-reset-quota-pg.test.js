// Opt-in local-only proof with independent PostgreSQL connections. No service,
// SMS provider or environment database credentials are used by this test.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const test = require('node:test');
const { Client } = require('pg');

const port = Number(process.env.BULKA_PASSWORD_RESET_LOCAL_PG_PORT || 0);
const enabled = Number.isInteger(port) && port >= 1024 && port <= 65535;
const config = {
  host: '127.0.0.1',
  port,
  user: 'quota_audit',
  password: '',
  ssl: false,
  connectionTimeoutMillis: 2000,
};
const database = 'bulka_reset_quota_test_' + randomUUID().replaceAll('-', '');
const clients = [];
let observer;
let a;
let b;
let c;
const phone = '+77001234567';
const queryReset = async (client, suffix) =>
  (
    await client.query('select reserve_customer_password_reset_link($1,$2,$3,null,1000) as r', [
      phone,
      suffix.repeat(64),
      'SeparateWorkerFlow' + suffix,
    ])
  ).rows[0].r;
const connect = async (application_name) => {
  const client = new Client({ ...config, database, application_name });
  await client.connect();
  await client.query("set statement_timeout='6s'; set lock_timeout='5s'");
  clients.push(client);
  return client;
};
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitForLock(client) {
  for (let i = 0; i < 100; i++) {
    const row = (
      await observer.query('select wait_event_type from pg_stat_activity where pid=$1', [
        client.processID,
      ])
    ).rows[0];
    if (row?.wait_event_type === 'Lock') return;
    await pause(10);
  }
  assert.fail('An independent connection did not wait for the persistent quota lock');
}

test.before(async () => {
  if (!enabled) return;
  const admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query('create database ' + database);
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$;`);
  } finally {
    await admin.end();
  }
  observer = await connect('quota_test_observer');
  a = await connect('quota_test_worker_a');
  b = await connect('quota_test_worker_b');
  c = await connect('quota_test_worker_c');
  await observer.query(`create table customers(id uuid primary key,phone text,name text);
    create table customer_refresh_tokens(id text primary key,customer_id uuid,revoked_at timestamptz);
    create table whatsapp_sessions(id text primary key,data jsonb,expires_at timestamptz,updated_at timestamptz default now());`);
  for (const file of [
    '20260722223000_customer_password_auth.sql',
    '20261002150000_automatic_customer_otp.sql',
    '20261004180000_customer_password_reset_links.sql',
    '20261004181000_customer_password_reset_rolling_quota.sql',
  ])
    await observer.query(readFileSync('supabase/migrations/' + file, 'utf8'));
});

test.beforeEach(async () => {
  if (!enabled) return;
  await observer.query(
    'truncate customer_password_reset_links,customer_password_reset_send_limits,customer_otp_send_limits;',
  );
});

test.after(async () => {
  if (!enabled) return;
  await Promise.allSettled(clients.map((client) => client.end()));
  const admin = new Client({ ...config, database: 'postgres' });
  await admin.connect();
  try {
    await admin.query('drop database ' + database);
  } finally {
    await admin.end();
  }
});

test(
  'independent workers wait on the same quota lock; only one can reserve the remaining request',
  { skip: !enabled },
  async () => {
    assert.equal((await queryReset(observer, 'a')).status, 'reserved');
    await observer.query(
      "update customer_otp_send_limits set last_sent_at=clock_timestamp()-interval '61 seconds'",
    );
    await a.query('begin');
    let requestB;
    let requestC;
    try {
      assert.equal((await queryReset(a, 'b')).status, 'reserved');
      requestB = queryReset(b, 'c');
      requestC = queryReset(c, 'd');
      await Promise.all([waitForLock(b), waitForLock(c)]);
      await a.query('commit');
      for (const result of await Promise.all([requestB, requestC])) {
        assert.equal(result.status, 'rate_limited');
        assert.equal(result.limitKind, 'rolling_24h');
        assert.ok(result.retryAfterSeconds > 86390);
      }
    } catch (error) {
      await a.query('rollback');
      await Promise.allSettled([requestB, requestC].filter(Boolean));
      throw error;
    }
    const row = (await observer.query('select * from customer_password_reset_send_limits')).rows[0];
    assert.ok(row.first_requested_at && row.second_requested_at);
    assert.equal(
      (await observer.query('select token_digest from customer_password_reset_links')).rows[0]
        .token_digest,
      'b'.repeat(64),
    );
    // Replace every app connection: the next process still sees two requests.
    const fresh = await connect('quota_test_worker_after_restart');
    assert.equal((await queryReset(fresh, 'e')).status, 'rate_limited');
  },
);

test(
  'rolling expiry is evaluated after a PostgreSQL lock wait, not at function entry',
  { skip: !enabled },
  async () => {
    await queryReset(observer, 'a');
    await observer.query(
      "update customer_password_reset_send_limits set first_requested_at=clock_timestamp()-interval '24 hours'+interval '400 milliseconds',second_requested_at=clock_timestamp()-interval '2 hours'; update customer_otp_send_limits set last_sent_at=clock_timestamp()-interval '61 seconds'",
    );
    await a.query('begin');
    await a.query("select 1 from customer_otp_send_limits where scope='global' for update");
    let pending;
    try {
      pending = queryReset(b, 'b');
      await waitForLock(b);
      await pause(550);
      await a.query('commit');
      const result = await pending;
      assert.equal(result.status, 'reserved');
      assert.ok(result.retryAfterSeconds >= 79190 && result.retryAfterSeconds <= 79200);
    } catch (error) {
      await a.query('rollback');
      await Promise.allSettled([pending].filter(Boolean));
      throw error;
    }
  },
);

for (const first of ['reset', 'registration']) {
  test(
    `reset and registration keep shared global/phone guards under a ${first}-first lock race`,
    { skip: !enabled },
    async () => {
      const registration = async (client) =>
        (
          await client.query('select reserve_customer_otp($1,$2,$3::jsonb,1000) as r', [
            phone,
            'f'.repeat(64),
            JSON.stringify({ flowId: 'RegistrationFlow23456', purpose: 'customer_registration' }),
          ])
        ).rows[0].r;
      await queryReset(observer, 'a');
      await observer.query(
        "update customer_otp_send_limits set last_sent_at=clock_timestamp()-interval '61 seconds'",
      );
      const one = first === 'reset' ? () => queryReset(a, 'b') : () => registration(a);
      const two = first === 'reset' ? () => registration(b) : () => queryReset(b, 'b');
      await a.query('begin');
      let pending;
      try {
        assert.equal((await one()).status, 'reserved');
        pending = two();
        await waitForLock(b);
        await a.query('commit');
        const blocked = await pending;
        assert.equal(blocked.status, 'rate_limited');
        assert.ok(blocked.retryAfterSeconds > 0 && blocked.retryAfterSeconds <= 60);
        if (first === 'registration') assert.equal(blocked.limitKind, 'shared');
      } catch (error) {
        await a.query('rollback');
        await Promise.allSettled([pending].filter(Boolean));
        throw error;
      }
      // Once the common cooldown is over, registration still succeeds even when
      // resets have used both slots; registration cannot consume a reset-only slot.
      await observer.query(
        "update customer_otp_send_limits set last_sent_at=clock_timestamp()-interval '61 seconds'",
      );
      const next = first === 'reset' ? await registration(c) : await queryReset(c, 'c');
      assert.equal(next.status, 'reserved');
      const quota = (await observer.query('select * from customer_password_reset_send_limits'))
        .rows[0];
      assert.ok(quota.first_requested_at && quota.second_requested_at);
      const global = (
        await observer.query("select day_count from customer_otp_send_limits where scope='global'")
      ).rows[0];
      assert.equal(
        global.day_count,
        3,
        'The denied request must not increase the paid-send counter',
      );
    },
  );
}

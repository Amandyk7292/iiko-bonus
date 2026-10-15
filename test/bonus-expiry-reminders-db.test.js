const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const { randomUUID } = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');

const db = new PGlite();
const now = '2026-10-15T07:00:00Z';
const expiry = '2026-11-14T07:00:00Z';
let customer;
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].value;
const enqueue = (at = now, limit = 500) =>
  scalar('select enqueue_bonus_expiry_reminders($1,$2) value', [at, limit]);
const state = (date = '2026-11-14', days = 30, at = now) =>
  scalar('select bonus_expiry_reminder_state($1,$2,$3,$4) value', [customer, date, days, at]);
async function lot(amount = 500, expiresAt = expiry, customerId = customer) {
  await db.query(
    'insert into bonus_credit_lots(customer_id,remaining_amount,expires_at) values($1,$2,$3)',
    [customerId, amount, expiresAt],
  );
}
async function createCustomer(options = {}) {
  const id = randomUUID();
  await db.query('insert into customers(id,preferred_language,deleted_at) values($1,$2,$3)', [
    id,
    options.language || 'ru',
    options.deletedAt || null,
  ]);
  if (options.token !== false)
    await db.query('insert into customer_push_tokens(customer_id,token) values($1,$2)', [
      id,
      `registered-token-${id}`,
    ]);
  return id;
}

test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key,preferred_language text default 'ru',deleted_at timestamptz);
    create table settings(key text primary key,value text);
    create table bonus_credit_lots(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),remaining_amount numeric not null,expires_at timestamptz not null);
    create table customer_push_tokens(customer_id uuid references customers(id),token text);
    create table customer_notifications(id uuid primary key,customer_id uuid references customers(id),title text,body text,type text,payload jsonb);
    create table marketing_automations(id uuid primary key,trigger_type text);
    create table marketing_deliveries(id uuid primary key,automation_id uuid references marketing_automations(id),status text,error text);`);
  const core = fs.readFileSync('supabase/migrations/20261015110000_bonus_credit_lots.sql', 'utf8');
  await db.exec(
    core.match(/create function public\.bonus_expiry_policy_enabled\(\)[\s\S]*?\$\$;/)[0],
  );
  await db.exec(
    fs
      .readFileSync('supabase/migrations/20260729170000_push_notification_outbox.sql', 'utf8')
      .replace('create extension if not exists pgcrypto;', ''),
  );
  await db.exec(
    fs.readFileSync('supabase/migrations/20260729171000_push_outbox_leases.sql', 'utf8'),
  );
  await db.exec(
    fs.readFileSync('supabase/migrations/20261015120000_bonus_expiry_reminders.sql', 'utf8'),
  );
});
test.beforeEach(async () => {
  await db.exec(
    'truncate customers,bonus_credit_lots,customer_push_tokens,push_notification_outbox,customer_notifications,settings cascade',
  );
  customer = await createCustomer();
});
test.after(async () => db.close());

test('each 30, 15 and 7 day milestone queues once despite hourly workers and unchanged balance', async () => {
  await lot();
  await lot(200, '2027-01-14T07:00:00Z');
  for (const [at, milestone] of [
    [now, 30],
    ['2026-10-30T07:00:00Z', 15],
    ['2026-11-07T07:00:00Z', 7],
  ]) {
    assert.equal(await enqueue(at), 1);
    assert.equal(await enqueue(at), 0);
    const row = (
      await db.query(
        "select payload,dedupe_key from push_notification_outbox where (payload->>'reminderDays')::int=$1",
        [milestone],
      )
    ).rows[0];
    assert.equal(row.payload.amount, 500);
    assert.equal(row.payload.bonusExpiresOn, '2026-11-14');
    assert.match(row.dedupe_key, new RegExp(`:${milestone}$`));
  }
  assert.equal(await scalar('select count(*)::integer value from push_notification_outbox'), 3);
  assert.equal(await enqueue('2026-11-14T07:00:00Z'), 0);
});

test('same expiry day accruals aggregate, later accruals stay separate, full and partial spends refresh amount', async () => {
  await lot(500);
  await lot(100, '2026-11-14T09:00:00Z');
  await lot(200, '2027-01-14T07:00:00Z');
  assert.equal(await enqueue(), 1);
  assert.equal((await state()).amount, 600);
  await db.query('update bonus_credit_lots set remaining_amount=200 where remaining_amount=500');
  assert.equal((await state()).amount, 300);
  await db.query('update bonus_credit_lots set remaining_amount=0 where expires_at<$1', [
    '2026-12-01',
  ]);
  assert.equal((await state()).eligible, false);
  assert.equal(await enqueue(), 0);
  assert.equal(await scalar('select sum(remaining_amount) value from bonus_credit_lots'), '200');
});

test('delivery rejects expired, future, stale milestone and malformed inputs', async () => {
  await lot();
  assert.equal((await state(undefined, 15)).eligible, false);
  assert.equal((await state(undefined, 30, '2026-10-30T07:00:00Z')).eligible, false);
  assert.equal((await state(undefined, 15, '2026-11-07T07:00:00Z')).eligible, false);
  assert.equal((await state(undefined, 7, '2026-11-14T07:00:00Z')).eligible, false);
  assert.equal((await state(undefined, 9)).eligible, false);
  const retry = await state(undefined, 30, '2026-10-16T07:00:00Z');
  assert.equal(retry.eligible, true);
  assert.equal(retry.daysLeft, 29);
  assert.equal(Date.parse(retry.deliveryExpiresAt), Date.parse('2026-10-16T19:00:00Z'));
});

test('disabled expiry or automatic writeoff suppresses queue and already queued eligibility', async () => {
  await lot();
  assert.equal(await enqueue(), 1);
  for (const policy of [{ enabled: false }, { auto_write_off: false }]) {
    await db.query(
      "insert into settings(key,value) values('bonus_expiration',$1) on conflict(key) do update set value=excluded.value",
      [JSON.stringify(policy)],
    );
    assert.equal(await enqueue(), 0);
    assert.equal((await state()).eligible, false);
  }
});

test('queue pagination skips already queued buckets so later customers are not starved', async () => {
  for (let i = 0; i < 5; i++) await lot(100, expiry, i === 0 ? customer : await createCustomer());
  assert.equal(await enqueue(now, 2), 2);
  assert.equal(await enqueue(now, 2), 2);
  assert.equal(await enqueue(now, 2), 1);
  assert.equal(await enqueue(now, 2), 0);
});

test('deleted customers, fully spent lots and missing registered push devices do not queue', async () => {
  const deleted = await createCustomer({ deletedAt: now });
  const noDevice = await createCustomer({ token: false });
  await lot(100, expiry, deleted);
  await lot(100, expiry, noDevice);
  await lot(0);
  assert.equal(await enqueue(), 0);
});

test('milestones follow the Kazakhstan calendar around UTC midnight', async () => {
  await lot(100, '2026-11-15T00:01:00+05:00');
  assert.equal(await enqueue('2026-10-15T18:59:59Z'), 0);
  assert.equal(await enqueue('2026-10-15T19:00:00Z'), 1);
  assert.equal(await enqueue('2026-10-16T12:00:00Z'), 0);
});

test('migration cancels queued legacy whole-balance notifications without touching sent history', async () => {
  for (const status of ['queued', 'retry', 'sent'])
    await db.query(
      "insert into push_notification_outbox(dedupe_key,customer_id,title,body,payload,status,pending_tokens) values($1,$2,'title','body',$3,$4,$5)",
      [
        `legacy-${status}`,
        customer,
        { type: 'marketing_bonus_expiring' },
        status,
        ['registered-device'],
      ],
    );
  await db.exec(
    fs.readFileSync('supabase/migrations/20261015120000_bonus_expiry_reminders.sql', 'utf8'),
  );
  const rows = (
    await db.query('select status,pending_tokens from push_notification_outbox order by dedupe_key')
  ).rows;
  assert.deepEqual(
    rows.map((r) => r.status),
    ['cancelled', 'cancelled', 'sent'],
  );
  assert.deepEqual(rows[0].pending_tokens, []);
  assert.deepEqual(rows[2].pending_tokens, ['registered-device']);
});

test('win-back grant helper atomically queues one personal notice and push per absence claim', async () => {
  const claim = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    await db.query('select queue_bonus_winback_notification($1,$2,1000)', [customer, claim]);
  }
  assert.equal(await scalar('select count(*)::integer value from customer_notifications'), 1);
  assert.equal(await scalar('select count(*)::integer value from push_notification_outbox'), 1);
  const push = (await db.query('select title,body,payload from push_notification_outbox')).rows[0];
  assert.equal(push.title, 'Мы скучали!');
  assert.match(push.body, /1000 ₸/);
  assert.equal(push.payload.type, 'bonus_winback');
  assert.equal(push.payload.amount, 1000);
  assert.equal(push.payload.winbackClaimId, claim);
  await db.query('select queue_bonus_winback_notification($1,$2,1000)', [customer, randomUUID()]);
  assert.equal(await scalar('select count(*)::integer value from push_notification_outbox'), 2);
});

test('win-back inbox survives missing push devices and rolls back with the grant transaction', async () => {
  await db.query('delete from customer_push_tokens where customer_id=$1', [customer]);
  await db.query('select queue_bonus_winback_notification($1,$2,1000)', [customer, randomUUID()]);
  assert.equal(await scalar('select count(*)::integer value from customer_notifications'), 1);
  assert.equal(await scalar('select count(*)::integer value from push_notification_outbox'), 0);
  await db.query('insert into customer_push_tokens(customer_id,token) values($1,$2)', [
    customer,
    `registered-token-${customer}`,
  ]);
  await db.exec('begin');
  await db.query('select queue_bonus_winback_notification($1,$2,1000)', [customer, randomUUID()]);
  await db.exec('rollback');
  assert.equal(await scalar('select count(*)::integer value from customer_notifications'), 1);
  assert.equal(await scalar('select count(*)::integer value from push_notification_outbox'), 0);
  assert.equal(
    await scalar(
      "select has_function_privilege('service_role','public.queue_bonus_winback_notification(uuid,uuid,numeric)','execute') value",
    ),
    false,
  );
});

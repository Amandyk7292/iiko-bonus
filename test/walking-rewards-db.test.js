const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const db = new PGlite();
const key = 'test-hardware-key';
const hash = 'a'.repeat(64);
let customerId;
let today;
const row = async (sql, values = []) => (await db.query(sql, values)).rows[0];
async function apply(
  steps,
  {
    customer = customerId,
    counter = 1,
    previous = counter - 1,
    challenge = crypto.randomUUID(),
    date = today,
    start,
    end,
    keyId = key,
  } = {},
) {
  const from = start || new Date(Date.parse(`${date}T00:00:00+05:00`)).toISOString();
  const to = end || new Date(Math.min(Date.now(), Date.parse(from) + 86400000)).toISOString();
  return (
    await row('select apply_walking_steps($1,$2,$3,$4,$5,$6,$7,$8,$9) result', [
      customer,
      keyId,
      previous,
      counter,
      challenge,
      date,
      steps,
      from,
      to,
    ])
  ).result;
}
test.before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table customers(id uuid primary key, balance numeric not null default 0, updated_at timestamptz, deleted_at timestamptz);
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),order_id text,type text,amount numeric,description text);`);
  await db.exec(fs.readFileSync('supabase/migrations/20261002130000_walking_rewards.sql', 'utf8'));
  await db.exec(
    fs.readFileSync('supabase/migrations/20261006230000_android_walking_rewards.sql', 'utf8'),
  );
  today = (await row("select (now() at time zone 'Asia/Almaty')::date::text as walking_day"))
    .walking_day;
});
test.beforeEach(async () => {
  await db.exec(
    'truncate walking_daily_progress,walking_device_keys,walking_used_challenges,transactions,customers cascade',
  );
  await db.exec(
    "update walking_reward_policy set enabled=true, starts_on=(now() at time zone 'Asia/Almaty')::date-6",
  );
  customerId = crypto.randomUUID();
  await db.query('insert into customers(id,balance) values($1,200)', [customerId]);
  await db.query(
    "insert into walking_device_keys(key_id,device_hash,public_key) values($1,$2,'test')",
    [key, hash],
  );
});
test.after(() => db.close());
test('9,999 steps gives no reward; 10,000 gives exactly 1,000, atomically with the ledger', async () => {
  assert.equal((await apply(9999)).credited, false);
  assert.equal(Number((await row('select balance from customers')).balance), 200);
  assert.equal((await apply(10000, { counter: 2 })).credited, true);
  assert.equal(Number((await row('select balance from customers')).balance), 1200);
  const ledger = await row('select * from transactions');
  assert.equal(Number(ledger.amount), 1000);
  assert.equal(ledger.type, 'deposit');
  assert.match(ledger.order_id, /^WALKING-/);
  assert.equal(
    Number((await row('select reward_amount from walking_daily_progress')).reward_amount),
    1000,
  );
});
test('new signed requests and 20,000 steps never double-credit the same day', async () => {
  await apply(10000);
  const result = await apply(20000, { counter: 2 });
  assert.equal(result.credited, false);
  assert.equal(result.rewarded, true);
  assert.equal(result.steps, 20000);
  assert.equal((await row('select count(*)::int n from transactions')).n, 1);
});
test('reused challenges and stale counters roll back without modifying the balance or ledger', async () => {
  const challenge = crypto.randomUUID();
  await apply(10000, { challenge });
  await assert.rejects(apply(10000, { challenge, counter: 2 }));
  await assert.rejects(apply(10000, { counter: 1, previous: 0 }));
  assert.equal((await row('select sign_count from walking_device_keys')).sign_count, 1);
  assert.equal((await row('select count(*)::int n from transactions')).n, 1);
});
test('the same phone cannot claim a second daily reward using another account or app key', async () => {
  await apply(10000);
  const second = crypto.randomUUID();
  await db.query('insert into customers(id) values($1)', [second]);
  await db.query(
    "insert into walking_device_keys(key_id,device_hash,public_key) values('reinstalled-key',$1,'test')",
    [hash],
  );
  const result = await apply(10000, { customer: second, keyId: 'reinstalled-key' });
  assert.equal(result.credited, false);
  assert.equal(result.deviceRewarded, true);
  assert.equal(
    Number((await row('select balance from customers where id=$1', [second])).balance),
    0,
  );
});
test('separate phones cannot combine sub-threshold measurements; counts never regress', async () => {
  await apply(6000);
  await apply(5000, { counter: 2 });
  assert.equal((await row('select steps from walking_daily_progress')).steps, 6000);
  await db.query(
    "insert into walking_device_keys(key_id,device_hash,public_key) values('other-key',$1,'test')",
    ['b'.repeat(64)],
  );
  await assert.rejects(apply(5000, { keyId: 'other-key' }));
  assert.equal((await row('select count(*)::int n from transactions')).n, 0);
});
test('last six days can be recovered; future, older, pre-launch and altered day boundaries fail', async () => {
  const day = (
    await row("select ((now() at time zone 'Asia/Almaty')::date-6)::text as walking_day")
  ).walking_day;
  assert.equal((await apply(12000, { date: day })).credited, true);
  for (const delta of [-7, 1]) {
    const date = (
      await row("select ((now() at time zone 'Asia/Almaty')::date+$1::int)::text as walking_day", [
        delta,
      ])
    ).walking_day;
    await assert.rejects(apply(10000, { date, counter: 2 }));
  }
  await assert.rejects(apply(10000, { start: `${today}T00:00:00Z`, counter: 2 }));
  await db.exec(
    "update walking_reward_policy set starts_on=(now() at time zone 'Asia/Almaty')::date",
  );
  const yesterday = (
    await row("select ((now() at time zone 'Asia/Almaty')::date-1)::text as walking_day")
  ).walking_day;
  await assert.rejects(apply(10000, { date: yesterday, counter: 2 }));
});
test('a failed ledger write rolls back the balance, nonce, progress and counter', async () => {
  await db.exec('alter table transactions add constraint test_no_credit check(amount<1000)');
  try {
    await assert.rejects(apply(10000));
  } finally {
    await db.exec('alter table transactions drop constraint test_no_credit');
  }
  assert.equal(Number((await row('select balance from customers')).balance), 200);
  assert.equal((await row('select sign_count from walking_device_keys')).sign_count, 0);
  assert.equal((await row('select count(*)::int n from walking_daily_progress')).n, 0);
  assert.equal((await row('select count(*)::int n from walking_used_challenges')).n, 0);
  assert.equal((await apply(10000)).credited, true);
});
test('RPC and step data are unavailable to browser database roles', async () => {
  const signature =
    'apply_walking_steps(uuid,text,bigint,bigint,uuid,date,integer,timestamptz,timestamptz)';
  for (const role of ['anon', 'authenticated']) {
    assert.equal(
      (await row("select has_function_privilege($1,$2,'execute') allowed", [role, signature]))
        .allowed,
      false,
    );
    assert.equal(
      (
        await row("select has_table_privilege($1,'walking_daily_progress','select') allowed", [
          role,
        ])
      ).allowed,
      false,
    );
  }
  assert.equal(
    (await row("select has_function_privilege('service_role',$1,'execute') allowed", [signature]))
      .allowed,
    true,
  );
});
test('the same device can earn exactly once on each separate Kazakhstan calendar day', async () => {
  const yesterday = (
    await row("select ((now() at time zone 'Asia/Almaty')::date-1)::text as walking_day")
  ).walking_day;
  await apply(10000, { date: yesterday });
  await apply(10000, { counter: 2 });
  await apply(20000, { counter: 3 });
  assert.equal(Number((await row('select balance from customers')).balance), 2200);
  assert.equal((await row('select count(*)::int n from transactions')).n, 2);
});
test('expired technical challenges are pruned while live challenges and reward history remain', async () => {
  const old = crypto.randomUUID(),
    live = crypto.randomUUID();
  await db.query(
    "insert into walking_used_challenges(challenge_id,created_at) values($1,now()-interval '20 minutes'),($2,now()-interval '2 minutes')",
    [old, live],
  );
  await apply(10000);
  assert.equal(
    (await row('select count(*)::int n from walking_used_challenges where challenge_id=$1', [old]))
      .n,
    0,
  );
  assert.equal(
    (await row('select count(*)::int n from walking_used_challenges where challenge_id=$1', [live]))
      .n,
    1,
  );
  assert.equal((await row('select count(*)::int n from transactions')).n, 1);
});
async function androidKey(keyId = 'android-key', device = hash) {
  await db.query(
    "insert into walking_device_keys(key_id,device_hash,public_key,platform) values($1,$2,'play_integrity:com.bulka.bonus','android')",
    [keyId, device],
  );
}
async function androidDays(steps = 10000, offsets = [0, 1]) {
  const days = [];
  for (const offset of offsets) {
    const date = (
      await row("select ((now() at time zone 'Asia/Almaty')::date-$1::int)::text as date", [offset])
    ).date;
    const startAt = new Date(Date.parse(`${date}T00:00:00+05:00`)).toISOString();
    days.push({
      date,
      steps,
      startAt,
      endAt: new Date(Math.min(Date.now(), Date.parse(startAt) + 86400000)).toISOString(),
    });
  }
  return days;
}
async function androidApply(
  measurements,
  {
    customer = customerId,
    keyId = 'android-key',
    previous = 0,
    challenge = crypto.randomUUID(),
  } = {},
) {
  return (
    await row('select apply_android_walking_steps($1,$2,$3,$4,$5::jsonb) result', [
      customer,
      keyId,
      previous,
      challenge,
      JSON.stringify(measurements),
    ])
  ).result;
}
test('Android batch awards every qualifying day once and uses only server counters and monotonic native totals', async () => {
  await androidKey();
  const days = await androidDays();
  const result = await androidApply(days);
  assert.equal(result.days.length, 2);
  assert.ok(result.days.every((day) => day.credited && day.rewardAmount === 1000));
  assert.equal(Number((await row('select balance from customers')).balance), 2200);
  assert.equal(
    (await row("select sign_count from walking_device_keys where key_id='android-key'")).sign_count,
    2,
  );
  await androidApply(await androidDays(20000), { previous: 2 });
  await androidApply(await androidDays(100), { previous: 4 });
  assert.equal((await row('select count(*)::int n from transactions')).n, 2);
  assert.equal(
    (await row('select min(steps)::int steps from walking_daily_progress')).steps,
    20000,
  );
});
test('Android batch challenge replay, stale snapshot and an Apple key cannot increase the balance', async () => {
  await androidKey();
  const days = await androidDays();
  const challenge = crypto.randomUUID();
  await androidApply(days, { challenge });
  await assert.rejects(androidApply(days, { challenge, previous: 2 }));
  await assert.rejects(androidApply(days, { previous: 0 }));
  await assert.rejects(androidApply(days, { keyId: key }));
  assert.equal((await row('select count(*)::int n from transactions')).n, 2);
  assert.equal(
    (await row("select sign_count from walking_device_keys where key_id='android-key'")).sign_count,
    2,
  );
});
test('Android batch failure rolls back all its days, rewards, counters and root/derived replay markers', async () => {
  await androidKey();
  const days = await androidDays();
  const challenge = crypto.randomUUID();
  // Oldest day succeeds inside the transaction; current day's invalid range
  // must undo that earlier successful credit rather than leave a partial batch.
  const invalid = days.map((day, index) => (index === 0 ? { ...day, steps: 150001 } : day));
  await assert.rejects(androidApply(invalid, { challenge }));
  assert.equal(Number((await row('select balance from customers')).balance), 200);
  assert.equal((await row('select count(*)::int n from transactions')).n, 0);
  assert.equal((await row('select count(*)::int n from walking_daily_progress')).n, 0);
  assert.equal((await row('select count(*)::int n from walking_used_challenges')).n, 0);
  assert.equal(
    (await row("select sign_count from walking_device_keys where key_id='android-key'")).sign_count,
    0,
  );
  assert.ok((await androidApply(days, { challenge })).days.every((day) => day.credited));
});
test('Android devices cannot split daily rewards across accounts or combine totals from another phone', async () => {
  await androidKey();
  await androidApply(await androidDays(10000, [0]));
  const second = crypto.randomUUID();
  await db.query('insert into customers(id) values($1)', [second]);
  await androidKey('android-reinstalled');
  const result = await androidApply(await androidDays(10000, [0]), {
    customer: second,
    keyId: 'android-reinstalled',
  });
  assert.equal(result.days[0].credited, false);
  assert.equal(result.days[0].deviceRewarded, true);
  assert.equal(
    Number((await row('select balance from customers where id=$1', [second])).balance),
    0,
  );
  await androidKey('other-phone', 'b'.repeat(64));
  await assert.rejects(androidApply(await androidDays(10000, [0]), { keyId: 'other-phone' }));
  assert.equal((await row('select count(*)::int n from transactions')).n, 1);
});
test('Android batch validates bounds, unique days and private function permissions', async () => {
  await androidKey();
  const days = await androidDays(10000, [0]);
  for (const batch of [
    [],
    Array(8).fill(days[0]),
    [days[0], days[0]],
    [{ ...days[0], steps: 1.5 }],
    [{ ...days[0], steps: null }],
    [{ ...days[0], source: 'manual' }],
  ])
    await assert.rejects(androidApply(batch));
  const signature = 'apply_android_walking_steps(uuid,text,bigint,uuid,jsonb)';
  for (const role of ['anon', 'authenticated'])
    assert.equal(
      (await row("select has_function_privilege($1,$2,'execute') allowed", [role, signature]))
        .allowed,
      false,
    );
  assert.equal(
    (await row("select has_function_privilege('service_role',$1,'execute') allowed", [signature]))
      .allowed,
    true,
  );
  assert.equal(
    (await row('select platform from walking_device_keys where key_id=$1', [key])).platform,
    'ios',
  );
  assert.equal((await row('select count(*)::int n from transactions')).n, 0);
});

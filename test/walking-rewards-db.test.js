const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { PGlite } = require('@electric-sql/pglite');
const { deliverPushOutbox } = require('../src/services/push-outbox.service');
const { notificationCategory } = require('../src/services/notification-preferences.service');
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
    create table customers(id uuid primary key, balance numeric not null default 0, preferred_language text default 'ru', fcm_token text, updated_at timestamptz, deleted_at timestamptz);
    create table transactions(id uuid primary key default gen_random_uuid(),customer_id uuid references customers(id),order_id text,type text,amount numeric,description text);`);
  const schema = fs.readFileSync('supabase_schema.sql', 'utf8');
  for (const table of ['customer_notifications', 'customer_push_tokens']) {
    await db.exec(
      schema.match(
        new RegExp(`create table if not exists public\\.${table} \\([\\s\\S]+?\\n\\);`),
      )[0],
    );
  }
  await db.exec(
    fs
      .readFileSync('supabase/migrations/20260729170000_push_notification_outbox.sql', 'utf8')
      .replace('create extension if not exists pgcrypto;', ''),
  );
  for (const name of [
    '20260729171000_push_outbox_leases.sql',
    '20260922161000_push_uncertain_delivery.sql',
  ]) {
    await db.exec(fs.readFileSync(`supabase/migrations/${name}`, 'utf8'));
  }
  await db.exec(fs.readFileSync('supabase/migrations/20261002130000_walking_rewards.sql', 'utf8'));
  await db.exec(
    fs.readFileSync('supabase/migrations/20261006230000_android_walking_rewards.sql', 'utf8'),
  );
  await db.exec(
    fs.readFileSync('supabase/migrations/20261007151000_walking_reward_notifications.sql', 'utf8'),
  );
  today = (await row("select (now() at time zone 'Asia/Almaty')::date::text as walking_day"))
    .walking_day;
});
test.beforeEach(async () => {
  await db.exec(
    'truncate walking_daily_progress,walking_device_keys,walking_used_challenges,transactions,customer_notifications,customer_push_tokens,push_notification_outbox,customers cascade',
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
test('the threshold saves one inbox notice and durable push with distinct installed tokens and legacy fallback', async () => {
  const token = 'walking-registered-token-1';
  await db.query(
    'insert into customer_push_tokens(customer_id,token,installation_id) values($1,$2,$3),($1,$4,$5)',
    [
      customerId,
      token,
      'ios-installation-one',
      'walking-registered-token-2',
      'ios-installation-two',
    ],
  );
  await db.query('update customers set fcm_token=$1 where id=$2', [token, customerId]);
  await apply(9999);
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 0);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 0);
  await apply(10000, { counter: 2 });
  const notice = await row('select * from customer_notifications');
  const push = await row('select * from push_notification_outbox');
  assert.equal(notice.type, 'bonus');
  assert.equal(notice.title, 'Начислено +1 000 бонусов');
  assert.equal(notice.payload.walkingDate, today);
  assert.equal(notice.payload.amount, 1000);
  assert.equal(notice.payload.balance, 1200);
  assert.equal(push.payload.notificationId, notice.id);
  assert.equal(push.dedupe_key, `walking:${notice.id}`);
  assert.equal(push.status, 'queued');
  assert.deepEqual(push.pending_tokens, [token, 'walking-registered-token-2']);
  assert.equal(push.title, notice.title);
  assert.equal('i18n' in push.payload, false);
  await apply(20000, { counter: 3 });
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 1);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 1);
});
test('without push tokens the committed reward is kept in the inbox and bonus ledger', async () => {
  const result = await apply(10000);
  assert.equal(result.credited, true);
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 1);
  assert.equal((await row('select count(*)::int n from transactions')).n, 1);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 0);
});
test('notifications use the customer language and preserve translations for later inbox language changes', async () => {
  for (const [index, language] of ['kk', 'en', 'invalid'].entries()) {
    const date = (
      await row("select ((now() at time zone 'Asia/Almaty')::date-$1::int)::text date", [index])
    ).date;
    await db.query('update customers set preferred_language=$1,fcm_token=$2 where id=$3', [
      language,
      'walking-legacy-fallback-token',
      customerId,
    ]);
    await apply(10000, { date, counter: index + 1 });
    const notice = await row(
      "select * from customer_notifications where payload->>'walkingDate'=$1",
      [date],
    );
    const push = await row(
      "select * from push_notification_outbox where payload->>'walkingDate'=$1",
      [date],
    );
    const expected =
      language === 'kk'
        ? '+1 000 бонус есептелді'
        : language === 'en'
          ? '+1,000 bonuses earned'
          : 'Начислено +1 000 бонусов';
    assert.equal(notice.title, expected);
    assert.equal(push.title, expected);
    assert.deepEqual(Object.keys(notice.payload.i18n.titles).sort(), ['en', 'kk', 'ru']);
    assert.match(notice.payload.i18n.bodies.ru, /10 000 шагов/);
    assert.deepEqual(push.pending_tokens, ['walking-legacy-fallback-token']);
  }
});

function deliveryDatabase() {
  return {
    async rpc(name, args) {
      assert.equal(name, 'claim_push_notification_outbox');
      return {
        data: (
          await db.query('select * from claim_push_notification_outbox($1,$2)', [
            args.p_limit,
            args.p_message_id,
          ])
        ).rows,
        error: null,
      };
    },
    from(table) {
      if (table === 'customer_push_tokens') {
        return {
          select(columns) {
            assert.equal(columns, 'token,customer_id');
            return this;
          },
          async in(column, tokens) {
            assert.equal(column, 'token');
            return {
              data: (
                await db.query(
                  'select token,customer_id from customer_push_tokens where token=any($1::text[])',
                  [tokens],
                )
              ).rows,
              error: null,
            };
          },
        };
      }
      if (table === 'customers') {
        let customer;
        return {
          select(columns) {
            assert.equal(columns, 'id,deleted_at');
            return this;
          },
          eq(column, value) {
            assert.equal(column, 'id');
            customer = value;
            return this;
          },
          async maybeSingle() {
            return {
              data:
                (
                  await db.query('select id,fcm_token,deleted_at from customers where id=$1', [
                    customer,
                  ])
                ).rows[0] || null,
              error: null,
            };
          },
        };
      }
      assert.equal(table, 'push_notification_outbox');
      return {
        update(values) {
          const keys = Object.keys(values);
          const parameters = keys.map((key) =>
            typeof values[key] === 'object' && values[key] !== null
              ? JSON.stringify(values[key])
              : values[key],
          );
          const filters = [];
          const query = {
            eq(field, value) {
              parameters.push(value);
              filters.push(`${field}=$${parameters.length}`);
              return query;
            },
            select() {
              return query;
            },
            async maybeSingle() {
              const sql = `update push_notification_outbox set ${keys.map((key, index) => `${key}=$${index + 1}`).join(',')} where ${filters.join(' and ')} returning id`;
              return { data: (await db.query(sql, parameters)).rows[0] || null, error: null };
            },
          };
          return query;
        },
      };
    },
  };
}

test('a push provider rejection remains durably retryable without failing or duplicating the daily bonus', async () => {
  await db.query('update customers set fcm_token=$1 where id=$2', [
    'walking-provider-test-token',
    customerId,
  ]);
  await db.query(
    'insert into customer_push_tokens(customer_id,token,installation_id) values($1,$2,$3)',
    [customerId, 'walking-provider-test-token', 'walking-provider-installation'],
  );
  assert.equal((await apply(10000)).credited, true);
  const adapter = deliveryDatabase();
  const outcomes = await deliverPushOutbox(
    {
      sendToken: async (_, title, body, payload) => {
        assert.equal(title, 'Начислено +1 000 бонусов');
        assert.match(body, /10 000 шагов/);
        assert.equal(notificationCategory(payload), 'bonus');
        return { delivered: false, terminal: false, error: 'messaging/internal-error' };
      },
      isAllowed: async () => true,
    },
    { db: adapter },
  );
  assert.equal(outcomes[0].status, 'retry');
  assert.equal((await row('select status from push_notification_outbox')).status, 'retry');
  assert.equal(Number((await row('select balance from customers')).balance), 1200);
  await db.exec("update push_notification_outbox set next_attempt_at=now()-interval '1 second'");
  const delivered = await deliverPushOutbox(
    {
      sendToken: async () => ({ delivered: true, terminal: true }),
      isAllowed: async () => true,
    },
    { db: adapter },
  );
  assert.equal(delivered[0].status, 'sent');
  await apply(20000, { counter: 2 });
  assert.equal((await row('select count(*)::int n from transactions')).n, 1);
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 1);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 1);
});

test('existing bonus preferences and quiet hours apply to queued walking pushes while the inbox stays available', async () => {
  await db.query('update customers set fcm_token=$1 where id=$2', [
    'walking-quiet-hours-token',
    customerId,
  ]);
  await apply(10000);
  const adapter = deliveryDatabase();
  const outcomes = await deliverPushOutbox(
    {
      sendToken: async () => {
        throw new Error('Quiet hours must prevent delivery');
      },
      isAllowed: async (_, payload) => {
        assert.equal(notificationCategory(payload), 'bonus');
        throw Object.assign(new Error('Quiet hours'), {
          code: 'PUSH_QUIET_HOURS',
          retryAt: new Date(Date.now() + 3600000).toISOString(),
        });
      },
    },
    { db: adapter },
  );
  assert.equal(outcomes[0].status, 'retry');
  assert.equal((await row('select attempt_count from push_notification_outbox')).attempt_count, 0);
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 1);
  await db.exec("update push_notification_outbox set next_attempt_at=now()-interval '1 second'");
  const disabled = await deliverPushOutbox(
    {
      sendToken: async () => {
        throw new Error('Disabled bonuses must prevent delivery');
      },
      isAllowed: async () => false,
    },
    { db: adapter },
  );
  assert.equal(disabled[0].status, 'skipped');
  assert.equal(Number((await row('select balance from customers')).balance), 1200);
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 1);
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
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 0);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 0);
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
  await db.query('update customers set fcm_token=$1 where id=$2', [
    'walking-android-batch-token',
    customerId,
  ]);
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
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 2);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 2);
  assert.equal(
    (
      await row(
        "select count(distinct payload->>'walkingDate')::int n from push_notification_outbox",
      )
    ).n,
    2,
  );
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
  assert.equal((await row('select count(*)::int n from customer_notifications')).n, 0);
  assert.equal((await row('select count(*)::int n from push_notification_outbox')).n, 0);
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

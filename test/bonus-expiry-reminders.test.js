const assert = require('node:assert/strict');
const test = require('node:test');
const {
  prepareBonusExpiryReminder,
  reminderCopy,
  bonusExpiryReminderTiming,
  runBonusExpiryReminders,
} = require('../src/services/bonus-expiry-reminder.service');
const { deliverPushOutbox } = require('../src/services/push-outbox.service');

const now = new Date('2026-10-15T07:00:00Z');
const customerId = 'b628527c-1510-4074-b1a0-3e18b2f30f51';
const device = 'registered-device-123456';
const payload = {
  type: 'bonus_expiry_reminder',
  reminderVersion: 'credit-lots-v1',
  reminderDays: 30,
  bonusExpiresOn: '2026-11-14',
  amount: 500,
};
const live = {
  eligible: true,
  amount: 300,
  daysLeft: 30,
  expiresOn: '2026-11-14',
  expiresAt: '2026-11-14T07:00:00Z',
  deliveryExpiresAt: '2026-10-15T19:00:00Z',
  language: 'ru',
};
const row = (data = payload) => ({
  id: 'ec45c23a-20b1-4888-bd08-3aeaf6d34fd6',
  customerId,
  title: 'Old title',
  body: 'Whole 700 balance must never be sent',
  data,
});

function fixture() {
  const stored = {
    id: row().id,
    dedupe_key: `bonus-expiry:${customerId}:2026-11-14:30`,
    customer_id: customerId,
    title: row().title,
    body: row().body,
    payload: { ...payload },
    pending_tokens: [device],
    status: 'queued',
    attempt_count: 0,
    max_attempts: 8,
    attempted_tokens: 0,
    delivered_tokens: 0,
  };
  const changes = [];
  const f = {
    stored,
    changes,
    live: { ...live },
    eligibilityError: null,
    owner: customerId,
    async rpc(name, args) {
      if (name === 'bonus_expiry_reminder_state') {
        assert.equal(args.p_customer_id, customerId);
        assert.equal(args.p_expires_on, '2026-11-14');
        assert.equal(args.p_reminder_days, 30);
        return { data: f.live, error: f.eligibilityError };
      }
      assert.equal(name, 'claim_push_notification_outbox');
      if (!['queued', 'retry'].includes(stored.status)) return { data: [] };
      stored.status = 'processing';
      stored.lease_token = '0775a07b-ed23-4a19-a87c-03d9db49e914';
      stored.attempt_count += 1;
      return { data: [{ ...stored }] };
    },
    from(table) {
      if (table === 'customer_push_tokens')
        return {
          select: () => ({ in: async () => ({ data: [{ token: device, customer_id: f.owner }] }) }),
        };
      if (table === 'customers')
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: { id: customerId } }) }),
          }),
        };
      assert.equal(table, 'push_notification_outbox');
      return {
        update(updates) {
          const q = {
            eq() {
              return q;
            },
            select() {
              return q;
            },
            async maybeSingle() {
              changes.push(updates);
              Object.assign(stored, updates);
              return { data: { id: stored.id } };
            },
          };
          return q;
        },
      };
    },
  };
  return f;
}

test('worker queues through the atomic RPC and never sends before durable deduplication', async () => {
  const calls = [];
  const db = {
    rpc: async (name, args) => {
      calls.push([name, args]);
      return { data: 3 };
    },
  };
  assert.deepEqual(await runBonusExpiryReminders({ db, now, limit: 9999 }), { queued: 3 });
  assert.deepEqual(calls, [
    ['enqueue_bonus_expiry_reminders', { p_now: now.toISOString(), p_limit: 2000 }],
  ]);
  await assert.rejects(
    runBonusExpiryReminders({ db: { rpc: async () => ({ error: new Error('db unavailable') }) } }),
    /db unavailable/,
  );
});

test('worker drains multiple complete batches in the same hour and stops at a strict batch bound', async () => {
  const counts = [500, 500, 17];
  let calls = 0;
  const db = {
    async rpc(name, args) {
      assert.equal(name, 'enqueue_bonus_expiry_reminders');
      assert.equal(args.p_limit, 500);
      assert.equal(args.p_now, now.toISOString());
      calls += 1;
      return { data: counts.shift() };
    },
  };
  assert.deepEqual(await runBonusExpiryReminders({ db, now }), { queued: 1017 });
  assert.equal(calls, 3);
  let boundedCalls = 0;
  const bounded = {
    rpc: async () => {
      boundedCalls += 1;
      return { data: 500 };
    },
  };
  assert.deepEqual(await runBonusExpiryReminders({ db: bounded, now }), { queued: 10000 });
  assert.equal(boundedCalls, 20);
  boundedCalls = 0;
  assert.deepEqual(await runBonusExpiryReminders({ db: bounded, now, maxBatches: 999 }), {
    queued: 10000,
  });
  assert.equal(boundedCalls, 20);
});

test('live tranche data replaces the amount, language and text before delivery', async () => {
  const f = fixture();
  const prepared = await prepareBonusExpiryReminder(row(), { db: f, now });
  assert.equal(prepared.data.amount, 300);
  assert.equal(prepared.data.language, 'ru');
  assert.match(prepared.body, /300 ₸/);
  assert.doesNotMatch(prepared.body, /500|700/);
  assert.equal(prepared.data.reminderExpiresAt, live.deliveryExpiresAt);
  f.live.language = 'kk';
  assert.match((await prepareBonusExpiryReminder(row(), { db: f, now })).body, /300 ₸ бонус/);
});

test('malformed, spent, expired and wrong-date reminders fail closed without a provider call', async () => {
  const f = fixture();
  for (const changed of [
    { reminderVersion: null },
    { reminderDays: 5 },
    { bonusExpiresOn: 'yesterday' },
  ])
    assert.equal(
      await prepareBonusExpiryReminder(row({ ...payload, ...changed }), { db: f, now }),
      null,
    );
  for (const changed of [
    { eligible: false },
    { amount: 0 },
    { amount: -10 },
    { daysLeft: 0 },
    { expiresOn: '2027-01-14' },
    { deliveryExpiresAt: now.toISOString() },
  ]) {
    f.live = { ...live, ...changed };
    assert.equal(await prepareBonusExpiryReminder(row(), { db: f, now }), null);
  }
  f.eligibilityError = new Error('lots unavailable');
  await assert.rejects(prepareBonusExpiryReminder(row(), { db: f, now }), /lots unavailable/);
});

test('outbox retries transient failures with a fresh amount then never sends the same milestone again', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const f = fixture();
  const sends = [];
  let fail = true;
  const options = {
    isAllowed: async () => true,
    sendToken: async (token, title, body, data) => {
      sends.push({ token, title, body, data });
      return fail
        ? { delivered: false, terminal: false, error: 'temporary rejection' }
        : { delivered: true };
    },
  };
  const [first] = await deliverPushOutbox(options, { db: f });
  assert.equal(first.status, 'retry');
  assert.match(sends[0].body, /300 ₸/);
  f.live.amount = 120;
  fail = false;
  const [second] = await deliverPushOutbox(options, { db: f });
  assert.equal(second.status, 'sent');
  assert.match(sends[1].body, /120 ₸/);
  assert.equal(sends[1].data.pushDedupeKey, f.stored.dedupe_key);
  assert.deepEqual(await deliverPushOutbox(options, { db: f }), []);
  assert.equal(sends.length, 2);
  assert.equal(f.stored.payload.amount, 120);
});

test('outbox skips a fully spent tranche during retry, and refuses reassigned devices or changed preferences', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  for (const mode of ['spent', 'device', 'preferences', 'legacy']) {
    const f = fixture();
    if (mode === 'spent') f.live.amount = 0;
    if (mode === 'device') f.owner = 'other-customer';
    if (mode === 'legacy') f.stored.payload.type = 'marketing_bonus_expiring';
    let sends = 0;
    const [result] = await deliverPushOutbox(
      {
        isAllowed: async () => mode !== 'preferences',
        sendToken: async () => {
          sends += 1;
          return { delivered: true };
        },
      },
      { db: f },
    );
    assert.equal(result.status, 'skipped', mode);
    assert.equal(sends, 0, mode);
  }
});

test('outbox eligibility outages retry safely without treating unknown data as consent', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now });
  const f = fixture();
  f.eligibilityError = new Error('lots unavailable');
  let sends = 0;
  await assert.rejects(
    deliverPushOutbox(
      {
        isAllowed: async () => true,
        sendToken: async () => {
          sends += 1;
        },
      },
      { db: f },
    ),
    /lots unavailable/,
  );
  assert.equal(sends, 0);
  assert.equal(f.stored.status, 'retry');
  assert.equal(f.stored.in_flight_tokens, undefined);
});

test('bonus reminder push TTL ends at local midnight and never survives a stale dispatch window', () => {
  const data = { ...payload, reminderExpiresAt: live.deliveryExpiresAt };
  assert.equal(bonusExpiryReminderTiming(data, now).state, 'ready');
  assert.equal(bonusExpiryReminderTiming(data, new Date(live.deliveryExpiresAt)).state, 'expired');
  assert.equal(
    bonusExpiryReminderTiming({ ...data, reminderVersion: undefined }, now).state,
    'expired',
  );
  for (const daysLeft of [30, 15, 7]) {
    const copy = reminderCopy({ amount: 500, daysLeft, expiresOn: '2026-11-14', language: 'ru' });
    assert.match(copy.body, new RegExp(`Через ${daysLeft} дней`));
    assert.match(copy.body, /500 ₸/);
  }
});

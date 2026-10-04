const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const customerId = '00000000-0000-4000-8000-000000000001';
const messages = [];
const outbox = [];
let preferences = {};
let allowed = true;
let eligibilityError = null;
let schemaMissing = false;
const supabase = {
  async rpc(name, args) {
    if (name === 'inactive_order_reminder_allowed')
      return { data: allowed, error: eligibilityError };
    assert.equal(name, 'claim_push_notification_outbox');
    const rows = outbox.filter(
      (r) =>
        ['queued', 'retry'].includes(r.status) &&
        (!args.p_message_id || args.p_message_id === r.id),
    );
    for (const row of rows)
      Object.assign(row, {
        status: 'processing',
        lease_token: randomUUID(),
        attempt_count: row.attempt_count + 1,
      });
    return { data: rows.map((r) => ({ ...r })), error: null };
  },
  from(table) {
    const filters = [];
    let inserted;
    let updates;
    const q = {
      select() {
        return q;
      },
      eq(k, v) {
        filters.push([k, v]);
        return q;
      },
      update(value) {
        updates = value;
        return q;
      },
      insert(value) {
        inserted = value;
        return q;
      },
      async order() {
        assert.equal(table, 'customer_push_tokens');
        return { data: [{ token: 'test-reminder-device' }], error: null };
      },
      async single() {
        assert.equal(table, 'push_notification_outbox');
        if (schemaMissing) return { error: { code: '42P01', message: 'test missing schema' } };
        if (outbox.some((r) => r.dedupe_key === inserted.dedupe_key))
          return { error: { code: '23505' } };
        const r = {
          id: randomUUID(),
          ...inserted,
          status: 'queued',
          attempt_count: 0,
          max_attempts: 8,
          attempted_tokens: 0,
          delivered_tokens: 0,
        };
        outbox.push(r);
        return { data: r, error: null };
      },
      async maybeSingle() {
        if (table === 'customer_notification_preferences')
          return { data: preferences, error: null };
        assert.equal(table, 'push_notification_outbox');
        const r = outbox.find((r) => filters.every(([k, v]) => r[k] === v));
        if (r && updates) Object.assign(r, updates);
        return { data: r ? { ...r } : null, error: null };
      },
    };
    return q;
  },
};
for (const [name, exports] of [
  ['../src/config/supabase', { supabase }],
  ['firebase-admin/app', { initializeApp: () => ({}), cert: (x) => x }],
  [
    'firebase-admin/messaging',
    {
      getMessaging: () => ({
        send: async (m) => {
          messages.push(m);
          return 'test-message';
        },
      }),
    },
  ],
]) {
  const id = require.resolve(name);
  require.cache[id] = { id, filename: id, loaded: true, exports };
}
process.env.FIREBASE_SERVICE_ACCOUNT = '{"project_id":"test-reminder-only"}';
const { inactiveReminderTiming } = require('../src/services/inactive-reminder-window');
const { notificationAllowed } = require('../src/services/notification-preferences.service');
const { deliverPushOutbox, pushOutboxDedupeKey } = require('../src/services/push-outbox.service');
const {
  sendPushToCustomer,
  sendPushNotificationDetailed,
} = require('../src/services/push.service');
const { deliverAutomatedMessages } = require('../src/services/commerce-marketing.service');

function payload(date = '2026-10-04') {
  return {
    type: 'marketing_inactive',
    reminderWindowVersion: 'daytime-v1',
    reminderDate: date,
    reminderScheduledAt: `${date}T08:00:00Z`,
    reminderExpiresAt: `${date}T11:00:00Z`,
    reminderDeliveryId: randomUUID(),
    pushDedupeKey: pushOutboxDedupeKey('inactive-day', customerId, date),
  };
}
test.beforeEach(() => {
  messages.length = 0;
  outbox.length = 0;
  preferences = {};
  allowed = true;
  eligibilityError = null;
  schemaMissing = false;
});

test('local boundary guard uses Kazakhstan date,11–16 and explicit expiry, rejects old or malformed queues', () => {
  const data = payload();
  data.reminderScheduledAt = '2026-10-04T06:00:00Z';
  assert.equal(inactiveReminderTiming(data, new Date('2026-10-04T05:59:59Z')).state, 'waiting');
  assert.equal(inactiveReminderTiming(data, new Date('2026-10-04T06:00:00Z')).state, 'ready');
  assert.equal(inactiveReminderTiming(data, new Date('2026-10-04T10:59:59Z')).state, 'ready');
  for (const at of [
    '2026-10-04T11:00:00Z',
    '2026-10-04T17:00:00Z',
    '2026-10-04T19:00:00Z',
    '2026-10-05T06:00:00Z',
  ]) {
    assert.equal(inactiveReminderTiming(data, new Date(at)).state, 'expired');
  }
  for (const changed of [
    { reminderWindowVersion: null },
    { reminderDate: '2026-10-03' },
    { reminderExpiresAt: 'invalid' },
    { reminderExpiresAt: '2026-10-04T17:00:00Z' },
    { reminderScheduledAt: '2026-10-04T05:00:00Z' },
  ]) {
    assert.equal(
      inactiveReminderTiming({ ...data, ...changed }, new Date('2026-10-04T08:00:00Z')).state,
      'expired',
    );
  }
  const historical = {
    ...data,
    reminderDate: '2024-01-04',
    reminderScheduledAt: '2024-01-04T05:00:00Z',
    reminderExpiresAt: '2024-01-04T10:00:00Z',
  };
  assert.equal(inactiveReminderTiming(historical, new Date('2024-01-04T05:00:00Z')).state, 'ready');
});

test('provider eligibility rechecks optout/inactivity and fails closed on unavailable database', async (t) => {
  const data = payload();
  const at = new Date('2026-10-04T08:00:00Z');
  assert.equal(await notificationAllowed(customerId, data, at), true);
  allowed = false;
  assert.equal(await notificationAllowed(customerId, data, at), false);
  allowed = true;
  preferences = { promos_enabled: false };
  assert.equal(await notificationAllowed(customerId, data, at), false);
  preferences = {};
  eligibilityError = { code: '08006' };
  await assert.rejects(notificationAllowed(customerId, data, at), {
    code: 'PUSH_PREFERENCES_UNAVAILABLE',
  });
  assert.equal(
    await notificationAllowed(customerId, data, new Date('2026-10-04T17:00:00Z')),
    false,
  );
  t.mock.method(supabase, 'rpc', async () => {
    throw new Error('socket closed');
  });
  await assert.rejects(notificationAllowed(customerId, data, at), {
    code: 'PUSH_PREFERENCES_UNAVAILABLE',
  });
});

test('quiet-hours optout can delay reminders, while orders and bonus keep their existing schedules', async () => {
  preferences = {
    quiet_hours_enabled: true,
    quiet_start: '12:00',
    quiet_end: '15:00',
    timezone: 'Asia/Almaty',
  };
  await assert.rejects(
    notificationAllowed(customerId, payload(), new Date('2026-10-04T08:00:00Z')),
    { code: 'PUSH_QUIET_HOURS' },
  );
  assert.equal(
    await notificationAllowed(customerId, { type: 'order' }, new Date('2026-10-04T08:00:00Z')),
    true,
  );
  preferences = {};
  assert.equal(
    await notificationAllowed(customerId, { type: 'bonus' }, new Date('2026-10-04T17:00:00Z')),
    true,
  );
  assert.equal(
    await notificationAllowed(customerId, { type: 'order' }, new Date('2026-10-04T17:00:00Z')),
    true,
  );
});

test('FCM envelope expires at16 Kazakhstan for Android, APNs and WebPush;22 has no provider call', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T08:00:00Z') });
  assert.equal(
    (await sendPushNotificationDetailed('test-token', 'Come back', 'Bread', payload())).delivered,
    true,
  );
  assert.equal(messages.length, 1);
  assert.equal(messages[0].android.ttl, 3 * 3600000);
  assert.equal(messages[0].webpush.headers.TTL, String(3 * 3600));
  assert.equal(
    messages[0].apns.headers['apns-expiration'],
    String(Date.parse('2026-10-04T11:00:00Z') / 1000),
  );
  t.mock.timers.setTime(new Date('2026-10-04T17:00:00Z').getTime());
  assert.equal(
    (await sendPushNotificationDetailed('test-token', 'Come back', 'Bread', payload())).expired,
    true,
  );
  assert.equal(messages.length, 1);
});

test('lost marketing acknowledgement and repeat worker use one durable daily outbox; next day is independent', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T08:00:00Z') });
  const data = payload();
  await sendPushToCustomer(customerId, 'Reminder', 'Bread', data);
  await sendPushToCustomer(customerId, 'Changed translation', 'Bun', {
    ...data,
    reminderDeliveryId: randomUUID(),
  });
  assert.equal(outbox.length, 1);
  assert.equal(messages.length, 1);
  t.mock.timers.setTime(new Date('2026-10-05T08:00:00Z').getTime());
  await sendPushToCustomer(customerId, 'Reminder', 'Bread', payload('2026-10-05'));
  assert.equal(outbox.length, 2);
  assert.equal(messages.length, 2);
});

test('missing outbox schema never falls back to immediate non-deduplicated reminders', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-10-04T08:00:00Z') });
  schemaMissing = true;
  await assert.rejects(sendPushToCustomer(customerId, 'Reminder', 'Bread', payload()), {
    code: '42P01',
  });
  assert.equal(messages.length, 0);
});

test('outbox restart at22 or tomorrow skips old reminders without a provider call', async () => {
  for (const at of ['2026-10-04T17:00:00Z', '2026-10-05T08:00:00Z']) {
    outbox.length = 0;
    outbox.push({
      id: randomUUID(),
      customer_id: customerId,
      dedupe_key: 'inactive:test-day',
      title: 'Bread',
      body: 'Bun',
      payload: payload(),
      pending_tokens: ['test-token'],
      status: 'retry',
      attempt_count: 0,
      max_attempts: 8,
    });
    const result = await deliverPushOutbox({
      sendToken: async () => assert.fail('no real or mock provider call allowed'),
      isAllowed: (id, data) => notificationAllowed(id, data, new Date(at)),
    });
    assert.equal(result[0].status, 'skipped');
    assert.deepEqual(outbox[0].pending_tokens, []);
  }
});

test('early outbox retry waits for its customer slot without spending delivery attempt budget', async () => {
  outbox.push({
    id: randomUUID(),
    customer_id: customerId,
    dedupe_key: 'inactive:test-day',
    title: 'Bread',
    body: 'Bun',
    payload: payload(),
    pending_tokens: ['test-token'],
    status: 'retry',
    attempt_count: 2,
    max_attempts: 8,
  });
  const result = await deliverPushOutbox({
    sendToken: async () => assert.fail('must wait'),
    isAllowed: (id, data) => notificationAllowed(id, data, new Date('2026-10-04T05:00:00Z')),
  });
  assert.equal(result[0].status, 'retry');
  assert.equal(outbox[0].attempt_count, 2);
  assert.equal(outbox[0].next_attempt_at, '2026-10-04T08:00:00.000Z');
});

test('marketing dispatcher skips stale reminders and emits stable customer/date dedupe metadata', async () => {
  const sent = [];
  const updates = [];
  const delivery = {
    id: randomUUID(),
    customer_id: customerId,
    payload: payload(),
    marketing_automations: {
      trigger_type: 'inactive',
      active: true,
      title_translations: { ru: 'Bread' },
      body_translations: { ru: 'Bun' },
    },
  };
  const db = {
    from(table) {
      const q = {
        select() {
          return q;
        },
        eq() {
          return q;
        },
        lte() {
          return q;
        },
        order() {
          return q;
        },
        limit: async () => ({ data: [delivery], error: null }),
        maybeSingle: async () => ({
          data: { preferred_language: 'ru', fcm_token: 'test' },
          error: null,
        }),
        update(value) {
          updates.push([table, value]);
          return q;
        },
      };
      return q;
    },
  };
  const sendPush = async (...args) => {
    sent.push(args);
    return { attempted: 1, delivered: 0, queued: true };
  };
  assert.equal(
    await deliverAutomatedMessages(100, {
      db,
      sendPush,
      now: () => new Date('2026-10-04T17:00:00Z'),
    }),
    0,
  );
  assert.equal(sent.length, 0);
  assert.equal(updates[0][1].status, 'skipped');
  assert.equal(
    await deliverAutomatedMessages(100, {
      db,
      sendPush,
      now: () => new Date('2026-10-04T08:00:00Z'),
    }),
    1,
  );
  assert.equal(sent[0][3].reminderDate, '2026-10-04');
  assert.equal(sent[0][3].reminderDeliveryId, delivery.id);
  assert.equal(
    sent[0][3].pushDedupeKey,
    pushOutboxDedupeKey('inactive-day', customerId, '2026-10-04'),
  );
});

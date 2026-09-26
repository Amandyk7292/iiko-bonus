const test = require('node:test');
const assert = require('node:assert/strict');
const database = {
  from() {
    throw new Error('Unexpected database access');
  },
};
const configPath = require.resolve('../src/config/supabase');
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { supabase: database },
};
const {
  validateCartOptions,
  validateModifierGroups,
} = require('../src/services/product-options.service');
const { notificationAllowed } = require('../src/services/notification-preferences.service');
const { deliverPushOutbox } = require('../src/services/push-outbox.service');
const { deliverAutomatedMessages } = require('../src/services/commerce-marketing.service');
const { PersonalAccountTopups } = require('../src/services/personal-account-topup.service');

function memoryDb(tables, errorFor = () => null) {
  return {
    from(table) {
      const predicates = [];
      let patch,
        maximum = Infinity,
        sort;
      const run = () => {
        const error = errorFor(table);
        if (error && !patch) return { data: null, error };
        let rows = (tables[table] || []).filter((row) => predicates.every((fn) => fn(row)));
        if (sort)
          rows = [...rows].sort((a, b) => {
            const x = a[sort.key],
              y = b[sort.key];
            if (x == null && y == null) return 0;
            if (x == null) return sort.nullsFirst ? -1 : 1;
            if (y == null) return sort.nullsFirst ? 1 : -1;
            return (x < y ? -1 : x > y ? 1 : 0) * (sort.ascending ? 1 : -1);
          });
        rows = rows.slice(0, maximum);
        if (patch) rows.forEach((row) => Object.assign(row, patch));
        return { data: rows.map((row) => ({ ...row })), error: null };
      };
      const q = {
        select() {
          return q;
        },
        eq(key, value) {
          predicates.push((row) => row[key] === value);
          return q;
        },
        is(key, value) {
          predicates.push((row) => (value === null ? row[key] == null : row[key] === value));
          return q;
        },
        not(key, operation, value) {
          assert.equal(operation, 'is');
          assert.equal(value, null);
          predicates.push((row) => row[key] != null);
          return q;
        },
        in(key, values) {
          predicates.push((row) => values.includes(row[key]));
          return q;
        },
        gte(key, value) {
          predicates.push((row) => row[key] >= value);
          return q;
        },
        lte(key, value) {
          predicates.push((row) => row[key] <= value);
          return q;
        },
        order(key, opts = {}) {
          sort = { key, ascending: opts.ascending !== false, nullsFirst: opts.nullsFirst };
          return q;
        },
        limit(value) {
          maximum = value;
          return q;
        },
        update(value) {
          patch = value;
          return q;
        },
        async maybeSingle() {
          const result = run();
          return { ...result, data: result.data?.[0] || null };
        },
        then(resolve, reject) {
          return Promise.resolve(run()).then(resolve, reject);
        },
      };
      return q;
    },
  };
}

test('a selected deleted group is rejected even when its price was zero', async (t) => {
  t.mock.method(database, 'from', memoryDb({}).from);
  await assert.rejects(
    validateCartOptions([
      {
        id: 'bakery',
        price: 500,
        quantity: 1,
        modifiers: [{ groupId: 'removed-group', optionIds: ['free-box'] }],
      },
    ]),
    /добавки или упаковка больше недоступны/,
  );
  assert.deepEqual(
    validateModifierGroups([], [{ groupId: 'removed-group', optionIds: [] }]).groups,
    [],
  );
  const group = {
    id: 'box-id',
    code: 'box',
    title: { ru: 'Упаковка' },
    minSelected: 0,
    maxSelected: 1,
    selectionType: 'single',
    options: [{ id: 'free-id', code: 'free', priceDelta: 0 }],
  };
  for (const entry of [
    { groupId: 'box-id', optionIds: ['free-id'] },
    { code: 'box', optionId: 'free' },
  ]) {
    assert.equal(validateModifierGroups([group], [entry]).groups[0].options[0].code, 'free');
  }
});

const preferences = {
  customer_id: 'customer',
  promos_enabled: true,
  quiet_hours_enabled: true,
  quiet_start: '22:00',
  quiet_end: '08:00',
  timezone: 'Asia/Aqtau',
};
function marketingRow(trigger) {
  return {
    id: 'delivery',
    customer_id: 'customer',
    status: 'pending',
    payload: {},
    scheduled_at: '2026-09-22T00:00:00.000Z',
    deduplication_key: `${trigger}:2026`,
    marketing_automations: {
      active: true,
      trigger_type: trigger,
      title_translations: { ru: 'Тест' },
      body_translations: { ru: 'Тестовое сообщение' },
    },
  };
}

test('quiet hours retain a reminder until morning; a second worker does not resend it', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-22T20:00:00Z') });
  const row = marketingRow('inactive');
  const db = memoryDb({
    marketing_deliveries: [row],
    customers: [{ id: 'customer', preferred_language: 'ru', fcm_token: 'test-token' }],
    customer_notification_preferences: [{ ...preferences }],
  });
  t.mock.method(database, 'from', db.from);
  let sent = 0;
  const sendPush = async (id, title, body, data) => {
    assert.equal(await notificationAllowed(id, data), true);
    sent++;
    return { attempted: 1, delivered: 1 };
  };
  assert.equal(await deliverAutomatedMessages(100, { db, sendPush }), 0);
  assert.equal(row.status, 'pending');
  assert.equal(row.scheduled_at, '2026-09-23T03:00:00.000Z');
  t.mock.timers.tick(7 * 3600000);
  assert.equal(await deliverAutomatedMessages(100, { db, sendPush }), 1);
  assert.equal(await deliverAutomatedMessages(100, { db, sendPush }), 0);
  assert.equal(sent, 1);
});

test('a push already queued at night retains tokens and send attempts until morning', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-22T20:00:00Z') });
  const row = {
    id: 'push',
    customer_id: 'customer',
    status: 'queued',
    pending_tokens: ['isolated-test-device'],
    title: 'Reminder',
    body: 'Body',
    payload: { type: 'marketing_inactive' },
    dedupe_key: 'same-event',
    attempt_count: 7,
    max_attempts: 8,
    next_attempt_at: new Date().toISOString(),
  };
  const db = memoryDb({
    push_notification_outbox: [row],
    customer_notification_preferences: [{ ...preferences }],
  });
  db.rpc = async () => {
    if (!['queued', 'retry'].includes(row.status) || Date.parse(row.next_attempt_at) > Date.now())
      return { data: [] };
    row.status = 'processing';
    row.lease_token = 'lease';
    row.attempt_count++;
    return { data: [{ ...row }] };
  };
  t.mock.method(database, 'from', db.from);
  let sent = 0;
  const args = {
    isAllowed: notificationAllowed,
    sendToken: async () => {
      sent++;
      return { delivered: true, terminal: true };
    },
  };
  assert.equal((await deliverPushOutbox(args, { db }))[0].queued, true);
  assert.equal(row.attempt_count, 7);
  assert.equal(row.pending_tokens.length, 1);
  assert.equal(sent, 0);
  t.mock.timers.tick(7 * 3600000);
  await deliverPushOutbox(args, { db });
  await deliverPushOutbox(args, { db });
  assert.equal(row.status, 'sent');
  assert.equal(sent, 1);
});

test('opt-out stays disabled and quiet-hours end follows DST and full-day pauses', async (t) => {
  const pref = { ...preferences };
  t.mock.method(database, 'from', memoryDb({ customer_notification_preferences: [pref] }).from);
  pref.promos_enabled = false;
  assert.equal(await notificationAllowed('customer', { type: 'marketing' }), false);
  pref.promos_enabled = true;
  pref.timezone = 'America/New_York';
  pref.quiet_start = '22:00';
  pref.quiet_end = '08:00';
  await assert.rejects(
    notificationAllowed('customer', { type: 'marketing' }, new Date('2026-03-08T06:30:00Z')),
    (error) => error.code === 'PUSH_QUIET_HOURS' && error.retryAt === '2026-03-08T12:00:00.000Z',
  );
  assert.equal(
    await notificationAllowed('customer', { type: 'order' }, new Date('2026-03-08T06:30:00Z')),
    true,
  );
  pref.quiet_start = pref.quiet_end;
  await assert.rejects(
    notificationAllowed('customer', { type: 'marketing' }, new Date('2026-03-08T06:30:00Z')),
    (error) => error.retryAt === '2026-03-09T06:30:00.000Z',
  );
});

test('a temporary customer read failure retries the same birthday delivery and annual push key', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-09-22T06:00:00Z') });
  const row = marketingRow('birthday');
  let broken = true;
  const db = memoryDb(
    { marketing_deliveries: [row], customers: [{ id: 'customer', preferred_language: 'ru' }] },
    (table) =>
      table === 'customers' && broken
        ? { code: '08006', message: 'temporary connection loss' }
        : null,
  );
  const messages = [];
  const sendPush = async (...args) => {
    messages.push(args);
    return { attempted: 1, delivered: 1 };
  };
  await deliverAutomatedMessages(100, { db, sendPush });
  assert.equal(row.status, 'pending');
  assert.equal(messages.length, 0);
  broken = false;
  t.mock.timers.tick(600000);
  await deliverAutomatedMessages(100, { db, sendPush });
  await deliverAutomatedMessages(100, { db, sendPush });
  assert.equal(messages.length, 1);
  assert.match(messages[0][3].pushDedupeKey, /^birthday:/);
  assert.equal(row.id, 'delivery');
  assert.equal(row.deduplication_key, 'birthday:2026');
  assert.equal(row.status, 'sent');
});

test('completed tokenless topups cannot starve an unsettled payment older than 24 hours', async () => {
  const iso = (delta) => new Date(Date.now() + delta).toISOString();
  const rows = Array.from({ length: 30 }, (_, index) => ({
    id: `expired-${index}`,
    customer_id: 'customer',
    status: 'expired',
    token_ciphertext: null,
    created_at: iso(-7200000),
    expires_at: iso(-5400000),
    checked_at: iso(-3600000),
  }));
  rows.push({
    id: 'old-paid-bank-checkout',
    status: 'pending',
    token_ciphertext: 'isolated-token',
    created_at: iso(-3 * 86400000),
    checked_at: iso(-60000),
  });
  rows.push({
    id: 'recent-refusal',
    status: 'failed',
    token_ciphertext: 'isolated-token',
    created_at: iso(-3600000),
  });
  const db = memoryDb({ personal_account_topups: rows });
  const service = new PersonalAccountTopups({
    db,
    bank: { availability: () => true },
    account: {},
  });
  const synced = [];
  service.sync = async (row) => {
    synced.push(row.id);
    row.status = 'credited';
  };
  assert.equal(await service.reconcile(), 2);
  assert.deepEqual(synced, ['old-paid-bank-checkout', 'recent-refusal']);
});

test('an unfinished tokenless checkout advances its timestamp without expiring a concurrent saved token', async () => {
  const row = {
    id: 'creating',
    customer_id: 'customer',
    status: 'creating',
    token_ciphertext: null,
    checked_at: null,
    expires_at: new Date(Date.now() + 1800000).toISOString(),
  };
  const db = memoryDb({ personal_account_topups: [row] });
  const service = new PersonalAccountTopups({ db, bank: {}, account: {} });
  await service.sync({ ...row });
  assert.ok(row.checked_at);
  assert.equal(row.status, 'creating');
  const stale = { ...row, expires_at: new Date(Date.now() - 1000).toISOString() };
  row.token_ciphertext = 'new-token';
  await service.sync(stale);
  assert.equal(row.status, 'creating');
  row.token_ciphertext = null;
  await service.sync(stale);
  assert.equal(row.status, 'expired');
});

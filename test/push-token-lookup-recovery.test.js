const assert = require('node:assert/strict');
const test = require('node:test');

const customerId = 'customer-token-lookup-test';
const deviceToken = 'registered-device-token-lookup-test';
const sentMessages = [];
let tables;
let tokenReadFailure;
let failByRejection;
let tokenReads;

// Exercise the real sender, marketing consumer, token ownership and outbox.
// Only the database boundary and Firebase transport are replaced.
const db = {
  from(table) {
    const predicates = [];
    let updates;
    let inserted;
    let maximum = Infinity;
    const run = () => {
      if (table === 'customer_push_tokens' && !updates && !inserted) {
        tokenReads++;
        if (tokenReadFailure) {
          if (failByRejection) throw tokenReadFailure;
          return { data: null, error: tokenReadFailure };
        }
      }
      if (inserted) {
        const row = {
          id: `outbox-${tables.push_notification_outbox.length + 1}`,
          status: 'queued',
          attempt_count: 0,
          attempted_tokens: 0,
          delivered_tokens: 0,
          next_attempt_at: new Date().toISOString(),
          ...inserted,
        };
        tables[table].push(row);
        return { data: [row], error: null };
      }
      const rows = (tables[table] || [])
        .filter((row) => predicates.every((fn) => fn(row)))
        .slice(0, maximum);
      if (updates) rows.forEach((row) => Object.assign(row, updates));
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
      in(key, values) {
        predicates.push((row) => values.includes(row[key]));
        return q;
      },
      lte(key, value) {
        predicates.push((row) => row[key] <= value);
        return q;
      },
      order() {
        return q;
      },
      limit(value) {
        maximum = value;
        return q;
      },
      update(values) {
        updates = values;
        return q;
      },
      insert(values) {
        inserted = values;
        return q;
      },
      async maybeSingle() {
        const result = run();
        return { ...result, data: result.data?.[0] || null };
      },
      async single() {
        return q.maybeSingle();
      },
      then(resolve, reject) {
        return Promise.resolve().then(run).then(resolve, reject);
      },
    };
    return q;
  },
  async rpc(name, args) {
    if (name === 'inactive_order_reminder_allowed') return { data: true, error: null };
    assert.equal(name, 'claim_push_notification_outbox');
    const rows = tables.push_notification_outbox.filter(
      (row) =>
        (!args.p_message_id || row.id === args.p_message_id) &&
        ['queued', 'retry'].includes(row.status),
    );
    for (const row of rows)
      Object.assign(row, {
        status: 'processing',
        attempt_count: row.attempt_count + 1,
        lease_token: `lease-${row.id}`,
      });
    return { data: rows.map((row) => ({ ...row })), error: null };
  },
};

const paths = [
  require.resolve('../src/config/supabase'),
  require.resolve('firebase-admin/app'),
  require.resolve('firebase-admin/messaging'),
];
const previous = paths.map((file) => require.cache[file]);
const previousAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
const replacements = [
  { supabase: db },
  { initializeApp: () => ({}), cert: (value) => value },
  {
    getMessaging: () => ({
      async send(message) {
        sentMessages.push(message);
        return `fcm-${sentMessages.length}`;
      },
    }),
  },
];
paths.forEach((file, i) => {
  require.cache[file] = { id: file, filename: file, loaded: true, exports: replacements[i] };
});
process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'isolated-lookup-test' });
const { getCustomerPushTokens, sendPushToCustomer } = require('../src/services/push.service');
const { deliverAutomatedMessages } = require('../src/services/commerce-marketing.service');

test.after(() => {
  paths.forEach((file, i) => {
    if (previous[i]) require.cache[file] = previous[i];
    else delete require.cache[file];
  });
  if (previousAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = previousAccount;
});

test.beforeEach(() => {
  tables = {
    customers: [{ id: customerId, deleted_at: null, fcm_token: null, preferred_language: 'ru' }],
    customer_push_tokens: [{ customer_id: customerId, token: deviceToken }],
    customer_notification_preferences: [],
    marketing_deliveries: [],
    push_notification_outbox: [],
  };
  tokenReadFailure = null;
  failByRejection = false;
  tokenReads = 0;
  sentMessages.length = 0;
});

for (const trigger of ['birthday', 'inactive']) {
  for (const rejection of [false, true]) {
    test(`${trigger} delivery survives ${rejection ? 'rejected' : 'error response'} token query and sends once after recovery`, async (t) => {
      t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-10-18T08:00:00Z') });
      const delivery = {
        id: 'marketing-delivery',
        customer_id: customerId,
        status: 'pending',
        scheduled_at: new Date().toISOString(),
        deduplication_key: `${trigger}:2026-10-18`,
        payload:
          trigger === 'inactive'
            ? {
                reminderWindowVersion: 'daytime-v1',
                reminderDate: '2026-10-18',
                reminderScheduledAt: '2026-10-18T08:00:00Z',
                reminderExpiresAt: '2026-10-18T11:00:00Z',
              }
            : {},
        marketing_automations: {
          active: true,
          trigger_type: trigger,
          title_translations: { ru: 'Подарок от Bulka' },
          body_translations: { ru: 'Ждём вас в Bulka' },
        },
      };
      tables.marketing_deliveries.push(delivery);
      tokenReadFailure = Object.assign(new Error('Temporary database connection failure'), {
        code: '08006',
      });
      failByRejection = rejection;
      assert.equal(await deliverAutomatedMessages(100, { db }), 0);
      assert.equal(delivery.status, 'pending');
      assert.equal(delivery.scheduled_at, '2026-10-18T08:10:00.000Z');
      assert.match(delivery.error, /push token lookup temporarily unavailable/);
      assert.equal(tables.push_notification_outbox.length, 0);
      assert.equal(sentMessages.length, 0);
      tokenReadFailure = null;
      t.mock.timers.tick(600000);
      assert.equal(await deliverAutomatedMessages(100, { db }), 1);
      assert.equal(delivery.status, 'sent');
      assert.equal(delivery.error, null);
      assert.equal(tables.push_notification_outbox.length, 1);
      assert.equal(tables.push_notification_outbox[0].status, 'sent');
      assert.equal(sentMessages.length, 1);
      assert.equal(sentMessages[0].token, deviceToken);
      assert.equal(await deliverAutomatedMessages(100, { db }), 0);
      assert.equal(sentMessages.length, 1);
      assert.equal(tokenReads, 3); // failed read, recovered read, final ownership recheck
    });
  }
}

test('a token lookup failure remains retryable even with a legacy fallback and makes no provider attempt', async () => {
  tokenReadFailure = { code: '08006', message: 'connection lost' };
  await assert.rejects(
    sendPushToCustomer(customerId, 'Title', 'Body', { type: 'bonus' }, deviceToken),
    (error) => {
      assert.equal(error.code, 'PUSH_TOKENS_UNAVAILABLE');
      assert.equal(error.retryable, true);
      assert.equal(error.cause, tokenReadFailure);
      return true;
    },
  );
  assert.equal(sentMessages.length, 0);
  assert.equal(tables.push_notification_outbox.length, 0);
});

test('a successful empty lookup differs from an unavailable lookup; legacy schema fallback remains supported', async () => {
  tables.customer_push_tokens.length = 0;
  assert.deepEqual(await getCustomerPushTokens(customerId), []);
  tokenReadFailure = { code: '42P01', message: 'legacy schema without token table' };
  assert.deepEqual(await getCustomerPushTokens(customerId, deviceToken), [deviceToken]);
});

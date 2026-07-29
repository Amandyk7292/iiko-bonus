const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appModulePath = require.resolve('firebase-admin/app');
const messagingModulePath = require.resolve('firebase-admin/messaging');
const supabaseModulePath = require.resolve('../src/config/supabase');
const pushModulePath = require.resolve('../src/services/push.service');
const previousModules = new Map(
  [appModulePath, messagingModulePath, supabaseModulePath, pushModulePath].map((modulePath) => [
    modulePath,
    require.cache[modulePath],
  ]),
);
const previousServiceAccount = process.env.FIREBASE_SERVICE_ACCOUNT;
const sentMessages = [];
const rpcCalls = [];
const pushOutboxRows = [];
let failOutboxUpdate = false;

const supabase = {
  from(table) {
    if (table === 'customer_notification_preferences') {
      return {
        select() {
          return this;
        },
        eq(column, value) {
          assert.equal(column, 'customer_id');
          assert.equal(value, 'customer-1');
          return this;
        },
        async maybeSingle() {
          return { data: null, error: { code: '42P01', message: 'table is not installed' } };
        },
      };
    }
    if (table === 'push_notification_outbox') {
      return {
        insert(record) {
          const row = {
            id: `push-outbox-${pushOutboxRows.length + 1}`,
            ...record,
            status: 'queued',
            attempt_count: 0,
            attempted_tokens: 0,
            delivered_tokens: 0,
            next_attempt_at: new Date().toISOString(),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          };
          pushOutboxRows.push(row);
          return {
            select() {
              return {
                async single() {
                  return { data: row, error: null };
                },
              };
            },
          };
        },
        update(values) {
          const filters = [];
          const query = {
            eq(column, value) {
              filters.push([column, value]);
              return query;
            },
            select() {
              return query;
            },
            async maybeSingle() {
              if (failOutboxUpdate) {
                return { data: null, error: { code: '08006', message: 'connection lost' } };
              }
              const row = pushOutboxRows.find((candidate) =>
                filters.every(([column, value]) => candidate[column] === value),
              );
              if (row) Object.assign(row, values);
              return { data: row ? { id: row.id } : null, error: null };
            },
          };
          return query;
        },
      };
    }
    assert.equal(table, 'customer_push_tokens');
    return {
      select() {
        return this;
      },
      eq(column, value) {
        assert.equal(column, 'customer_id');
        assert.equal(value, 'customer-1');
        return this;
      },
      async order() {
        return {
          data: [
            { token: 'device-token-android-1234567890' },
            { token: 'device-token-web-123456789012345' },
          ],
          error: null,
        };
      },
    };
  },
  async rpc(name, args) {
    rpcCalls.push([name, args]);
    if (name === 'claim_push_notification_outbox') {
      const row = pushOutboxRows.find((candidate) => candidate.id === args.p_message_id);
      if (!row) return { data: [], error: null };
      row.status = 'processing';
      row.attempt_count += 1;
      row.lease_token = '21dd5b2c-d7dc-4bb2-a1b4-9d204983cf53';
      return { data: [row], error: null };
    }
    return { data: 1, error: null };
  },
};

process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'push-test' });
require.cache[appModulePath] = {
  id: appModulePath,
  filename: appModulePath,
  loaded: true,
  exports: { initializeApp: () => ({}), cert: (value) => value },
};
require.cache[messagingModulePath] = {
  id: messagingModulePath,
  filename: messagingModulePath,
  loaded: true,
  exports: {
    getMessaging: () => ({
      async send(message) {
        if (message.token === 'invalid-device-token-1234567890') {
          const error = new Error('registration token is no longer registered');
          error.code = 'messaging/registration-token-not-registered';
          throw error;
        }
        sentMessages.push(message);
        return `message-${sentMessages.length}`;
      },
    }),
  },
};
require.cache[supabaseModulePath] = {
  id: supabaseModulePath,
  filename: supabaseModulePath,
  loaded: true,
  exports: { supabase },
};

delete require.cache[pushModulePath];
const { sendPushNotification, sendPushToCustomer } = require('../src/services/push.service');

test.after(() => {
  for (const [modulePath, cached] of previousModules) {
    if (cached) require.cache[modulePath] = cached;
    else delete require.cache[modulePath];
  }
  if (previousServiceAccount === undefined) delete process.env.FIREBASE_SERVICE_ACCOUNT;
  else process.env.FIREBASE_SERVICE_ACCOUNT = previousServiceAccount;
});

test('push is delivered to every registered installation with string data', async () => {
  const result = await sendPushToCustomer(
    'customer-1',
    'Order ready',
    'Collect it at the counter',
    { type: 'order', orderId: 42, payload: { ready: true } },
    'device-token-android-1234567890',
  );

  assert.deepEqual(
    {
      attempted: result.attempted,
      delivered: result.delivered,
      failed: result.failed,
      queued: result.queued,
      status: result.status,
    },
    { attempted: 2, delivered: 2, failed: 0, queued: false, status: 'sent' },
  );
  assert.equal(sentMessages.length, 2);
  assert.deepEqual(
    new Set(sentMessages.map((message) => message.token)),
    new Set(['device-token-android-1234567890', 'device-token-web-123456789012345']),
  );
  for (const message of sentMessages) {
    assert.equal(message.data.orderId, '42');
    assert.equal(message.data.payload, '{"ready":true}');
    assert.equal(message.webpush.fcmOptions.link, 'https://bulka.com.kz/app/');
    assert.equal('badge' in message.apns.payload.aps, false);
    assert.equal(message.android.notification.channelId, 'bulka_order_status');
    assert.equal(message.android.notification.sticky, true);
  }
});

test('FCM invalid-token errors remove the stale installation', async () => {
  const delivered = await sendPushNotification('invalid-device-token-1234567890', 'Title', 'Body');

  assert.equal(delivered, false);
  assert.deepEqual(rpcCalls.at(-1), [
    'remove_invalid_customer_push_token',
    { p_token: 'invalid-device-token-1234567890' },
  ]);
});

test('a post-send outbox failure never falls back to a duplicate immediate send', async () => {
  const sentBefore = sentMessages.length;
  failOutboxUpdate = true;
  try {
    const result = await sendPushToCustomer(
      'customer-1',
      'Unique notification',
      'Send exactly once in this attempt',
      { type: 'bonus', eventId: 'outbox-write-failure-1' },
    );
    assert.equal(result.queued, true);
    assert.equal(sentMessages.length - sentBefore, 2);
  } finally {
    failOutboxUpdate = false;
  }
});

test('closed delivery replaces the persistent Android status', async () => {
  const delivered = await sendPushNotification(
    'device-token-delivery-1234567890',
    'Title',
    'Body',
    {
      type: 'delivery',
      orderId: 'order-1',
      orderStatus: 'ready',
      deliveryStatus: 'cancelled',
    },
  );

  assert.equal(delivered, true);
  const message = sentMessages.at(-1);
  assert.equal(message.android.notification.channelId, 'bulka_order_status');
  assert.equal(message.android.notification.sticky, false);
});

test('push migration enforces one token and installation owner', () => {
  const sql = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260715193000_push_device_tokens.sql'),
    'utf8',
  );
  assert.match(sql, /token text not null unique/i);
  assert.match(sql, /installation_id varchar\(160\) not null unique/i);
  assert.match(sql, /register_customer_push_token/i);
  assert.match(sql, /unregister_customer_push_token/i);
  assert.match(sql, /remove_invalid_customer_push_token/i);
  assert.match(sql, /on delete cascade/i);
});

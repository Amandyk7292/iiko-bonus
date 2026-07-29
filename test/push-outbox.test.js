const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  deliverPushOutbox,
  enqueuePushNotification,
  pushOutboxDedupeKey,
  retryDelaySeconds,
} = require('../src/services/push-outbox.service');

const queuedRow = (overrides = {}) => ({
  id: '44fd135a-2f42-4a2d-878e-9f01f32fa03f',
  dedupe_key: 'order:12345678',
  customer_id: 'a3659532-67eb-4c80-b264-7c5db5c43844',
  title: 'Заказ готов',
  body: 'Можно забирать',
  payload: { type: 'order', orderId: 'order-1' },
  pending_tokens: ['device-token-ok-123456', 'device-token-retry-123456'],
  status: 'processing',
  lease_token: '21dd5b2c-d7dc-4bb2-a1b4-9d204983cf53',
  attempt_count: 1,
  max_attempts: 8,
  attempted_tokens: 0,
  delivered_tokens: 0,
  next_attempt_at: new Date().toISOString(),
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  ...overrides,
});

function deliveryDb(row) {
  const updates = [];
  return {
    updates,
    async rpc(name, args) {
      assert.equal(name, 'claim_push_notification_outbox');
      assert.equal(args.p_limit, 50);
      return { data: [row], error: null };
    },
    from(table) {
      assert.equal(table, 'push_notification_outbox');
      return {
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
              updates.push({ values, filters });
              return { data: { id: row.id }, error: null };
            },
          };
          return query;
        },
      };
    },
  };
}

test('push outbox retries only transiently failed device tokens', async () => {
  const db = deliveryDb(queuedRow());
  const outcomes = await deliverPushOutbox(
    {
      async sendToken(token) {
        return token.includes('-ok-')
          ? { delivered: true, terminal: true }
          : { delivered: false, terminal: false, error: 'messaging/internal-error' };
      },
      isAllowed: async () => true,
    },
    { db },
  );

  assert.equal(outcomes.length, 1);
  assert.deepEqual(
    {
      status: outcomes[0].status,
      attempted: outcomes[0].attempted,
      delivered: outcomes[0].delivered,
      queued: outcomes[0].queued,
    },
    { status: 'retry', attempted: 2, delivered: 1, queued: true },
  );
  assert.equal(db.updates[0].values.status, 'retry');
  assert.deepEqual(db.updates[0].values.pending_tokens, ['device-token-retry-123456']);
  assert.equal(db.updates[0].values.attempted_tokens, 2);
  assert.equal(db.updates[0].values.delivered_tokens, 1);
});

test('push outbox does not retry invalid tokens', async () => {
  const db = deliveryDb(
    queuedRow({
      pending_tokens: ['device-token-invalid-123456'],
    }),
  );
  const [outcome] = await deliverPushOutbox(
    {
      sendToken: async () => ({
        delivered: false,
        terminal: true,
        error: 'messaging/registration-token-not-registered',
      }),
      isAllowed: async () => true,
    },
    { db },
  );

  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.queued, false);
  assert.equal(db.updates[0].values.status, 'skipped');
  assert.deepEqual(db.updates[0].values.pending_tokens, []);
});

test('push enqueue is idempotent and strips internal dedupe metadata', async () => {
  const inserted = [];
  const db = {
    from(table) {
      assert.equal(table, 'push_notification_outbox');
      return {
        insert(record) {
          inserted.push(record);
          return {
            select() {
              return {
                async single() {
                  return {
                    data: queuedRow({
                      ...record,
                      id: 'cdd01dca-0935-411e-956c-d64d69c34db5',
                      status: 'queued',
                    }),
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const queued = await enqueuePushNotification(
    {
      customerId: 'a3659532-67eb-4c80-b264-7c5db5c43844',
      title: 'Готово',
      body: 'Заказ готов',
      data: { type: 'order', orderId: 'order-1', pushDedupeKey: 'order-ready:order-1' },
      tokens: ['device-token-ok-123456', 'device-token-ok-123456'],
      dedupeKey: 'order-ready:order-1',
    },
    { db },
  );

  assert.equal(queued.status, 'queued');
  assert.equal(inserted[0].dedupe_key, 'order-ready:order-1');
  assert.deepEqual(inserted[0].pending_tokens, ['device-token-ok-123456']);
  assert.equal('pushDedupeKey' in inserted[0].payload, false);
});

test('push outbox migration provides locked claims and privacy cleanup', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260729170000_push_notification_outbox.sql',
    ),
    'utf8',
  );
  assert.match(sql, /create table if not exists public\.push_notification_outbox/i);
  assert.match(sql, /for update skip locked/i);
  assert.match(sql, /claim_push_notification_outbox/i);
  assert.match(sql, /pending_tokens = '\[\]'::jsonb/i);
  assert.match(sql, /customers_purge_push_outbox_on_anonymise/i);
  assert.match(sql, /on delete cascade/i);
  assert.equal(retryDelaySeconds(1), 15);
  assert.equal(retryDelaySeconds(20), 1800);
  assert.match(pushOutboxDedupeKey('order', '1'), /^order:[a-f0-9]{56}$/);
});

test('push outbox lease expansion is an immutable follow-up migration', () => {
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260729171000_push_outbox_leases.sql',
    ),
    'utf8',
  );
  assert.match(sql, /add column if not exists lease_token uuid/i);
  assert.match(sql, /lease_token = gen_random_uuid\(\)/i);
  assert.match(sql, /status = 'processing'/i);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const configPath = require.resolve('../src/config/supabase');
const supabase = {
  from() {
    throw new Error('Unmocked database query');
  },
};
require.cache[configPath] = {
  id: configPath,
  filename: configPath,
  loaded: true,
  exports: { supabase },
};
const { validateBuilder, validateCartOptions } = require('../src/services/product-options.service');
const { listAvailableSlots } = require('../src/services/slot.service');
const { optionSummary } = require('../src/utils/order-options');
const { notificationAllowed } = require('../src/services/notification-preferences.service');
const { deliverPushOutbox } = require('../src/services/push-outbox.service');
const now = new Date('2026-09-22T07:00:00Z');
const configuration = {
  enabled: true,
  productKind: 'cake',
  weightOptions: [],
  fillingOptions: [],
  designOptions: [],
  inscriptionMaxLength: 80,
  minLeadHours: 72,
  maxAdvanceDays: 7,
};

test('preparation limits use the actual checkout time, including missing time and ASAP delivery', () => {
  const opts = { now: now.getTime() };
  assert.throws(() => validateBuilder(configuration, {}, opts), /время получения/);
  assert.throws(
    () =>
      validateBuilder(
        configuration,
        { readyAt: '2026-09-26T07:00:00Z' },
        { ...opts, scheduledAt: '2026-09-23T07:00:00Z' },
      ),
    /минимум 72/,
  );
  assert.throws(
    () => validateBuilder(configuration, {}, { ...opts, asap: true }),
    /время получения/,
  );
  const selected = validateBuilder(
    configuration,
    { readyAt: '2027-01-01T07:00:00Z' },
    { ...opts, scheduledAt: '2026-09-25T07:00:00Z' },
  );
  assert.equal(selected.readyAt, '2026-09-25T07:00:00.000Z');
  assert.match(optionSummary({ configuration: selected }), /Готовность:.*12:00/);
  assert.throws(
    () => validateBuilder(configuration, {}, { ...opts, scheduledAt: '2026-10-01T07:00:00Z' }),
    /максимум за 7/,
  );
  assert.equal(
    validateBuilder({ ...configuration, minLeadHours: 0 }, {}, { ...opts, asap: true }).readyAt,
    null,
  );
});

test('slot picker starts at the slowest product deadline and respects the shortest advance window', async (t) => {
  const config = {
    product_id: 'cake',
    enabled: true,
    product_kind: 'cake',
    min_lead_hours: 72,
    max_advance_days: 4,
  };
  t.mock.method(supabase, 'from', (table) => {
    const q = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      in() {
        return q;
      },
      order() {
        return q;
      },
      gte() {
        return q;
      },
      lt() {
        return q;
      },
      async maybeSingle() {
        return {
          data: {
            id: 'branch',
            active: true,
            preorder_enabled: true,
            slot_minutes: 60,
            preorder_slot_capacity: 10,
            hours: { daily: { open: '08:00', close: '23:00' } },
          },
        };
      },
      then(resolve, reject) {
        return Promise.resolve({
          data: table === 'product_configurations' ? [config] : [],
          error: null,
        }).then(resolve, reject);
      },
    };
    return q;
  });
  const result = await listAvailableSlots({
    branchId: 'branch',
    orderType: 'preorder',
    days: 3,
    productIds: ['cake'],
    now,
  });
  assert.ok(result.slots.length > 0);
  for (const slot of result.slots) {
    assert.ok(Date.parse(slot.startsAt) >= now.getTime() + 72 * 3600000);
    assert.ok(Date.parse(slot.startsAt) <= now.getTime() + 4 * 86400000);
  }
  await assert.rejects(
    validateCartOptions([{ id: 'cake', price: 1000, quantity: 1 }], {
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    }),
    /минимум 72/,
  );
});

function queue() {
  const row = {
    id: 'audit-message',
    customer_id: 'customer',
    dedupe_key: 'birthday:test:2026',
    title: 'Birthday',
    body: 'Greeting',
    payload: { type: 'marketing_birthday' },
    pending_tokens: ['test-device-token-0001'],
    status: 'queued',
    attempt_count: 0,
    max_attempts: 8,
    attempted_tokens: 0,
    delivered_tokens: 0,
    in_flight_tokens: [],
    uncertain_tokens: [],
  };
  let failAfterSend = false;
  const db = {
    async rpc() {
      if (!['queued', 'retry', 'processing'].includes(row.status)) return { data: [], error: null };
      row.status = 'processing';
      row.attempt_count++;
      row.lease_token = 'lease-' + row.attempt_count;
      return { data: [{ ...row }], error: null };
    },
    from() {
      let updates;
      const q = {
        update(value) {
          updates = value;
          return q;
        },
        eq() {
          return q;
        },
        select() {
          return q;
        },
        async maybeSingle() {
          if (failAfterSend && updates.status === 'sent') {
            failAfterSend = false;
            return {
              data: null,
              error: new Error('Connection lost while persisting FCM response'),
            };
          }
          Object.assign(row, updates);
          return { data: { id: row.id }, error: null };
        },
      };
      return q;
    },
  };
  return {
    db,
    row,
    failAcknowledgement() {
      failAfterSend = true;
    },
  };
}

test('preference lookup failure defers the queue without sending; disabled marketing stays blocked', async (t) => {
  let preferenceError = new Error('Database unavailable');
  t.mock.method(supabase, 'from', () => {
    const q = {
      select() {
        return q;
      },
      eq() {
        return q;
      },
      async maybeSingle() {
        return { data: { promos_enabled: false }, error: preferenceError };
      },
    };
    return q;
  });
  const q = queue();
  let sent = 0;
  const args = {
    sendToken: async () => {
      sent++;
      return { delivered: true, terminal: true };
    },
    isAllowed: notificationAllowed,
  };
  await assert.rejects(
    deliverPushOutbox(args, { db: q.db }),
    (e) => e.code === 'PUSH_PREFERENCES_UNAVAILABLE',
  );
  assert.equal(q.row.status, 'retry');
  assert.equal(sent, 0);
  assert.deepEqual(q.row.in_flight_tokens, []);
  preferenceError = null;
  await deliverPushOutbox(args, { db: q.db });
  assert.equal(q.row.status, 'skipped');
  assert.equal(sent, 0);
});

test('uncertain acceptance is recorded and not retried on another worker pass', async () => {
  const q = queue();
  let sent = 0;
  const args = {
    sendToken: async () => {
      sent++;
      assert.deepEqual(q.row.in_flight_tokens, ['test-device-token-0001']);
      return {
        delivered: false,
        terminal: false,
        outcomeUnknown: true,
        error: 'app/network-timeout',
      };
    },
    isAllowed: async () => true,
  };
  const [result] = await deliverPushOutbox(args, { db: q.db });
  assert.equal(result.outcomeUnknown, true);
  assert.deepEqual(q.row.uncertain_tokens, ['test-device-token-0001']);
  await deliverPushOutbox(args, { db: q.db });
  assert.equal(sent, 1);
});

test('lost database acknowledgement after successful FCM delivery cannot duplicate the push', async () => {
  const q = queue();
  q.failAcknowledgement();
  let sent = 0;
  const args = {
    sendToken: async () => {
      sent++;
      return { delivered: true, terminal: true };
    },
    isAllowed: async () => true,
  };
  await assert.rejects(deliverPushOutbox(args, { db: q.db }), /persisting FCM/);
  assert.equal(q.row.status, 'retry');
  const [recovered] = await deliverPushOutbox(args, { db: q.db });
  assert.equal(sent, 1);
  assert.equal(recovered.outcomeUnknown, true);
});

test('definite rejection remains retryable and clears the in-flight marker', async () => {
  const q = queue();
  let attempts = 0;
  const args = {
    sendToken: async () =>
      ++attempts === 1
        ? {
            delivered: false,
            terminal: false,
            outcomeUnknown: false,
            error: 'messaging/server-unavailable',
          }
        : { delivered: true, terminal: true },
    isAllowed: async () => true,
  };
  await deliverPushOutbox(args, { db: q.db });
  assert.equal(q.row.status, 'retry');
  assert.deepEqual(q.row.in_flight_tokens, []);
  await deliverPushOutbox(args, { db: q.db });
  assert.equal(q.row.status, 'sent');
  assert.equal(attempts, 2);
});

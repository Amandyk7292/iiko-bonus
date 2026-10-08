const assert = require('node:assert/strict');
const test = require('node:test');
const {
  enqueueAutomatedMessages,
  deliverAutomatedMessages,
} = require('../src/services/commerce-marketing.service');
const now = new Date('2026-10-08T12:00:00Z');
const atAge = (days) => new Date(now.getTime() - days * 86400000).toISOString();

function fixture(policy, age = 24) {
  const queued = [],
    updates = [],
    reads = [];
  const customer = { id: 'customer', balance: 1000, created_at: atAge(100), deleted_at: null };
  const campaign = {
    id: 'expiry-default',
    trigger_type: 'bonus_expiring',
    active: true,
    config: { expirationDays: 90, daysBefore: 7 },
  };
  const pending = [
    { id: 'pending', customer_id: 'customer', marketing_automations: campaign, payload: {} },
  ];
  const chain = (value) => {
    const q = {};
    for (const key of ['select', 'eq', 'is', 'not', 'order', 'limit', 'lte']) q[key] = () => q;
    q.then = (resolve, reject) => Promise.resolve(value).then(resolve, reject);
    return q;
  };
  const db = {
    async rpc(name, args) {
      if (name === 'enqueue_birthday_greetings') return { data: 0 };
      assert.equal(name, 'customer_bonus_activity');
      assert.deepEqual(args.p_customer_ids, ['customer']);
      return { data: [{ customer_id: 'customer', last_activity_at: atAge(age) }] };
    },
    from(table) {
      reads.push(table);
      if (table === 'marketing_automations') return chain({ data: [campaign] });
      if (table === 'customers') {
        return Object.assign(chain({ data: [customer] }), {
          async maybeSingle() {
            return { data: customer };
          },
        });
      }
      assert.equal(table, 'marketing_deliveries');
      return Object.assign(chain({ data: pending }), {
        upsert(row) {
          queued.push(row);
          return chain({ data: [{ id: 'queued' }] });
        },
        update(row) {
          updates.push(row);
          return chain({ data: null });
        },
      });
    },
  };
  return {
    db,
    queued,
    updates,
    reads,
    deps: { db, clock: () => now, loadSettings: async () => ({ bonus_expiration: policy }) },
  };
}

test('expiry warnings use saved expiry length, notice period and authoritative bonus activity', async () => {
  const f = fixture({
    enabled: true,
    auto_write_off: true,
    expiration_days: 30,
    notify_before_days: 7,
  });
  assert.equal(await enqueueAutomatedMessages(f.deps), 1);
  assert.equal(f.queued[0].payload.daysBefore, 7);
  assert.equal(f.queued[0].customer_id, 'customer');
  // The account was created 100 days ago, but real bonus activity was 24 days ago.
  assert.equal(f.reads.includes('transactions'), false);
  const notice = fixture({ enabled: true, expiration_days: 90, notify_before_days: 30 }, 61);
  assert.equal(await enqueueAutomatedMessages(notice.deps), 1);
  assert.equal(notice.queued[0].payload.daysBefore, 30);
});

test('disabled expiration or writeoff never enqueues warnings or reads customer activity', async () => {
  for (const patch of [{ enabled: false }, { auto_write_off: false }]) {
    const f = fixture(
      {
        enabled: true,
        auto_write_off: true,
        expiration_days: 90,
        notify_before_days: 30,
        ...patch,
      },
      84,
    );
    assert.equal(await enqueueAutomatedMessages(f.deps), 0);
    assert.deepEqual(f.queued, []);
    assert.equal(f.reads.includes('customers'), false);
  }
});

test('warnings exclude accounts before the notice window and at or past expiry', async () => {
  for (const age of [22, 30, 31]) {
    const f = fixture({ enabled: true, expiration_days: 30, notify_before_days: 7 }, age);
    assert.equal(await enqueueAutomatedMessages(f.deps), 0);
  }
});

test('queued warnings are skipped when expiration or automatic writeoff is disabled later', async () => {
  for (const patch of [{ enabled: false }, { auto_write_off: false }]) {
    const f = fixture({ enabled: true, auto_write_off: true, ...patch });
    let sent = 0;
    assert.equal(
      await deliverAutomatedMessages(100, {
        ...f.deps,
        now: () => now,
        sendPush: async () => {
          sent += 1;
        },
      }),
      0,
    );
    assert.equal(sent, 0);
    assert.equal(f.updates[0].status, 'skipped');
    assert.equal(f.reads.includes('customers'), false);
  }
});

test('queued warnings recheck the current warning window before sending', async () => {
  for (const [age, expectedSent] of [
    [22, 0],
    [24, 1],
    [30, 0],
    [84, 0],
  ]) {
    const f = fixture({ enabled: true, expiration_days: 30, notify_before_days: 7 }, age);
    let sent = 0;
    assert.equal(
      await deliverAutomatedMessages(100, {
        ...f.deps,
        now: () => now,
        sendPush: async () => {
          sent += 1;
          return { attempted: 1, delivered: 1 };
        },
      }),
      expectedSent,
    );
    assert.equal(sent, expectedSent);
    assert.equal(f.updates[0].status, expectedSent ? 'sent' : 'skipped');
  }
});

test('failed bonus activity lookup retries a queued warning without sending', async () => {
  const f = fixture({ enabled: true, expiration_days: 30, notify_before_days: 7 });
  f.db.rpc = async () => ({ error: new Error('activity unavailable') });
  let sent = 0;
  assert.equal(
    await deliverAutomatedMessages(100, {
      ...f.deps,
      now: () => now,
      sendPush: async () => {
        sent += 1;
      },
    }),
    0,
  );
  assert.equal(sent, 0);
  assert.equal(f.updates[0].status, 'pending');
});

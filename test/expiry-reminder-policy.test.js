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

test('legacy inactivity warnings never queue whole-balance expiry notices', async () => {
  for (const policy of [
    { enabled: true, expiration_days: 90, notify_before_days: 30 },
    { enabled: true, expiration_months: 6, notify_days: [30, 15, 7] },
    { enabled: false },
  ]) {
    const f = fixture(policy, 84);
    assert.equal(await enqueueAutomatedMessages(f.deps), 0);
    assert.deepEqual(f.queued, []);
    assert.equal(f.reads.includes('customers'), false);
  }
});

test('legacy pending expiry warnings are retired before reading or pushing a customer', async () => {
  const f = fixture({ enabled: true, expiration_months: 6, notify_days: [30, 15, 7] });
  let sent = 0;
  assert.equal(
    await deliverAutomatedMessages(100, {
      db: f.db,
      now: () => now,
      sendPush: async () => {
        sent += 1;
      },
    }),
    0,
  );
  assert.equal(sent, 0);
  assert.equal(f.updates[0].status, 'skipped');
  assert.match(f.updates[0].error, /dated bonus expiry/);
  assert.equal(f.reads.includes('customers'), false);
});

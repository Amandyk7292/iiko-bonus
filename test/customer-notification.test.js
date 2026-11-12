const assert = require('node:assert/strict');
const test = require('node:test');
const { saveCustomerNotification } = require('../src/services/customer-notification.service');

function stubDatabase(responses) {
  const attempts = [];
  return {
    attempts,
    from(table) {
      assert.equal(table, 'customer_notifications');
      return {
        upsert(record, options) {
          assert.deepEqual(options, { onConflict: 'id', ignoreDuplicates: true });
          attempts.push(record);
          return {
            async abortSignal(signal) {
              assert.ok(signal instanceof AbortSignal);
              return responses.shift();
            },
          };
        },
      };
    },
  };
}

test('retries a lost notification response without duplicating the inbox row', async () => {
  const db = stubDatabase([
    { error: { code: '' }, status: 0 },
    { error: null, status: 201 },
  ]);
  const id = await saveCustomerNotification({ type: 'order', title: 'Ready' }, { db });

  assert.ok(id);
  assert.equal(db.attempts.length, 2);
  assert.equal(db.attempts[0].id, id);
  assert.equal(db.attempts[1].id, id);
});

test('logs a rejected notification insert and returns no inbox ID', async (t) => {
  const db = stubDatabase([{ error: { code: '23503' }, status: 409 }]);
  const log = t.mock.method(console, 'error', () => {});

  assert.equal(await saveCustomerNotification({ type: 'bonus' }, { db }), '');
  assert.equal(db.attempts.length, 1);
  assert.equal(log.mock.callCount(), 1);
});

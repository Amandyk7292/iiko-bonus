const test = require('node:test');
const assert = require('node:assert/strict');
const { publishWalkingRewardEvents } = require('../src/services/walking-reward-events.service');

test('only newly committed daily rewards invalidate the correct customer and global admin histories', () => {
  const events = [];
  const publish = (...event) => events.push(event);
  publishWalkingRewardEvents(
    'customer',
    {
      days: [
        { date: '2026-10-06', credited: true },
        { date: '2026-10-07', credited: false, rewarded: true },
      ],
    },
    publish,
  );
  assert.deepEqual(events, [
    [
      'transaction.created',
      {
        customerId: 'customer',
        type: 'deposit',
        amount: 1000,
        source: 'walking',
        date: '2026-10-06',
      },
      { customerId: 'customer', includeAdmins: true, roles: ['owner', 'admin'] },
    ],
    ['notification.created', {}, { customerId: 'customer' }],
  ]);
  publishWalkingRewardEvents('customer', { credited: false, rewarded: true }, publish);
  assert.equal(events.length, 2);
});

test('each recovered Android day invalidates its history once while refreshing the inbox once', () => {
  const events = [];
  publishWalkingRewardEvents(
    'customer',
    {
      days: [
        { date: '2026-10-06', credited: true },
        { date: '2026-10-07', credited: true },
      ],
    },
    (...event) => events.push(event),
  );
  assert.equal(events.filter(([type]) => type === 'transaction.created').length, 2);
  assert.equal(events.filter(([type]) => type === 'notification.created').length, 1);
});

test('a failed realtime listener cannot turn an accepted reward into a measurement failure', () => {
  const errors = [];
  const saved = console.error;
  console.error = (value) => errors.push(value);
  try {
    assert.doesNotThrow(() =>
      publishWalkingRewardEvents('customer', { credited: true }, () => {
        throw new Error('Subscriber unavailable');
      }),
    );
    assert.equal(errors.length, 2);
  } finally {
    console.error = saved;
  }
});

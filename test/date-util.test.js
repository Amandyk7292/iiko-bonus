const assert = require('node:assert/strict');
const test = require('node:test');

const { localDateBoundaryIso, timezoneOffsetMinutes } = require('../src/utils/date.util');

test('local date boundaries use the Astana UTC+5 business day', () => {
  const env = { ORDER_TIMEZONE_OFFSET_MINUTES: '300' };
  assert.equal(localDateBoundaryIso('2026-07-23', { env }), '2026-07-22T19:00:00.000Z');
  assert.equal(
    localDateBoundaryIso('2026-07-23', { env, nextDay: true }),
    '2026-07-23T19:00:00.000Z',
  );
});

test('local date boundary rejects invalid dates and unsafe offsets', () => {
  assert.equal(localDateBoundaryIso('2026-02-30'), null);
  assert.equal(timezoneOffsetMinutes({ ORDER_TIMEZONE_OFFSET_MINUTES: '9999' }), 300);
});

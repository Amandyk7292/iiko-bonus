const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSchedule } = require('../src/services/checkout.service');

async function fixture(run) {
  const configPath = require.resolve('../src/config/supabase');
  const servicePath = require.resolve('../src/services/slot.service');
  const saved = [require.cache[configPath], require.cache[servicePath]];
  const previousEnv = { ...process.env };
  Object.assign(process.env, {
    ORDER_TIMEZONE_OFFSET_MINUTES: '300',
    ORDER_MIN_LEAD_MINUTES: '10',
    PREORDER_MIN_LEAD_MINUTES: '1440',
  });
  const location = {
    id: 'branch',
    active: true,
    pickup_enabled: true,
    delivery_enabled: true,
    preorder_enabled: true,
    slot_minutes: 60,
    pickup_slot_capacity: 2,
    delivery_slot_capacity: 2,
    preorder_slot_capacity: 2,
    hours: { daily: { open: '08:00', close: '23:30' } },
  };
  const reservations = [];
  const database = {
    from(table) {
      return {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        gte() {
          return this;
        },
        lt() {
          return this;
        },
        maybeSingle: async () => ({ data: structuredClone(location), error: null }),
        in: async () => {
          assert.equal(table, 'fulfillment_slot_reservations');
          return { data: reservations, error: null };
        },
      };
    },
  };
  require.cache[configPath] = {
    id: configPath,
    filename: configPath,
    loaded: true,
    exports: { supabase: database },
  };
  delete require.cache[servicePath];
  const now = new Date('2026-09-10T17:03:00Z'); // 22:03 in Aktau.
  try {
    const service = require(servicePath);
    await run({
      location,
      reservations,
      now,
      list: (options = {}) =>
        service.listAvailableSlots({
          branchId: 'branch',
          orderType: 'pickup',
          days: 1,
          now,
          ...options,
        }),
    });
  } finally {
    for (const [index, path] of [configPath, servicePath].entries()) {
      if (saved[index]) require.cache[path] = saved[index];
      else delete require.cache[path];
    }
    for (const name of [
      'ORDER_TIMEZONE_OFFSET_MINUTES',
      'ORDER_MIN_LEAD_MINUTES',
      'PREORDER_MIN_LEAD_MINUTES',
    ]) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
  }
}

test('22:03 checkout exposes 23:00–23:30 and payment accepts that final partial hour', async () =>
  fixture(async ({ list, location, now }) => {
    const { slots } = await list();
    assert.deepEqual(slots, [
      {
        startsAt: '2026-09-10T17:15:00.000Z',
        endsAt: '2026-09-10T18:00:00.000Z',
        capacity: 2,
        remaining: 2,
      },
      {
        startsAt: '2026-09-10T18:00:00.000Z',
        endsAt: '2026-09-10T18:30:00.000Z',
        capacity: 2,
        remaining: 2,
      },
    ]);
    assert.equal(
      normalizeSchedule(slots.at(-1).startsAt, 'pickup', now, process.env, location.hours, 60),
      slots.at(-1).startsAt,
    );
    for (const time of ['23:15', '23:30', '23:59']) {
      assert.throws(
        () =>
          normalizeSchedule(
            `2026-09-10T${time}:00+05:00`,
            'pickup',
            now,
            process.env,
            location.hours,
            60,
          ),
        /доступное время/,
      );
    }
  }));

test('saved closing-hour changes affect the very next slot request', async () =>
  fixture(async ({ list, location }) => {
    const late = () => list({ now: new Date('2026-09-10T18:08:00Z') });
    location.hours.daily.close = '23:00';
    assert.equal((await late()).slots.length, 0);
    location.hours.daily.close = '23:30';
    assert.equal((await late()).slots[0].endsAt, '2026-09-10T18:30:00.000Z');
    location.hours.daily.close = '24:00';
    assert.equal((await late()).slots[0].endsAt, '2026-09-10T19:00:00.000Z');
  }));

test('partial intervals retain capacity limits and ignore expired holds', async () =>
  fixture(async ({ list, reservations }) => {
    const late = () => list({ now: new Date('2026-09-10T18:08:00Z') });
    const scheduled_at = '2026-09-10T18:00:00Z';
    reservations.push(
      { scheduled_at, status: 'committed' },
      {
        scheduled_at: '2026-09-10T18:05:00Z',
        status: 'active',
        expires_at: '2026-09-10T18:30:00Z',
      },
    );
    assert.equal((await late()).slots.length, 0);
    reservations[1].expires_at = '2026-09-10T17:00:00Z';
    assert.equal((await late()).slots[0].remaining, 1);
  }));

test('closing boundaries preserve lead time, disabled days and preorder 24-hour rule', async () =>
  fixture(async ({ list, now, location }) => {
    const tooLate = await list({ now: new Date('2026-09-10T18:21:00Z') });
    assert.equal(tooLate.slots.length, 0);
    assert.equal(tooLate.unavailableReason, 'closing_soon');
    const preorder = await list({ orderType: 'preorder', days: 2 });
    assert.ok(preorder.slots.length > 0);
    for (const slot of preorder.slots) {
      assert.ok(Date.parse(slot.startsAt) - now.getTime() >= 86400000);
      assert.equal(
        normalizeSchedule(slot.startsAt, 'preorder', now, process.env, location.hours, 60),
        slot.startsAt,
      );
    }
    location.hours.thu = { closed: true };
    assert.equal((await list()).slots.length, 0);
  }));

test('23:08 offers remaining 23:20–23:30 for both 30 and 60-minute intervals', async () =>
  fixture(async ({ list, location }) => {
    const now = new Date('2026-09-10T18:08:00Z');
    for (const interval of [30, 60]) {
      location.slot_minutes = interval;
      const result = await list({ now });
      assert.equal(result.slots.length, 1);
      assert.equal(result.slots[0].startsAt, '2026-09-10T18:20:00.000Z');
      assert.equal(result.slots[0].endsAt, '2026-09-10T18:30:00.000Z');
      normalizeSchedule(
        result.slots[0].startsAt,
        'pickup',
        now,
        process.env,
        location.hours,
        interval,
      );
      assert.throws(() =>
        normalizeSchedule(
          '2026-09-10T18:19:00Z',
          'pickup',
          now,
          process.env,
          location.hours,
          interval,
        ),
      );
    }
  }));

test('08:00–02:00 includes the following midnight and validates every offered time', async () =>
  fixture(async ({ list, location }) => {
    location.hours.daily.close = '02:00';
    location.slot_minutes = 30;
    const now = new Date('2026-09-10T18:08:00Z');
    const { slots } = await list({ now });
    assert.ok(slots.some((slot) => slot.startsAt === '2026-09-10T19:30:00.000Z'));
    assert.equal(slots.at(-1).endsAt, '2026-09-10T21:00:00.000Z');
    for (const slot of slots) {
      normalizeSchedule(slot.startsAt, 'pickup', now, process.env, location.hours, 30);
    }
    assert.throws(() =>
      normalizeSchedule('2026-09-10T21:00:00Z', 'pickup', now, process.env, location.hours, 30),
    );
    assert.throws(() =>
      normalizeSchedule('2026-09-11T03:00:00Z', 'pickup', now, process.env, location.hours, 30),
    );
  }));

test('after midnight keeps yesterday night open even if the new opening day is disabled', async () =>
  fixture(async ({ list, location }) => {
    location.hours.daily.close = '02:00';
    location.hours.fri = { closed: true };
    const now = new Date('2026-09-10T19:08:00Z');
    const { slots } = await list({ now });
    assert.ok(slots.length > 0);
    assert.equal(slots.at(-1).endsAt, '2026-09-10T21:00:00.000Z');
    for (const slot of slots)
      normalizeSchedule(slot.startsAt, 'pickup', now, process.env, location.hours, 60);
    const closed = await list({ now: new Date('2026-09-10T21:00:00Z') });
    assert.equal(closed.slots.length, 0);
    assert.equal(closed.unavailableReason, 'closed');
  }));

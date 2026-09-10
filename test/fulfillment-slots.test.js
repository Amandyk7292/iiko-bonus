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
        startsAt: '2026-09-10T18:00:00.000Z',
        endsAt: '2026-09-10T18:30:00.000Z',
        capacity: 2,
        remaining: 2,
      },
    ]);
    assert.equal(
      normalizeSchedule(slots[0].startsAt, 'pickup', now, process.env, location.hours, 60),
      slots[0].startsAt,
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
    location.hours.daily.close = '23:00';
    assert.equal((await list()).slots.length, 0);
    location.hours.daily.close = '23:30';
    assert.equal((await list()).slots[0].endsAt, '2026-09-10T18:30:00.000Z');
    location.hours.daily.close = '24:00';
    assert.equal((await list()).slots[0].endsAt, '2026-09-10T19:00:00.000Z');
  }));

test('partial intervals retain capacity limits and ignore expired holds', async () =>
  fixture(async ({ list, reservations }) => {
    const scheduled_at = '2026-09-10T18:00:00Z';
    reservations.push(
      { scheduled_at, status: 'committed' },
      { scheduled_at, status: 'active', expires_at: '2026-09-10T18:00:00Z' },
    );
    assert.equal((await list()).slots.length, 0);
    reservations[1].expires_at = '2026-09-10T17:00:00Z';
    assert.equal((await list()).slots[0].remaining, 1);
  }));

test('closing boundaries preserve lead time, disabled days and preorder 24-hour rule', async () =>
  fixture(async ({ list, now, location }) => {
    assert.equal((await list({ now: new Date('2026-09-10T17:51:00Z') })).slots.length, 0);
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

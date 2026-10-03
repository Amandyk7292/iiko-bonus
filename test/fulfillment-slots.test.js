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
    async rpc(name, args) {
      assert.equal(name, 'fulfillment_slot_usage');
      const used = new Map();
      for (const reservation of reservations) {
        if (args.p_exclude_request && reservation.client_request_id === args.p_exclude_request)
          continue;
        if (
          reservation.status === 'active' &&
          Date.parse(reservation.expires_at) <= Date.parse(args.p_now)
        )
          continue;
        const instant = Date.parse(reservation.scheduled_at);
        if (instant < Date.parse(args.p_from) || instant >= Date.parse(args.p_to)) continue;
        const local = new Date(instant + args.p_offset * 60000);
        const day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
        const bucket = new Date(
          day +
            Math.floor((local.getUTCHours() * 60 + local.getUTCMinutes()) / args.p_minutes) *
              args.p_minutes *
              60000 -
            args.p_offset * 60000,
        ).toISOString();
        used.set(bucket, (used.get(bucket) || 0) + 1);
      }
      return { data: [...used].map(([startsAt, used]) => ({ startsAt, used })), error: null };
    },
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

test('changed slot interval counts every existing reservation inside the new bucket', async () =>
  fixture(async ({ list, location, reservations }) => {
    location.slot_minutes = 60;
    reservations.push(
      { scheduled_at: '2026-09-10T18:00:00Z', status: 'committed' },
      { scheduled_at: '2026-09-10T18:30:00Z', status: 'committed' },
    );
    assert.equal((await list()).slots.length, 0);
    location.slot_minutes = 30;
    assert.deepEqual(
      (await list()).slots.map((slot) => slot.remaining),
      [2, 1],
    );
  }));

test('all supported intervals agree with checkout for ordinary, overnight and 24/7 grids', async () =>
  fixture(async ({ list, location, now }) => {
    for (let interval = 15; interval <= 240; interval++) {
      location.slot_minutes = interval;
      for (const [hours, roundTheClock] of [
        [{ daily: { open: '08:00', close: '23:30' } }, false],
        [{ thu: { open: '22:00', close: '02:30' }, fri: { closed: true } }, false],
        [{ daily: { open: '00:00', close: '24:00' } }, true],
      ]) {
        location.hours = hours;
        location.round_the_clock = roundTheClock;
        const { slots } = await list({ horizonHours: 24 });
        for (const slot of slots) {
          // Preorder allows the overnight continuation date while testing the
          // identical hours/grid validator used by checkout.
          assert.equal(
            normalizeSchedule(
              slot.startsAt,
              'preorder',
              new Date(now.getTime() - 86400000),
              process.env,
              hours,
              interval,
              roundTheClock,
            ),
            slot.startsAt,
            `${interval} min ${slot.startsAt}`,
          );
          const start = new Date(Date.parse(slot.startsAt) + 300 * 60000);
          const midnight =
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 1) -
            300 * 60000;
          assert.ok(Date.parse(slot.endsAt) <= midnight, `${interval} min crosses midnight`);
          assert.ok(Date.parse(slot.endsAt) > Date.parse(slot.startsAt));
          assert.equal((start.getUTCHours() * 60 + start.getUTCMinutes()) % interval, 0);
        }
      }
    }
  }));
test('replacement pickup uses a rolling 24h horizon for ordinary schedules and excludes its own held slot', async () =>
  fixture(async ({ list, reservations, now }) => {
    const result = await list({ horizonHours: 24 });
    assert.ok(result.slots.some((slot) => slot.startsAt === '2026-09-11T03:00:00.000Z'));
    assert.ok(result.slots.every((slot) => Date.parse(slot.startsAt) <= now.getTime() + 86400000));
    assert.ok(!result.slots.some((slot) => slot.startsAt === '2026-09-11T18:00:00.000Z'));
    reservations.push(
      ...[1, 2].map(() => ({
        scheduled_at: '2026-09-11T03:00:00.000Z',
        status: 'committed',
        client_request_id: 'replacement',
      })),
    );
    assert.ok(
      !(await list({ horizonHours: 24 })).slots.some(
        (slot) => slot.startsAt === '2026-09-11T03:00:00.000Z',
      ),
    );
    assert.ok(
      (await list({ horizonHours: 24, excludeRequestId: 'replacement' })).slots.some(
        (slot) => slot.startsAt === '2026-09-11T03:00:00.000Z',
      ),
    );
  }));

test('replacement next 24h includes overnight continuation and honors tomorrow closing', async () =>
  fixture(async ({ list, location, now }) => {
    location.hours = { thu: { open: '22:00', close: '02:30' }, fri: { closed: true } };
    const { slots } = await list({ horizonHours: 24 });
    assert.deepEqual(
      slots.map((slot) => slot.startsAt),
      [
        '2026-09-10T18:00:00.000Z',
        '2026-09-10T19:00:00.000Z',
        '2026-09-10T20:00:00.000Z',
        '2026-09-10T21:00:00.000Z',
      ],
    );
    assert.ok(slots.every((slot) => Date.parse(slot.startsAt) > now.getTime()));
    assert.equal(slots.at(-1).endsAt, '2026-09-10T21:30:00.000Z');
  }));

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

test('overnight hours expose midnight slots and checkout accepts them', async () =>
  fixture(async ({ list, location, now, reservations }) => {
    location.hours.daily.close = '02:00';
    const { slots } = await list();
    assert.equal(slots.length, 3);
    assert.equal(slots[2].startsAt, '2026-09-10T20:00:00.000Z');
    for (const slot of slots)
      assert.equal(
        normalizeSchedule(slot.startsAt, 'pickup', now, process.env, location.hours, 60),
        slot.startsAt,
      );
    assert.throws(() =>
      normalizeSchedule(
        '2026-09-11T02:00:00+05:00',
        'pickup',
        now,
        process.env,
        location.hours,
        60,
      ),
    );
    reservations.push(
      { scheduled_at: slots[2].startsAt, status: 'committed' },
      { scheduled_at: slots[2].startsAt, status: 'committed' },
    );
    assert.equal((await list()).slots.length, 2);
    location.hours = { thu: { open: '08:00', close: '02:00' }, fri: { closed: true } };
    const afterMidnight = new Date('2026-09-10T19:10:00Z');
    assert.equal((await list({ now: afterMidnight })).slots.length, 0); // 01:00 is full.
    reservations.length = 0;
    const continuation = (await list({ now: afterMidnight })).slots;
    assert.equal(continuation.length, 1);
    assert.equal(
      normalizeSchedule(
        continuation[0].startsAt,
        'delivery',
        afterMidnight,
        process.env,
        location.hours,
        60,
      ),
      continuation[0].startsAt,
    );
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

test('24/7 pickup and delivery cross midnight with a rolling 24-hour horizon and capacity checks', async () =>
  fixture(async ({ list, location, reservations }) => {
    const now = new Date('2026-12-31T18:50:00Z'); // 23:50 in Kazakhstan.
    assert.equal((await list({ now })).slots.length, 0);
    location.round_the_clock = true;
    const hours = { daily: { open: '00:00', close: '24:00' } };
    for (const orderType of ['pickup', 'delivery']) {
      const { slots } = await list({ now, orderType });
      assert.equal(slots[0].startsAt, '2026-12-31T19:00:00.000Z');
      assert.equal(slots.length, 24);
      for (const slot of slots) {
        assert.ok(Date.parse(slot.startsAt) - now.getTime() <= 86400000);
        assert.equal(
          normalizeSchedule(slot.startsAt, orderType, now, process.env, hours, 60, true),
          slot.startsAt,
        );
      }
      assert.throws(
        () =>
          normalizeSchedule(
            '2027-01-02T00:00:00+05:00',
            orderType,
            now,
            process.env,
            hours,
            60,
            true,
          ),
        /24 часа/,
      );
      assert.throws(
        () => normalizeSchedule(slots[0].startsAt, orderType, now, process.env, location.hours, 60),
        /сегодня/,
      );
      reservations.push({ scheduled_at: slots[0].startsAt, status: 'committed' });
      assert.equal((await list({ now, orderType })).slots[0].remaining, 1);
      reservations.length = 0;
    }
    const afterMidnight = new Date('2026-12-31T19:10:00Z');
    assert.equal(
      (await list({ now: afterMidnight })).slots[0].startsAt,
      '2026-12-31T20:00:00.000Z',
    );
    location.delivery_enabled = false;
    await assert.rejects(list({ now, orderType: 'delivery' }), /временно недоступен/);
    location.round_the_clock = false;
    assert.equal((await list({ now })).slots.length, 0);
  }));

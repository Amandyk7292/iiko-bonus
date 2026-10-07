const test = require('node:test');
const assert = require('node:assert/strict');
const { validateCheckout } = require('../src/services/checkout.service');
const { resolveCheckout } = require('../src/services/delivery-branch.service');

const NEAR = '11111111-1111-4111-8111-111111111111';
const NEXT = '22222222-2222-4222-8222-222222222222';
const FAR = '33333333-3333-4333-8333-333333333333';
const PRODUCT = '44444444-4444-4444-8444-444444444444';
const REQUEST = '55555555-5555-4555-8555-555555555555';
const NOW = new Date('2026-10-07T06:15:00.000Z');
const SELECTED = '2026-10-07T07:00:00.000Z';
const LATER = '2026-10-07T08:00:00.000Z';
const ENV = { ORDER_TIMEZONE_OFFSET_MINUTES: '300', ORDER_MIN_LEAD_MINUTES: '10' };
const ADDRESS = {
  city: 'Актау',
  address: '12 микрорайон, 1',
  latitude: 43.65,
  longitude: 51.2,
};

function branch(id, latitude, overrides = {}) {
  return {
    id,
    name: `Филиал ${id[0]}`,
    address: `${id[0]} микрорайон, 1`,
    latitude,
    longitude: 51.2,
    active: true,
    deliveryEnabled: true,
    pickupEnabled: true,
    preorderEnabled: true,
    slotMinutes: 60,
    hours: { daily: { open: '08:00', close: '21:00' } },
    ...overrides,
  };
}

function cities(points = [branch(NEAR, 43.65), branch(NEXT, 43.66)]) {
  return [{ id: 'aktau', name: 'Актау', points }];
}

function payload(overrides = {}) {
  return {
    orderType: 'delivery',
    branchId: FAR,
    scheduledAt: SELECTED,
    deliveryAddress: { ...ADDRESS },
    items: [{ id: PRODUCT, quantity: 1 }],
    ...overrides,
  };
}

function slot(startsAt = SELECTED, remaining = 1) {
  return {
    startsAt,
    endsAt: new Date(Date.parse(startsAt) + 3600000).toISOString(),
    capacity: 2,
    remaining,
  };
}

function slotsFor(availability, calls = []) {
  return async (options) => {
    calls.push(options);
    return {
      branchId: options.branchId,
      orderType: 'delivery',
      slots: availability[options.branchId] || [],
    };
  };
}

const options = (listSlots, overrides = {}) => ({ now: NOW, env: ENV, listSlots, ...overrides });

test('delivery skips a nearer branch closed at the selected time', async () => {
  const points = [
    branch(NEAR, 43.65, { hours: { daily: { open: '08:00', close: '11:00' } } }),
    branch(NEXT, 43.66),
  ];
  const result = await resolveCheckout(
    payload(),
    cities(points),
    options(slotsFor({ [NEXT]: [slot()] })),
  );
  assert.equal(result.branchId, NEXT);
  assert.equal(result.scheduledAt, SELECTED);
  assert.equal(result.deliveryOrigin.address, points[1].address);
  assert.ok(result.deliveryDistanceKm > 0);
});

test('delivery chooses the nearest branch with capacity at the exact selected time', async () => {
  const calls = [];
  const result = await resolveCheckout(
    payload(),
    cities([branch(FAR, 43.67), branch(NEXT, 43.66), branch(NEAR, 43.65)]),
    options(slotsFor({ [NEAR]: [slot(LATER)], [NEXT]: [slot()], [FAR]: [slot()] }, calls)),
  );
  assert.equal(result.branchId, NEXT);
  assert.equal(result.scheduledAt, SELECTED);
  assert.deepEqual(
    calls.map((call) => call.branchId),
    [NEAR, NEXT],
  );
});

test('a zero-capacity selected slot does not prevent trying the next branch', async () => {
  const result = await resolveCheckout(
    payload(),
    cities(),
    options(slotsFor({ [NEAR]: [slot(SELECTED, 0)], [NEXT]: [slot()] })),
  );
  assert.equal(result.branchId, NEXT);
});

test('ASAP delivery chooses the nearest eligible branch and its earliest live slot', async () => {
  const calls = [];
  const result = await resolveCheckout(
    payload({ scheduledAt: null }),
    cities(),
    options(slotsFor({ [NEAR]: [slot(LATER), slot()], [NEXT]: [slot()] }, calls)),
  );
  assert.equal(result.branchId, NEAR);
  assert.equal(result.scheduledAt, SELECTED);
  assert.deepEqual(
    calls.map((call) => call.branchId),
    [NEAR],
  );
  assert.equal(calls[0].horizonHours, null);
});

test('ASAP delivery tries the next branch when the nearest has no live slots', async () => {
  const calls = [];
  const result = await resolveCheckout(
    payload({ scheduledAt: null }),
    cities(),
    options(slotsFor({ [NEAR]: [], [NEXT]: [slot(LATER)] }, calls)),
  );
  assert.equal(result.branchId, NEXT);
  assert.equal(result.scheduledAt, LATER);
  assert.ok(calls.every((call) => call.horizonHours === null));
});

test('ASAP uses the ordinary branch horizon and tries another branch with time today', async () => {
  const calls = [];
  const points = [
    branch(NEAR, 43.65, { hours: { daily: { open: '08:00', close: '11:00' } } }),
    branch(NEXT, 43.66),
  ];
  const result = await resolveCheckout(
    payload({ scheduledAt: null }),
    cities(points),
    options(async (args) => {
      calls.push(args.branchId);
      assert.equal(args.horizonHours, null);
      return { slots: args.branchId === NEAR ? [] : [slot()] };
    }),
  );
  assert.deepEqual(calls, [NEAR, NEXT]);
  assert.equal(result.branchId, NEXT);
  assert.equal(result.scheduledAt, SELECTED);
});

test('ASAP payment retains its quoted time when an earlier slot becomes available', async () => {
  const result = await resolveCheckout(
    payload({ scheduledAt: null }),
    cities(),
    options(slotsFor({ [NEAR]: [slot(), slot(LATER)], [NEXT]: [slot()] }), {
      preferredBranchId: NEAR,
      preferredScheduledAt: LATER,
    }),
  );
  assert.equal(result.branchId, NEAR);
  assert.equal(result.scheduledAt, LATER);
});

test('ASAP payment requires a new quote when its quoted time loses capacity', async () => {
  const calls = [];
  await assert.rejects(
    resolveCheckout(
      payload({ scheduledAt: null }),
      cities(),
      options(slotsFor({ [NEAR]: [slot()], [NEXT]: [slot(LATER)] }, calls), {
        preferredBranchId: NEAR,
        preferredScheduledAt: LATER,
      }),
    ),
    { statusCode: 409, code: 'CHECKOUT_QUOTE_CHANGED' },
  );
  assert.deepEqual(
    calls.map((call) => call.branchId),
    [NEAR],
  );
});

test('payment requires a new quote when the quoted time falls inside the minimum lead', async () => {
  const afterLeadCutoff = new Date('2026-10-07T06:55:00.000Z');
  await assert.rejects(
    resolveCheckout(
      payload({ scheduledAt: null }),
      cities(),
      options(slotsFor({ [NEAR]: [slot()] }), {
        now: afterLeadCutoff,
        preferredBranchId: NEAR,
        preferredScheduledAt: SELECTED,
      }),
    ),
    { statusCode: 409, code: 'CHECKOUT_QUOTE_CHANGED' },
  );
});

test('payment preserves a bad-input response for a malformed additional phone', async () => {
  await assert.rejects(
    resolveCheckout(
      payload({ additionalPhone: '123' }),
      cities(),
      options(slotsFor({ [NEAR]: [slot()] }), {
        preferredBranchId: NEAR,
        preferredScheduledAt: SELECTED,
      }),
    ),
    (error) => {
      assert.equal(error.statusCode, 400);
      assert.notEqual(error.code, 'CHECKOUT_QUOTE_CHANGED');
      assert.match(error.message, /дополнительный номер/);
      return true;
    },
  );
});

test('delivery reports unavailable when every branch lacks the selected time', async () => {
  await assert.rejects(
    resolveCheckout(payload(), cities(), options(slotsFor({ [NEAR]: [slot(LATER)], [NEXT]: [] }))),
    { statusCode: 409, code: 'CHECKOUT_DELIVERY_SLOT_UNAVAILABLE' },
  );
});

test('delivery filters inactive, disabled, missing-coordinate, and other-city branches', async () => {
  const calls = [];
  const local = cities([
    branch(NEAR, 43.65, { active: false }),
    branch(NEXT, 43.65, { deliveryEnabled: false }),
    branch('66666666-6666-4666-8666-666666666666', null),
    branch(FAR, 43.67),
  ]);
  local.push({
    id: 'atyrau',
    name: 'Атырау',
    points: [branch('77777777-7777-4777-8777-777777777777', 43.65)],
  });
  const result = await resolveCheckout(
    payload(),
    local,
    options(async (args) => {
      calls.push(args);
      return { slots: [slot()] };
    }),
  );
  assert.equal(result.branchId, FAR);
  assert.deepEqual(
    calls.map((call) => call.branchId),
    [FAR],
  );
});

test('delivery passes product timing and its existing request hold to live slot lookup', async () => {
  const calls = [];
  await resolveCheckout(
    payload(),
    cities(),
    options(slotsFor({ [NEAR]: [slot()] }, calls), { excludeRequestId: REQUEST }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].orderType, 'delivery');
  assert.deepEqual(calls[0].productIds, [PRODUCT]);
  assert.equal(calls[0].now, NOW);
  assert.equal(calls[0].env, ENV);
  assert.equal(calls[0].excludeRequestId, REQUEST);
});

test('slot database failures propagate instead of changing the branch', async () => {
  const failure = new Error('slot usage database unavailable');
  const calls = [];
  await assert.rejects(
    resolveCheckout(
      payload(),
      cities(),
      options(async (args) => {
        calls.push(args.branchId);
        throw failure;
      }),
    ),
    (error) => error === failure,
  );
  assert.deepEqual(calls, [NEAR]);
});

test('delivery tries the next branch when live lookup finds the nearest branch newly disabled', async () => {
  const calls = [];
  const result = await resolveCheckout(
    payload(),
    cities(),
    options(async (args) => {
      calls.push(args.branchId);
      if (args.branchId === NEAR) {
        throw Object.assign(new Error('branch was disabled'), {
          code: 'CHECKOUT_BRANCH_UNAVAILABLE',
        });
      }
      return { slots: [slot()] };
    }),
  );
  assert.equal(result.branchId, NEXT);
  assert.deepEqual(calls, [NEAR, NEXT]);
});

test('payment resolution retains the signed quote branch even when a closer branch is available', async () => {
  const calls = [];
  const result = await resolveCheckout(
    payload(),
    cities(),
    options(slotsFor({ [NEAR]: [slot()], [NEXT]: [slot()] }, calls), { preferredBranchId: NEXT }),
  );
  assert.equal(result.branchId, NEXT);
  assert.deepEqual(
    calls.map((call) => call.branchId),
    [NEXT],
  );
});

test('payment requires a new quote when the signed branch loses capacity', async () => {
  const calls = [];
  await assert.rejects(
    resolveCheckout(
      payload(),
      cities(),
      options(slotsFor({ [NEAR]: [slot()], [NEXT]: [] }, calls), { preferredBranchId: NEXT }),
    ),
    { statusCode: 409, code: 'CHECKOUT_QUOTE_CHANGED' },
  );
  assert.deepEqual(
    calls.map((call) => call.branchId),
    [NEXT],
  );
});

test('payment requires a new quote when the signed branch is no longer eligible', async () => {
  let queried = false;
  await assert.rejects(
    resolveCheckout(
      payload(),
      cities([branch(NEAR, 43.65), branch(NEXT, 43.66, { deliveryEnabled: false })]),
      options(
        async () => {
          queried = true;
          return { slots: [slot()] };
        },
        { preferredBranchId: NEXT },
      ),
    ),
    { statusCode: 409, code: 'CHECKOUT_QUOTE_CHANGED' },
  );
  assert.equal(queried, false);
});

test('payment requires a new quote when live lookup finds its quoted branch newly disabled', async () => {
  const calls = [];
  await assert.rejects(
    resolveCheckout(
      payload(),
      cities(),
      options(
        async (args) => {
          calls.push(args.branchId);
          throw Object.assign(new Error('branch was disabled'), {
            code: 'CHECKOUT_BRANCH_UNAVAILABLE',
          });
        },
        { preferredBranchId: NEXT },
      ),
    ),
    { statusCode: 409, code: 'CHECKOUT_QUOTE_CHANGED' },
  );
  assert.deepEqual(calls, [NEXT]);
});

test('equal-distance delivery candidates use stable branch id order', async () => {
  const locationCities = cities([branch(NEXT, 43.65), branch(NEAR, 43.65)]);
  const listSlots = slotsFor({ [NEAR]: [slot()], [NEXT]: [slot()] });
  const checkout = await resolveCheckout(payload(), locationCities, options(listSlots));
  assert.equal(checkout.branchId, NEAR);
});

test('pickup retains normal validation and does not consult delivery slot capacity', async () => {
  const request = payload({ orderType: 'pickup', branchId: NEXT, deliveryAddress: null });
  const locationCities = cities();
  const expected = validateCheckout(request, locationCities, { now: NOW, env: ENV });
  const result = await resolveCheckout(
    request,
    locationCities,
    options(async () => {
      throw new Error('pickup must not invoke delivery slot lookup');
    }),
  );
  assert.deepEqual(result, expected);
});

const { supabase } = require('../config/supabase');
const { productScheduleBounds } = require('./product-options.service');
const { effectiveHours } = require('../utils/branch-schedule.util');

const slotError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

const parseClock = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour >= 0 && hour <= 24 && minute >= 0 && minute <= 59 && (hour < 24 || minute === 0)
    ? hour * 60 + minute
    : null;
};

const slotHorizonDays = (orderType, days) =>
  orderType === 'preorder' ? Math.min(14, Math.max(1, Number.parseInt(days, 10) || 7)) : 1;

const timezoneOffsetMinutes = (env = process.env) => {
  const offset = Number.parseInt(env.ORDER_TIMEZONE_OFFSET_MINUTES || '300', 10);
  return Number.isInteger(offset) && Math.abs(offset) <= 840 ? offset : 300;
};

const capacityFor = (location, type) =>
  Number(
    type === 'preorder'
      ? location.preorder_slot_capacity
      : type === 'delivery'
        ? location.delivery_slot_capacity
        : location.pickup_slot_capacity,
  );

async function listAvailableSlots({
  branchId,
  orderType,
  days = 7,
  productIds = [],
  now = new Date(),
  horizonHours = null,
  db = supabase,
  excludeRequestId = null,
  env = process.env,
}) {
  if (!['pickup', 'delivery', 'preorder'].includes(orderType)) {
    throw slotError('Некорректный способ получения заказа');
  }
  const productBounds = await productScheduleBounds(productIds, now);
  const { data: location, error } = await db
    .from('bulka_locations')
    .select(
      'id,hours,round_the_clock,active,pickup_enabled,preorder_enabled,delivery_enabled,slot_minutes,pickup_slot_capacity,preorder_slot_capacity,delivery_slot_capacity',
    )
    .eq('id', branchId)
    .maybeSingle();
  if (error) throw error;
  if (!location || location.active === false)
    throw Object.assign(slotError('Филиал больше недоступен', 404), {
      code: 'CHECKOUT_BRANCH_UNAVAILABLE',
    });
  const enabled =
    orderType === 'preorder'
      ? location.preorder_enabled
      : orderType === 'delivery'
        ? location.delivery_enabled
        : location.pickup_enabled;
  if (!enabled)
    throw Object.assign(slotError('Этот способ получения в филиале временно недоступен'), {
      code: 'CHECKOUT_BRANCH_UNAVAILABLE',
    });
  const rollingDay =
    (horizonHours === 24 || location.round_the_clock === true) && orderType !== 'preorder';
  const safeDays = rollingDay ? 2 : slotHorizonDays(orderType, days);
  const hours = effectiveHours(location);

  const safeOffset = timezoneOffsetMinutes(env);
  const localNow = new Date(now.getTime() + safeOffset * 60000);
  const startLocalDay =
    Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate()) +
    (orderType === 'preorder' ? Math.floor(productBounds.minimumHours / 24) * 86400000 : 0);
  const queryStart = new Date(startLocalDay - safeOffset * 60000).toISOString();
  const queryEnd = new Date(
    startLocalDay + (safeDays + 1) * 86400000 - safeOffset * 60000,
  ).toISOString();
  const interval = Number(location.slot_minutes || 60);
  const { data: reservations, error: reservationsError } = await db.rpc('fulfillment_slot_usage', {
    p_branch: branchId,
    p_type: orderType,
    p_from: queryStart,
    p_to: queryEnd,
    p_minutes: interval,
    p_offset: safeOffset,
    p_now: now.toISOString(),
    p_exclude_request: excludeRequestId,
  });
  if (reservationsError) throw reservationsError;

  const held = new Map();
  for (const reservation of reservations || []) {
    const key = new Date(reservation.startsAt).toISOString();
    held.set(key, Number(reservation.used));
  }

  const capacity = capacityFor(location, orderType);
  const lead = Number.parseInt(
    orderType === 'preorder'
      ? env.PREORDER_MIN_LEAD_MINUTES || '1440'
      : env.ORDER_MIN_LEAD_MINUTES || '10',
    10,
  );
  const floor = orderType === 'preorder' ? 1440 : 0;
  const earliest =
    now.getTime() +
    Math.max(floor, Number.isFinite(lead) ? lead : 10, productBounds.minimumHours * 60) * 60000;
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const slots = [];

  const emitted = new Set();
  for (let dayOffset = -1; dayOffset < safeDays; dayOffset += 1) {
    const localDayMs = startLocalDay + dayOffset * 86400000;
    const localDay = new Date(localDayMs);
    const schedule = hours?.[dayKeys[localDay.getUTCDay()]] || hours?.daily;
    if (!schedule || schedule.closed === true) continue;
    const open = parseClock(schedule.open);
    let close = parseClock(schedule.close);
    if (open == null || close == null || open === close || open === 1440) continue;
    if (close < open) close += 1440;
    // Capacity buckets are anchored to each local midnight. An overnight
    // schedule continues, but an interval that does not divide 1440 resets its
    // grid at midnight, exactly as checkout and fulfillment_slot_bounds do.
    const segments =
      close > 1440
        ? [
            [open, 1440],
            [1440, close],
          ]
        : [[open, close]];
    for (const [segmentOpen, segmentClose] of segments) {
      const dayBase = Math.floor(segmentOpen / 1440) * 1440;
      const first = dayBase + Math.ceil((segmentOpen - dayBase) / interval) * interval;
      for (let minute = first; minute < segmentClose; minute += interval) {
        const instant = new Date(localDayMs + minute * 60000 - safeOffset * 60000);
        if (rollingDay && instant.getTime() > now.getTime() + 86400000) continue;
        if (instant.getTime() < earliest || instant.getTime() > productBounds.latest) continue;
        const key = instant.toISOString();
        if (instant.getTime() < new Date(queryStart).getTime() || emitted.has(key)) continue;
        const used = held.get(key) || 0;
        if (used >= capacity) continue;
        emitted.add(key);
        slots.push({
          startsAt: key,
          endsAt: new Date(
            localDayMs + Math.min(minute + interval, segmentClose) * 60000 - safeOffset * 60000,
          ).toISOString(),
          capacity,
          remaining: capacity - used,
        });
      }
    }
  }
  return {
    branchId: String(branchId),
    orderType,
    slotMinutes: interval,
    serverTime: now.toISOString(),
    timezoneOffsetMinutes: safeOffset,
    slots,
  };
}

module.exports = { listAvailableSlots, slotHorizonDays, timezoneOffsetMinutes };

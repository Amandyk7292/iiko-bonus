const { supabase } = require('../config/supabase');
const { MINUTE, DAY, dayStart, workingWindows, slotBucket } = require('./schedule-windows');

const slotError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });

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

async function listAvailableSlots({ branchId, orderType, days = 7, now = new Date() }) {
  if (!['pickup', 'delivery', 'preorder'].includes(orderType)) {
    throw slotError('Некорректный способ получения заказа');
  }
  const safeDays = slotHorizonDays(orderType, days);
  const { data: location, error } = await supabase
    .from('bulka_locations')
    .select(
      'id,hours,active,pickup_enabled,preorder_enabled,delivery_enabled,slot_minutes,pickup_slot_capacity,preorder_slot_capacity,delivery_slot_capacity',
    )
    .eq('id', branchId)
    .maybeSingle();
  if (error) throw error;
  if (!location || location.active === false) throw slotError('Филиал больше недоступен', 404);
  const enabled =
    orderType === 'preorder'
      ? location.preorder_enabled
      : orderType === 'delivery'
        ? location.delivery_enabled
        : location.pickup_enabled;
  if (!enabled) throw slotError('Этот способ получения в филиале временно недоступен');

  const safeOffset = timezoneOffsetMinutes();
  const localNow = new Date(now.getTime() + safeOffset * 60000);
  const startLocalDay = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );
  const queryStart = new Date(startLocalDay - safeOffset * 60000).toISOString();
  const windows = workingWindows(location.hours, startLocalDay, safeDays);
  const queryEnd = new Date(
    Math.max(startLocalDay + DAY, ...windows.map((window) => window.end)) - safeOffset * MINUTE,
  ).toISOString();
  const interval = Number(location.slot_minutes || 60);
  const { data: reservations, error: reservationsError } = await supabase
    .from('fulfillment_slot_reservations')
    .select('scheduled_at,status,expires_at')
    .eq('branch_id', branchId)
    .eq('fulfillment_type', orderType)
    .gte('scheduled_at', queryStart)
    .lt('scheduled_at', queryEnd)
    .in('status', ['active', 'committed']);
  if (reservationsError) throw reservationsError;

  const held = new Map();
  for (const reservation of reservations || []) {
    if (reservation.status === 'active' && new Date(reservation.expires_at) <= now) continue;
    const key = slotBucket(Date.parse(reservation.scheduled_at), interval, safeOffset);
    held.set(key, (held.get(key) || 0) + 1);
  }

  const capacity = capacityFor(location, orderType);
  const lead = Number.parseInt(
    orderType === 'preorder'
      ? process.env.PREORDER_MIN_LEAD_MINUTES || '1440'
      : process.env.ORDER_MIN_LEAD_MINUTES || '10',
    10,
  );
  const floor = orderType === 'preorder' ? 1440 : 0;
  const earliest = now.getTime() + Math.max(floor, Number.isFinite(lead) ? lead : 10) * 60000;
  const slots = [];
  const seen = new Set();
  for (const window of windows) {
    for (let day = dayStart(window.start); day < window.end; day += DAY) {
      const open = Math.max(window.start, day);
      const close = Math.min(window.end, day + DAY) - safeOffset * MINUTE;
      const first = day + Math.ceil((open - day) / (interval * MINUTE)) * interval * MINUTE;
      for (let bucket = first - safeOffset * MINUTE; bucket < close; bucket += interval * MINUTE) {
        const end = Math.min(bucket + interval * MINUTE, close);
        // Keep the capacity bucket stable while offering the remaining part of it.
        const start =
          orderType === 'preorder'
            ? bucket
            : Math.max(bucket, Math.ceil(earliest / (5 * MINUTE)) * 5 * MINUTE);
        if (start < earliest || start >= end || seen.has(start)) continue;
        const used = held.get(bucket) || 0;
        if (used >= capacity) continue;
        seen.add(start);
        slots.push({
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
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
    unavailableReason:
      slots.length || orderType === 'preorder'
        ? null
        : !windows.some((window) => window.end > localNow.getTime())
          ? 'closed'
          : !windows.some((window) => window.end > earliest + safeOffset * MINUTE)
            ? 'closing_soon'
            : 'full',
    slots,
  };
}

module.exports = { listAvailableSlots, slotHorizonDays, timezoneOffsetMinutes };

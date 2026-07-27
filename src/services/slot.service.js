const { supabase } = require('../config/supabase');

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

  const offsetMinutes = Number.parseInt(process.env.ORDER_TIMEZONE_OFFSET_MINUTES || '300', 10);
  const safeOffset =
    Number.isInteger(offsetMinutes) && Math.abs(offsetMinutes) <= 840 ? offsetMinutes : 300;
  const localNow = new Date(now.getTime() + safeOffset * 60000);
  const startLocalDay = Date.UTC(
    localNow.getUTCFullYear(),
    localNow.getUTCMonth(),
    localNow.getUTCDate(),
  );
  const queryStart = new Date(startLocalDay - safeOffset * 60000).toISOString();
  const queryEnd = new Date(startLocalDay + safeDays * 86400000 - safeOffset * 60000).toISOString();
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
    const key = new Date(reservation.scheduled_at).toISOString();
    held.set(key, (held.get(key) || 0) + 1);
  }

  const interval = Number(location.slot_minutes || 60);
  const capacity = capacityFor(location, orderType);
  const lead = Number.parseInt(
    orderType === 'preorder'
      ? process.env.PREORDER_MIN_LEAD_MINUTES || '120'
      : process.env.ORDER_MIN_LEAD_MINUTES || '10',
    10,
  );
  const earliest = now.getTime() + Math.max(0, lead) * 60000;
  const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
  const slots = [];

  for (let dayOffset = 0; dayOffset < safeDays; dayOffset += 1) {
    const localDayMs = startLocalDay + dayOffset * 86400000;
    const localDay = new Date(localDayMs);
    const schedule = location.hours?.[dayKeys[localDay.getUTCDay()]] || location.hours?.daily;
    if (!schedule || schedule.closed === true) continue;
    const open = parseClock(schedule.open);
    const close = parseClock(schedule.close);
    if (open == null || close == null || open >= close) continue;
    const first = Math.ceil(open / interval) * interval;
    for (let minute = first; minute + interval <= close; minute += interval) {
      const instant = new Date(localDayMs + minute * 60000 - safeOffset * 60000);
      if (instant.getTime() < earliest) continue;
      const key = instant.toISOString();
      const used = held.get(key) || 0;
      if (used >= capacity) continue;
      slots.push({
        startsAt: key,
        endsAt: new Date(instant.getTime() + interval * 60000).toISOString(),
        capacity,
        remaining: capacity - used,
      });
    }
  }
  return { branchId: String(branchId), orderType, slotMinutes: interval, slots };
}

module.exports = { listAvailableSlots, slotHorizonDays };

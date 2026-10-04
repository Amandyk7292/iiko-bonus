const REMINDER_TIMEZONE = 'Asia/Almaty';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: REMINDER_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function localTime(date) {
  const parts = Object.fromEntries(
    formatter.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
  };
}

function inactiveReminderTiming(data = {}, now = new Date()) {
  const expired = { state: 'expired' };
  if (data.reminderWindowVersion !== 'daytime-v1') return expired;
  const scheduledMs = Date.parse(data.reminderScheduledAt);
  const expiresMs = Date.parse(data.reminderExpiresAt);
  if (!Number.isFinite(scheduledMs) || !Number.isFinite(expiresMs)) return expired;
  const current = localTime(now);
  const scheduled = localTime(new Date(scheduledMs));
  const expires = localTime(new Date(expiresMs));
  if (
    current.date !== data.reminderDate ||
    scheduled.date !== current.date ||
    expires.date !== current.date ||
    scheduled.minutes < 11 * 60 ||
    scheduled.minutes >= 16 * 60 ||
    expires.minutes !== 16 * 60 ||
    expiresMs % 60000 !== 0 ||
    now.getTime() >= expiresMs
  )
    return expired;
  if (now.getTime() < scheduledMs) {
    return { state: 'waiting', retryAt: new Date(scheduledMs).toISOString() };
  }
  return { state: 'ready', expiresMs };
}

function inactiveReminderPushData(delivery) {
  const payload = delivery.payload || {};
  return {
    reminderWindowVersion: payload.reminderWindowVersion,
    reminderDate: payload.reminderDate,
    reminderScheduledAt: payload.reminderScheduledAt,
    reminderExpiresAt: payload.reminderExpiresAt,
    reminderDeliveryId: delivery.id,
  };
}

module.exports = { inactiveReminderTiming, inactiveReminderPushData, REMINDER_TIMEZONE };

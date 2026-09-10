const MINUTE = 60000;
const DAY = 1440 * MINUTE;
const dayStart = (localMs) => Math.floor(localMs / DAY) * DAY;

function parseClock(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 24 && minute <= 59 && (hour < 24 || minute === 0) ? hour * 60 + minute : null;
}

function openingWindow(hours, localDay) {
  const key = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'][new Date(localDay).getUTCDay()];
  const schedule = hours?.[key] ?? hours?.daily;
  if (!schedule || schedule.closed === true) return null;
  const open = parseClock(schedule.open);
  const close = parseClock(schedule.close);
  if (open == null || close == null || open >= 1440 || open === close) return null;
  return {
    start: localDay + open * MINUTE,
    end: localDay + (close < open ? close + 1440 : close) * MINUTE,
  };
}

// A working day may finish after midnight. Include the previous day's carryover.
function workingWindows(hours, localDay, days = 1) {
  const windows = [];
  for (let index = -1; index < days; index++) {
    const window = openingWindow(hours, localDay + index * DAY);
    if (window && window.end > localDay) {
      windows.push({ start: Math.max(window.start, localDay), end: window.end });
    }
  }
  return windows;
}

function slotBucket(instant, interval, offset) {
  const local = Number(instant) + offset * MINUTE;
  const day = dayStart(local);
  return (
    day + Math.floor((local - day) / (interval * MINUTE)) * interval * MINUTE - offset * MINUTE
  );
}

module.exports = { MINUTE, DAY, dayStart, parseClock, workingWindows, slotBucket };

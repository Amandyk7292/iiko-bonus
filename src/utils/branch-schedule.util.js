const clockMinutes = (value) => {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour < 24 && minute < 60 ? hour * 60 + minute : null;
};
const isRoundTheClock = (branch) =>
  branch.roundTheClock === true || branch.round_the_clock === true;
const effectiveHours = (branch) =>
  isRoundTheClock(branch) ? { daily: { open: '00:00', close: '24:00' } } : branch.hours || {};
const shiftTimes = (branch) => ({
  day: String(branch.photoDayShiftStart || branch.photo_day_shift_start || '08:00').slice(0, 5),
  night: String(branch.photoNightShiftStart || branch.photo_night_shift_start || '21:00').slice(
    0,
    5,
  ),
});
// A shift belongs to the date on which it starts. At handover, default to the
// shift that has just ended; staff may choose the other latest started shift.
function photoPeriod(branch, requestedShift, now = new Date()) {
  const local = new Date(now.getTime() + 300 * 60000);
  const midnight = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  if (!isRoundTheClock(branch)) {
    return {
      shift: 'daily',
      date: new Date(now.getTime() + 3600000).toISOString().slice(0, 10),
      shiftStartsAt: null,
      shiftEndsAt: null,
    };
  }
  const times = shiftTimes(branch);
  const day = clockMinutes(times.day);
  const night = clockMinutes(times.night);
  const minute = local.getUTCHours() * 60 + local.getUTCMinutes();
  const shift = ['day', 'night'].includes(requestedShift)
    ? requestedShift
    : minute >= day && minute < night
      ? 'night'
      : 'day';
  const start = shift === 'day' ? day : night;
  const dateMs = midnight - (minute < start ? 86400000 : 0);
  return {
    shift,
    date: new Date(dateMs).toISOString().slice(0, 10),
    shiftStartsAt: new Date(dateMs + start * 60000 - 300 * 60000).toISOString(),
    shiftEndsAt: new Date(
      dateMs + (shift === 'day' ? night : day + 1440) * 60000 - 300 * 60000,
    ).toISOString(),
  };
}
module.exports = { clockMinutes, isRoundTheClock, effectiveHours, shiftTimes, photoPeriod };

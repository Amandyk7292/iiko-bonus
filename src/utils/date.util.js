const DEFAULT_TIMEZONE_OFFSET_MINUTES = 300;

function timezoneOffsetMinutes(env = process.env) {
  const configured = Number.parseInt(env.ORDER_TIMEZONE_OFFSET_MINUTES || '', 10);
  return Number.isInteger(configured) && Math.abs(configured) <= 840
    ? configured
    : DEFAULT_TIMEZONE_OFFSET_MINUTES;
}

function localDateBoundaryIso(value, { nextDay = false, env = process.env } = {}) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  const dayOffset = nextDay ? 24 * 60 * 60 * 1000 : 0;
  return new Date(timestamp + dayOffset - timezoneOffsetMinutes(env) * 60 * 1000).toISOString();
}

module.exports = {
  DEFAULT_TIMEZONE_OFFSET_MINUTES,
  localDateBoundaryIso,
  timezoneOffsetMinutes,
};

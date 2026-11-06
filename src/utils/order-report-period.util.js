function orderReportPeriod(from, to) {
  if (!from && !to) return null;
  const valid = (value) =>
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
    new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to) {
    throw Object.assign(new Error('Выберите корректный период'), { statusCode: 400 });
  }
  const start = new Date(`${from}T00:00:00+05:00`);
  const end = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400000);
  if (end - start > 366 * 86400000) {
    throw Object.assign(new Error('Выберите период не более года'), { statusCode: 400 });
  }
  return { start: start.toISOString(), end: end.toISOString() };
}
module.exports = { orderReportPeriod };

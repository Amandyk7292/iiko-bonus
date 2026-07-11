function parseMoney(value, fieldName, { min = 0, max = 100000000 } = {}) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
    const error = new Error(
      `Invalid value for ${fieldName}: must be a finite number between ${min} and ${max}`,
    );
    error.statusCode = 400;
    throw error;
  }
  return Number(parsed.toFixed(2));
}
module.exports = { parseMoney };

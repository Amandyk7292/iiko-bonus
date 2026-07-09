function parseMoney(value, fieldName, { min = 0 } = {}) {
  const parsed = Number(value);
  if (isNaN(parsed) || parsed < min) {
    throw new Error(`Invalid value for ${fieldName}: must be a number >= ${min}`);
  }
  return parsed;
}
module.exports = { parseMoney };

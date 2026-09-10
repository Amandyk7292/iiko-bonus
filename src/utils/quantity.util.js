const quantityMillis = (value) => Math.round(Number(value) * 1000);
const validQuantity = (value, { min = 0.001, max = 9999, step = 0.001 } = {}) =>
  Number.isFinite(value) &&
  value >= min &&
  value <= max &&
  Math.abs(value * 1000 - quantityMillis(value)) < 0.000001 &&
  quantityMillis(value) % quantityMillis(step) === 0;
const addQuantity = (a, b) => (quantityMillis(a) + quantityMillis(b)) / 1000;
module.exports = { quantityMillis, validQuantity, addQuantity };

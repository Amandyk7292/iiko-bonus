// Spelling aliases only. Different physical units (for example g and kg) must
// still fail validation; this function never converts quantities.
const inventoryUnitKey = (value) => {
  const name = String(value || '')
    .trim()
    .toLowerCase();
  if (/^(шт\.?|штука|штуки|штук|pcs|pieces?)$/.test(name)) return 'шт';
  if (/^(кг\.?|килограмм|килограммы|kg)$/.test(name)) return 'кг';
  return name;
};

module.exports = { inventoryUnitKey };

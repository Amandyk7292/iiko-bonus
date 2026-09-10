function courierOrderHandoffNote(order) {
  const number = Number(order?.order_number);
  if (!Number.isSafeInteger(number) || number <= 0) return '';
  return `Заказ Bulka №${number}. При получении назовите кассиру номер заказа №${number}.`;
}
module.exports = { courierOrderHandoffNote };

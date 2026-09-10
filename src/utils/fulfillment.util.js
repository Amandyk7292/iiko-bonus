const ORDER_FULFILLMENT_TYPES = new Set(['pickup', 'delivery', 'preorder']);

const normalizeOrderFulfillmentType = (value, fallback = 'pickup') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ORDER_FULFILLMENT_TYPES.has(normalized) ? normalized : fallback;
};

const normalizePreorderFulfillmentType = () => 'pickup';

const effectiveFulfillmentType = (orderOrType, preorderFulfillmentType) => {
  const order =
    orderOrType && typeof orderOrType === 'object'
      ? orderOrType
      : {
          fulfillment_type: orderOrType,
          preorder_fulfillment_type: preorderFulfillmentType,
        };
  const orderType = normalizeOrderFulfillmentType(
    order.fulfillment_type ?? order.orderType ?? order.fulfillmentType,
  );
  if (orderType !== 'preorder') return orderType;
  return 'pickup';
};

const isDeliveryFulfillment = (orderOrType, preorderFulfillmentType) =>
  effectiveFulfillmentType(orderOrType, preorderFulfillmentType) === 'delivery';

module.exports = {
  effectiveFulfillmentType,
  isDeliveryFulfillment,
  normalizeOrderFulfillmentType,
  normalizePreorderFulfillmentType,
};

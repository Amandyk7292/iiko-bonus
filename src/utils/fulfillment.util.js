const ORDER_FULFILLMENT_TYPES = new Set(['pickup', 'delivery', 'preorder']);
const PREORDER_FULFILLMENT_TYPES = new Set(['pickup', 'delivery']);

const normalizeOrderFulfillmentType = (value, fallback = 'pickup') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return ORDER_FULFILLMENT_TYPES.has(normalized) ? normalized : fallback;
};

const normalizePreorderFulfillmentType = (value, fallback = 'pickup') => {
  const normalized = String(value || '')
    .trim()
    .toLowerCase();
  return PREORDER_FULFILLMENT_TYPES.has(normalized) ? normalized : fallback;
};

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
  return normalizePreorderFulfillmentType(
    order.preorder_fulfillment_type ?? order.preorderFulfillmentType ?? preorderFulfillmentType,
  );
};

const isDeliveryFulfillment = (orderOrType, preorderFulfillmentType) =>
  effectiveFulfillmentType(orderOrType, preorderFulfillmentType) === 'delivery';

module.exports = {
  effectiveFulfillmentType,
  isDeliveryFulfillment,
  normalizeOrderFulfillmentType,
  normalizePreorderFulfillmentType,
};

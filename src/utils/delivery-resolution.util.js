const UNRESOLVED = new Set([
  'pending',
  'pickup_cancelling',
  'cancel_cancelling',
  'pickup_pending_approval',
  'pickup_accepting',
  'pickup_rejecting',
  'cancel_refunding',
]);
const deliveryResolution = (order) => {
  const value = order?.delivery_resolution;
  if (!value || typeof value !== 'object' || !value.id || !value.status) return null;
  return {
    id: String(value.id),
    status: value.status,
    reason: value.reason,
    requestedAt: value.requestedAt || null,
    pickupTime: value.pickupTime || null,
    reviewedAt: value.reviewedAt || null,
  };
};
const unresolvedDeliveryResolution = (order) => UNRESOLVED.has(order?.delivery_resolution?.status);
const deliveryResolutionBlocksDispatch = (order) =>
  unresolvedDeliveryResolution(order) && order.delivery_resolution.status !== 'pending';
module.exports = {
  unresolvedDeliveryResolutionStatuses: Object.freeze([...UNRESOLVED]),
  deliveryResolution,
  unresolvedDeliveryResolution,
  deliveryResolutionBlocksDispatch,
};

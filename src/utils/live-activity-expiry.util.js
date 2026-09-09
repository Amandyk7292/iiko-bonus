const { isDeliveryFulfillment } = require('./fulfillment.util');

const PICKUP_READY_ACTIVITY_LIFETIME_MS = 60 * 60 * 1000;

function pickupLiveActivityExpiresAt(order) {
  if (!order || order.fulfillment_status !== 'ready' || isDeliveryFulfillment(order)) return null;
  // Older admin orders did not record kitchen_ready_at. Their last saved
  // transition is the conservative fallback; new transitions persist it.
  const readyAt = Date.parse(order.kitchen_ready_at || order.updated_at || order.created_at);
  return Number.isFinite(readyAt)
    ? new Date(readyAt + PICKUP_READY_ACTIVITY_LIFETIME_MS).toISOString()
    : null;
}

function isPickupLiveActivityExpired(order, now = Date.now()) {
  const expiresAt = pickupLiveActivityExpiresAt(order);
  return expiresAt !== null && Date.parse(expiresAt) <= Number(now);
}

module.exports = { pickupLiveActivityExpiresAt, isPickupLiveActivityExpired };

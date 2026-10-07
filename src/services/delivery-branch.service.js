const {
  deliveryCandidates,
  normalizeDeliveryAddress,
  normalizeOrderType,
  validateCheckout,
} = require('./checkout.service');

const unavailable = (quoted = false) =>
  Object.assign(
    new Error(
      quoted
        ? 'Обновите стоимость заказа и подтвердите оплату ещё раз.'
        : 'Нет свободного времени доставки. Попробуйте позже.',
    ),
    {
      statusCode: 409,
      code: quoted ? 'CHECKOUT_QUOTE_CHANGED' : 'CHECKOUT_DELIVERY_SLOT_UNAVAILABLE',
    },
  );
const defaultListSlots = (options) => require('./slot.service').listAvailableSlots(options);
const usableSlots = (result) =>
  (result.slots || [])
    .filter((slot) => Number(slot.remaining) > 0 && Number.isFinite(Date.parse(slot.startsAt)))
    .sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt));

// Capacity is a read-only snapshot here. The existing atomic checkout hold is
// still authoritative when another customer takes the last place afterwards.
async function resolveCheckout(
  payload,
  cities,
  {
    now = new Date(),
    env = process.env,
    listSlots = defaultListSlots,
    excludeRequestId = null,
    preferredBranchId = null,
    preferredScheduledAt = null,
  } = {},
) {
  if (normalizeOrderType(payload?.orderType ?? payload?.fulfillmentType) !== 'delivery')
    return validateCheckout(payload, cities, { now, env });
  const address = normalizeDeliveryAddress(payload?.deliveryAddress);
  const candidates = deliveryCandidates(address, cities);
  const quoted = preferredBranchId != null;
  const selected = quoted
    ? candidates.filter((point) => String(point.id) === String(preferredBranchId))
    : candidates;
  const asap = !String(payload?.scheduledAt ?? payload?.pickupTime ?? '').trim();
  for (const candidate of selected) {
    let result;
    try {
      result = await listSlots({
        branchId: String(candidate.id),
        orderType: 'delivery',
        productIds: (payload?.items || []).map((item) => item.id),
        now,
        env,
        // ASAP uses today's normal delivery window. Night shifts and 24/7
        // branches keep their existing continuation across midnight.
        horizonHours: null,
        excludeRequestId,
      });
    } catch (error) {
      if (error.code !== 'CHECKOUT_BRANCH_UNAVAILABLE') throw error;
      if (quoted) throw unavailable(true);
      continue;
    }
    const slots = usableSlots(result);
    const scheduledAt = asap
      ? preferredScheduledAt || slots[0]?.startsAt
      : (payload.scheduledAt ?? payload.pickupTime);
    if (!scheduledAt) continue;
    let checkout;
    try {
      checkout = validateCheckout({ ...payload, scheduledAt }, cities, {
        now,
        env,
        deliveryBranchId: candidate.id,
      });
    } catch (error) {
      if (
        quoted &&
        ['CHECKOUT_BRANCH_UNAVAILABLE', 'CHECKOUT_SCHEDULE_UNAVAILABLE'].includes(error.code)
      )
        throw unavailable(true);
      if (error.code === 'CHECKOUT_BRANCH_UNAVAILABLE') continue;
      throw error;
    }
    if (slots.some((slot) => new Date(slot.startsAt).toISOString() === checkout.scheduledAt))
      return checkout;
  }
  throw unavailable(quoted);
}

module.exports = { resolveCheckout };

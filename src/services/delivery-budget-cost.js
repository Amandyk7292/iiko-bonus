const TERMINAL = new Set([
  'cancelled',
  'cancelled_with_payment',
  'cancelled_by_taxi',
  'cancelled_with_items_on_hands',
  'estimating_failed',
  'performer_not_found',
  'failed',
  'delivered',
  'delivered_finish',
  'returned',
  'returned_finish',
  'complete',
  'finished',
]);

function verifiedMoney(value) {
  if (value == null || value === '' || typeof value === 'boolean') return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount >= 0 && amount <= 1_000_000
    ? Math.round(amount * 100) / 100
    : null;
}

function finalJobCost(job) {
  if (!TERMINAL.has(job.provider_status)) return null;
  const raw = job.raw_response || {};
  if (
    !job.external_claim_id &&
    (raw.cancelledBeforeCreate || job.request_payload?.createConfirmedAbsent)
  )
    return 0;
  if (job.currency !== 'KZT') return null;
  if (job.api_family === 'business_v2') {
    if (job.provider_status === 'cancelled' && raw.cancellationState === 'free') return 0;
    return verifiedMoney(job.budget_final_cost ?? raw.billedPriceWithVat ?? raw.billedPriceExVat);
  }
  if (['cancelled', 'estimating_failed', 'performer_not_found'].includes(job.provider_status))
    return 0;
  // An offer is not a final bill. Unknown costs keep the reserve in place.
  return verifiedMoney(
    raw.pricing?.final_price ??
      job.budget_final_cost ??
      (job.provider_status === 'cancelled_with_payment' ? job.budget_cancellation_cost : null),
  );
}

module.exports = { finalJobCost, verifiedMoney, TERMINAL };

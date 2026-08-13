const { supabase } = require('../config/supabase');

const CARGO_TERMINAL_STATUSES = new Set([
  'estimating_failed',
  'performer_not_found',
  'delivered',
  'delivered_finish',
  'returned',
  'returned_finish',
  'failed',
  'cancelled',
  'cancelled_with_payment',
  'cancelled_by_taxi',
  'cancelled_with_items_on_hands',
]);

const BUSINESS_TERMINAL_STATUSES = new Set(['complete', 'finished', 'cancelled', 'failed']);

const lifecycleError = (statusCode, message, code) =>
  Object.assign(new Error(message), { statusCode, code });

function isActiveExternalDeliveryJob(job) {
  const family = String(job?.api_family || '').trim();
  const status = String(job?.provider_status || '')
    .trim()
    .toLowerCase();
  if (!family || !status) return true;
  if (family === 'cargo_v2') return !CARGO_TERMINAL_STATUSES.has(status);
  if (family === 'business_v2') return !BUSINESS_TERMINAL_STATUSES.has(status);
  return true;
}

async function assertExternalDeliveryCancelled(orderId, { db = supabase } = {}) {
  const { data, error } = await db
    .from('delivery_jobs')
    .select('id,api_family,provider_status,external_claim_id')
    .eq('order_id', orderId)
    .eq('provider', 'yandex');
  if (error) {
    throw lifecycleError(
      503,
      'Не удалось проверить состояние доставки. Отмена и возврат временно заблокированы.',
      'EXTERNAL_DELIVERY_STATE_UNAVAILABLE',
    );
  }
  const active = (data || []).find(isActiveExternalDeliveryJob);
  if (active) {
    throw lifecycleError(
      409,
      'Сначала явно отмените активную заявку Яндекс.Доставки и дождитесь подтверждения отмены.',
      'EXTERNAL_DELIVERY_CANCELLATION_REQUIRED',
    );
  }
}

module.exports = {
  assertExternalDeliveryCancelled,
  isActiveExternalDeliveryJob,
};

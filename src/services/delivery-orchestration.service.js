const { supabase } = require('../config/supabase');
const { isDeliveryFulfillment } = require('../utils/fulfillment.util');
const realtime = require('./realtime.service');

const MAX_DISPATCH_ATTEMPTS = 10;
const AUTOMOBILE_TRANSPORT_TYPES = new Set(['car', 'auto', 'automobile', 'van', 'truck']);
const YANDEX_HANDOFF_ELIGIBLE_STATUSES = new Set([
  'performer_found',
  'pickup_arrived',
  'ready_for_pickup_confirmation',
  'pickuped',
  'delivery_arrived',
  'ready_for_delivery_confirmation',
  'waiting',
  'transporting',
]);

const orchestrationError = (message, statusCode = 409, code = null) =>
  Object.assign(new Error(message), { statusCode, ...(code && { code }) });

const isAutomobileTransport = (transportType, vehicle = '') => {
  const normalized = String(transportType || '')
    .trim()
    .toLocaleLowerCase('en-US');
  if (AUTOMOBILE_TRANSPORT_TYPES.has(normalized)) return true;
  if (['foot', 'walker', 'bicycle', 'bike', 'motorcycle', 'scooter'].includes(normalized)) {
    return false;
  }
  return /\b(авто|car|van|truck|toyota|hyundai|kia|lada|chevrolet|renault)\b/i.test(
    String(vehicle || ''),
  );
};

const dispatchRetryAt = (attempts) => {
  const seconds = Math.min(15 * 60, 15 * 2 ** Math.max(0, Number(attempts || 1) - 1));
  return new Date(Date.now() + seconds * 1000).toISOString();
};

const dispatchRequestUpdates = (order, now = new Date().toISOString()) => {
  if (!order || !isDeliveryFulfillment(order)) return {};
  if (
    order.courier_dispatch_completed_at ||
    ['succeeded', 'failed'].includes(String(order.courier_dispatch_status || ''))
  ) {
    return {};
  }
  return {
    courier_dispatch_status: 'pending',
    courier_dispatch_requested_at: order.courier_dispatch_requested_at || now,
    courier_dispatch_next_attempt_at: now,
    courier_dispatch_error: null,
  };
};

async function readOrder(orderId) {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw orchestrationError('Заказ не найден', 404, 'ORDER_NOT_FOUND');
  return data;
}

async function dispatchAcceptedDeliveryOrder(order, { yandexDelivery, dispatchService } = {}) {
  if (!order || !isDeliveryFulfillment(order)) {
    return { skipped: true, reason: 'not_delivery' };
  }
  if (!order.courier_dispatch_requested_at) {
    return { skipped: true, reason: 'not_accepted' };
  }
  if (
    order.courier_id ||
    !['', 'unassigned'].includes(String(order.delivery_status || 'unassigned')) ||
    ['completed', 'cancelled'].includes(String(order.fulfillment_status || ''))
  ) {
    return { skipped: true, reason: 'already_dispatched' };
  }

  const externalDelivery = yandexDelivery || require('./yandex-delivery.service');
  const internalDispatch = dispatchService || require('./dispatch.service');
  const yandexStatus = externalDelivery.getConfigurationStatus();
  if (yandexStatus.apiMode === 'business_v2' && !yandexStatus.autoDispatch) {
    return {
      skipped: true,
      provider: 'yandex',
      reason: 'business_price_confirmation_required',
    };
  }
  if (yandexStatus.autoDispatch) {
    if (!yandexStatus.configured) {
      throw orchestrationError(
        `Автовызов Яндекс.Доставки настроен не полностью: ${yandexStatus.missing.join(', ')}`,
        503,
        'YANDEX_DELIVERY_NOT_CONFIGURED',
      );
    }
    // Run the same local validation before entering the provider adapter. It
    // guarantees that a bad saved address (especially a city mismatch) never
    // reaches Yandex and gives the cashier a deterministic reason immediately.
    if (typeof externalDelivery.validateDeliveryOrder === 'function') {
      externalDelivery.validateDeliveryOrder(order);
    }
    return {
      skipped: false,
      provider: 'yandex',
      result: await externalDelivery.dispatchOrder(order.id),
    };
  }
  return {
    skipped: false,
    provider: 'internal',
    result: await internalDispatch.autoAssignOrder(order.id),
  };
}

async function requestDeliveryDispatch(orderId, { processImmediately = true } = {}) {
  const order = await readOrder(orderId);
  const updates = dispatchRequestUpdates(order);
  if (!Object.keys(updates).length) {
    return { skipped: true, reason: 'not_required' };
  }
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update(updates)
    .eq('id', orderId)
    .is('courier_dispatch_completed_at', null)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { skipped: true, reason: 'already_requested' };
  return processImmediately ? processDeliveryDispatch(orderId) : { queued: true };
}

async function processDeliveryDispatch(orderId, dependencies = {}) {
  const current = await readOrder(orderId);
  if (!current.courier_dispatch_requested_at) {
    return { skipped: true, reason: 'not_accepted' };
  }
  if (current.courier_dispatch_completed_at || current.courier_dispatch_status === 'succeeded') {
    return { skipped: true, reason: 'already_completed' };
  }
  if (
    current.status !== 'paid' ||
    !isDeliveryFulfillment(current) ||
    ['cancelled', 'completed'].includes(String(current.fulfillment_status || ''))
  ) {
    return { skipped: true, reason: 'not_dispatchable' };
  }

  const attempts = Number(current.courier_dispatch_attempts || 0) + 1;
  const attemptedAt = new Date().toISOString();
  const realtimeService = dependencies.realtime || realtime;
  let claim = supabase
    .from('kaspi_orders')
    .update({
      courier_dispatch_status: 'processing',
      courier_dispatch_attempts: attempts,
      courier_dispatch_attempted_at: attemptedAt,
      courier_dispatch_error: null,
    })
    .eq('id', orderId)
    .is('courier_dispatch_completed_at', null);
  claim =
    current.courier_dispatch_status == null
      ? claim.is('courier_dispatch_status', null)
      : claim.eq('courier_dispatch_status', current.courier_dispatch_status);
  const { data: claimed, error: claimError } = await claim.select('*').maybeSingle();
  if (claimError) throw claimError;
  if (!claimed) return { skipped: true, reason: 'already_processing' };

  try {
    const result = await dispatchAcceptedDeliveryOrder(claimed, dependencies);
    const provider = result.provider || claimed.courier_dispatch_provider || null;
    if (result.reason === 'business_price_confirmation_required') {
      const { error } = await supabase
        .from('kaspi_orders')
        .update({
          courier_dispatch_status: 'awaiting_confirmation',
          courier_dispatch_provider: 'yandex',
          courier_dispatch_next_attempt_at: null,
          courier_dispatch_error: null,
        })
        .eq('id', orderId)
        .eq('courier_dispatch_status', 'processing');
      if (error) throw error;
      return result;
    }
    const completedAt = new Date().toISOString();
    const { error } = await supabase
      .from('kaspi_orders')
      .update({
        courier_dispatch_status: 'succeeded',
        courier_dispatch_provider: provider,
        courier_dispatch_completed_at: completedAt,
        courier_dispatch_next_attempt_at: null,
        courier_dispatch_error: null,
      })
      .eq('id', orderId)
      .eq('courier_dispatch_status', 'processing');
    if (error) throw error;
    realtimeService.publish(
      'order.updated',
      {
        orderId,
        courierDispatchStatus: 'succeeded',
        courierDispatchProvider: provider,
        courierDispatchError: null,
      },
      { includeAdmins: true, branchId: current.branch_id },
    );
    return result;
  } catch (error) {
    // Validation failures (for example a destination city different from the
    // branch city) are deterministic. Retrying them would only spam Yandex;
    // keep the order visible to the cashier as a terminal dispatch failure.
    const exhausted = attempts >= MAX_DISPATCH_ATTEMPTS || error?.retryable === false;
    const dispatchError = String(error?.message || 'Не удалось вызвать курьера').slice(0, 2000);
    await supabase
      .from('kaspi_orders')
      .update({
        courier_dispatch_status: exhausted ? 'failed' : 'retrying',
        courier_dispatch_next_attempt_at: exhausted ? null : dispatchRetryAt(attempts),
        courier_dispatch_error: dispatchError,
      })
      .eq('id', orderId)
      .eq('courier_dispatch_status', 'processing');
    realtimeService.publish(
      'order.updated',
      {
        orderId,
        courierDispatchStatus: exhausted ? 'failed' : 'retrying',
        courierDispatchProvider: 'yandex',
        courierDispatchError: dispatchError,
      },
      { includeAdmins: true, branchId: current.branch_id },
    );
    throw error;
  }
}

async function processDeliveryDispatchQueue(limit = 20) {
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000).toISOString();
  const { data: stale, error: staleError } = await supabase
    .from('kaspi_orders')
    .select('id')
    .eq('courier_dispatch_status', 'processing')
    .lt('courier_dispatch_attempted_at', staleBefore)
    .limit(100);
  if (staleError) throw staleError;
  for (const order of stale || []) {
    const { data: uncertainBusinessJob, error: uncertainReadError } = await supabase
      .from('delivery_jobs')
      .select('id,external_claim_id,provider_status')
      .eq('order_id', order.id)
      .eq('provider', 'yandex')
      .eq('api_family', 'business_v2')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (uncertainReadError) throw uncertainReadError;
    const yandexDelivery = require('./yandex-delivery.service');
    const mustPreserveBusinessReservation =
      uncertainBusinessJob &&
      (['creating', 'creating_uncertain', 'creating_exhausted'].includes(
        uncertainBusinessJob.provider_status,
      ) ||
        (Boolean(uncertainBusinessJob.external_claim_id) &&
          !yandexDelivery.isTerminalStatus(uncertainBusinessJob.provider_status, 'business_v2')));
    if (mustPreserveBusinessReservation) {
      // A Business create timeout/5xx can mean that Yandex accepted the
      // request. Keep the order reservation and recover with the same
      // idempotency UUID; never release it to another courier automatically.
      await yandexDelivery
        .syncOrderDelivery(order.id)
        .catch((error) =>
          console.error(
            `Не удалось восстановить неопределённую Business-заявку заказа ${order.id}:`,
            error.message,
          ),
        );
      continue;
    }
    await supabase
      .from('kaspi_orders')
      .update({
        courier_dispatch_status: 'retrying',
        courier_dispatch_next_attempt_at: new Date().toISOString(),
        courier_dispatch_error: 'Предыдущая попытка прервалась и будет безопасно повторена',
      })
      .eq('id', order.id)
      .eq('courier_dispatch_status', 'processing');
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('id')
    .in('courier_dispatch_status', ['pending', 'retrying'])
    .lte('courier_dispatch_next_attempt_at', now)
    .order('courier_dispatch_next_attempt_at')
    .limit(Math.min(100, Math.max(1, Number(limit) || 20)));
  if (error) throw error;
  let processed = 0;
  for (const order of data || []) {
    await processDeliveryDispatch(order.id).catch((dispatchError) =>
      console.warn(`Повторный вызов курьера для заказа ${order.id}:`, dispatchError.message),
    );
    processed += 1;
  }
  return processed;
}

async function assertAutomobileCourierForHandoff(order) {
  if (!order || !isDeliveryFulfillment(order)) return true;
  if (order.courier_id) {
    const { data: courier, error } = await supabase
      .from('couriers')
      .select('transport_type,vehicle')
      .eq('id', order.courier_id)
      .maybeSingle();
    if (error) throw error;
    if (courier && isAutomobileTransport(courier.transport_type, courier.vehicle)) return true;
    throw orchestrationError(
      'Передача запрещена: для продуктов нужен курьер на автомобиле.',
      409,
      'AUTOMOBILE_COURIER_REQUIRED',
    );
  }

  const { data: jobs, error } = await supabase
    .from('delivery_jobs')
    .select(
      'api_family,courier_transport_type,courier_car_model,courier_car_number,provider_status,created_at',
    )
    .eq('order_id', order.id)
    .eq('provider', 'yandex')
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  const job = jobs?.[0];
  const providerStatus = String(job?.provider_status || '').trim();
  if (
    job &&
    require('./yandex-delivery.service').isTerminalStatus(
      providerStatus,
      job.api_family || 'cargo_v2',
    )
  ) {
    throw orchestrationError(
      `Передача запрещена: заявка Яндекс.Доставки завершена со статусом «${providerStatus}». Вызовите нового автокурьера.`,
      409,
      'YANDEX_DELIVERY_NOT_ACTIVE',
    );
  }
  if (job && !YANDEX_HANDOFF_ELIGIBLE_STATUSES.has(providerStatus)) {
    throw orchestrationError(
      `Передача запрещена: заявка Яндекс.Доставки не готова к передаче (статус «${providerStatus || 'не указан'}»). Дождитесь назначения автокурьера.`,
      409,
      'YANDEX_DELIVERY_NOT_HANDOFF_ELIGIBLE',
    );
  }
  const vehicle = [job?.courier_car_model, job?.courier_car_number].filter(Boolean).join(' ');
  if (job && isAutomobileTransport(job.courier_transport_type, vehicle)) return true;
  if (job?.courier_transport_type) {
    throw orchestrationError(
      `Передача запрещена: назначен неподходящий транспорт «${job.courier_transport_type}».`,
      409,
      'AUTOMOBILE_COURIER_REQUIRED',
    );
  }
  throw orchestrationError(
    'Автокурьер ещё не назначен. Дождитесь данных автомобиля.',
    409,
    'AUTOMOBILE_COURIER_NOT_ASSIGNED',
  );
}

module.exports = {
  AUTOMOBILE_TRANSPORT_TYPES,
  YANDEX_HANDOFF_ELIGIBLE_STATUSES,
  assertAutomobileCourierForHandoff,
  dispatchAcceptedDeliveryOrder,
  dispatchRequestUpdates,
  isAutomobileTransport,
  processDeliveryDispatch,
  processDeliveryDispatchQueue,
  requestDeliveryDispatch,
};

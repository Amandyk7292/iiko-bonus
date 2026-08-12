const { logger } = require('../config/logger');
const { supabase } = require('../config/supabase');

const ALERT_TYPES = new Set([
  'no_active_ipad',
  'delivery_failed',
  'delivery_uncertain',
  'order_unaccepted',
]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMPTY_COUNTS = Object.freeze({
  queued: 0,
  configPending: 0,
  processing: 0,
  retry: 0,
  sent: 0,
  resolved: 0,
  pending: 0,
  oldestPendingSeconds: 0,
});
const ALERT_DELIVERY_CONCURRENCY = 5;

let latestHealth = {
  receiverConfigured: false,
  receiverRequired: false,
  queueAvailable: null,
  ...EMPTY_COUNTS,
};

const rpcRow = (data) => (Array.isArray(data) ? data[0] : data);

function receiverUrl(env = process.env) {
  const value = String(env.OPS_ALERT_WEBHOOK_URL || '').trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? value : '';
  } catch {
    return '';
  }
}

function receiverRequired(env = process.env) {
  return env.OPS_ALERT_RECEIVER_REQUIRED === 'true';
}

function staffOrderAcceptSlaSeconds(env = process.env) {
  const value = Number(env.STAFF_ORDER_ACCEPT_SLA_SECONDS || 120);
  return Number.isSafeInteger(value) ? Math.min(900, Math.max(60, value)) : 120;
}

function retryDelaySeconds(attempt) {
  return Math.min(60 * 2 ** Math.max(0, Math.min(Number(attempt || 1), 6) - 1), 3600);
}

function safeAlertRow(row) {
  const alertId = String(row?.alert_id || '');
  const orderId = String(row?.order_id || '');
  const branchId = String(row?.branch_id || '');
  const alertType = String(row?.alert_type || '');
  const orderNumber = String(row?.order_number || '');
  if (
    !UUID_PATTERN.test(alertId) ||
    !UUID_PATTERN.test(orderId) ||
    !UUID_PATTERN.test(branchId) ||
    !ALERT_TYPES.has(alertType) ||
    !/^\d{1,20}$/.test(orderNumber)
  ) {
    const error = new Error('Invalid staff order alert row');
    error.code = 'STAFF_ORDER_ALERT_INVALID_ROW';
    throw error;
  }
  const eventDate = new Date(row.event_at);
  if (Number.isNaN(eventDate.getTime())) {
    const error = new Error('Invalid staff order alert timestamp');
    error.code = 'STAFF_ORDER_ALERT_INVALID_ROW';
    throw error;
  }
  return {
    alertId,
    orderId,
    branchId,
    orderNumber,
    alertType,
    eventAt: eventDate.toISOString(),
  };
}

function webhookErrorCode(error) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'ALERT_TIMEOUT';
  return 'ALERT_TRANSPORT_FAILED';
}

async function deliverAlert(row, { fetchImpl = fetch, env = process.env } = {}) {
  const safe = safeAlertRow(row);
  const response = await fetchImpl(receiverUrl(env), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': safe.alertId,
      ...(env.OPS_ALERT_BEARER_TOKEN
        ? { Authorization: `Bearer ${env.OPS_ALERT_BEARER_TOKEN}` }
        : {}),
    },
    body: JSON.stringify({
      event: 'bulka_staff_order_alert',
      service: 'bulka-bonus-backend',
      alertId: safe.alertId,
      alertType: safe.alertType,
      orderId: safe.orderId,
      branchId: safe.branchId,
      orderNumber: safe.orderNumber,
      occurredAt: safe.eventAt,
    }),
    redirect: 'error',
    signal: AbortSignal.timeout(5000),
  });
  return response.ok
    ? { sent: true, errorCode: null }
    : { sent: false, errorCode: `ALERT_HTTP_${Number(response.status) || 0}` };
}

function normalizeSnapshot(data, env = process.env) {
  const row = rpcRow(data) || {};
  const count = (value) => {
    const number = Number(value || 0);
    return Number.isSafeInteger(number) && number >= 0 ? number : 0;
  };
  const counts = {
    queued: count(row.queued),
    configPending: count(row.config_pending),
    processing: count(row.processing),
    retry: count(row.retry),
    sent: count(row.sent),
    resolved: count(row.resolved),
    oldestPendingSeconds: count(row.oldest_pending_seconds),
  };
  counts.pending = counts.queued + counts.configPending + counts.processing + counts.retry;
  return {
    receiverConfigured: Boolean(receiverUrl(env)),
    receiverRequired: receiverRequired(env),
    queueAvailable: true,
    ...counts,
  };
}

async function refreshStaffOrderAlertHealth({ db = supabase, env = process.env } = {}) {
  try {
    const { data, error } = await db.rpc('staff_order_alert_snapshot');
    if (error) throw error;
    latestHealth = normalizeSnapshot(data, env);
  } catch {
    latestHealth = {
      receiverConfigured: Boolean(receiverUrl(env)),
      receiverRequired: receiverRequired(env),
      queueAvailable: false,
      ...EMPTY_COUNTS,
    };
  }
  return { ...latestHealth };
}

function staffOrderAlertHealthSnapshot(env = process.env) {
  return {
    ...latestHealth,
    receiverConfigured: Boolean(receiverUrl(env)),
    receiverRequired: receiverRequired(env),
  };
}

async function completeAlert(row, result, { db = supabase } = {}) {
  const { data, error } = await db.rpc('complete_staff_order_alert', {
    p_alert_id: row.alert_id,
    p_lease_token: row.lease_token,
    p_sent: result.sent,
    p_error_code: result.errorCode,
    p_retry_seconds: result.sent ? null : retryDelaySeconds(row.attempt_count),
  });
  if (error) throw error;
  if (data !== true) {
    const leaseError = new Error('Staff order alert lease was lost');
    leaseError.code = 'STAFF_ORDER_ALERT_LEASE_LOST';
    throw leaseError;
  }
}

async function validateAlertClaim(row, slaSeconds, { db = supabase } = {}) {
  const { data, error } = await db.rpc('validate_staff_order_alert_claim', {
    p_alert_id: row.alert_id,
    p_lease_token: row.lease_token,
    p_sla_seconds: slaSeconds,
  });
  if (error) throw error;
  return data === true;
}

async function forEachWithConcurrency(items, concurrency, callback) {
  let nextIndex = 0;
  const workerCount = Math.min(items.length, Math.max(1, concurrency));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < items.length) {
        const index = nextIndex;
        nextIndex += 1;
        await callback(items[index]);
      }
    }),
  );
}

async function flushStaffOrderAlerts(
  limit = 50,
  { db = supabase, fetchImpl = fetch, env = process.env } = {},
) {
  const slaSeconds = staffOrderAcceptSlaSeconds(env);
  const { error: enqueueError } = await db.rpc('enqueue_due_staff_order_alerts', {
    p_sla_seconds: slaSeconds,
  });
  if (enqueueError) throw enqueueError;

  if (!receiverUrl(env)) {
    const { error: deferError } = await db.rpc('defer_staff_order_alerts_configuration', {
      p_retry_seconds: 900,
    });
    if (deferError) throw deferError;
    const health = await refreshStaffOrderAlertHealth({ db, env });
    return { attempted: 0, sent: 0, receiverConfigured: false, pending: health.pending };
  }

  const { data, error } = await db.rpc('claim_staff_order_alerts', {
    p_limit: Math.min(200, Math.max(1, Number(limit) || 50)),
    p_sla_seconds: slaSeconds,
  });
  if (error) throw error;
  let sent = 0;
  let attempted = 0;
  const failures = [];
  await forEachWithConcurrency(data || [], ALERT_DELIVERY_CONCURRENCY, async (row) => {
    try {
      if (!(await validateAlertClaim(row, slaSeconds, { db }))) return;
      attempted += 1;
      let result;
      try {
        result = await deliverAlert(row, { fetchImpl, env });
      } catch (deliveryError) {
        result = { sent: false, errorCode: webhookErrorCode(deliveryError) };
      }
      await completeAlert(row, result, { db });
      if (result.sent) sent += 1;
      else {
        logger.warn(
          {
            event: 'staff_order_alert_delivery_deferred',
            alertId: String(row.alert_id),
            errorCode: result.errorCode,
          },
          'Staff order alert delivery deferred',
        );
      }
    } catch (alertError) {
      // Isolate a broken claim so later alerts in this batch are still
      // validated and delivered. The lease is durable and will be recovered
      // by the database after five minutes.
      logger.error(
        {
          event: 'staff_order_alert_processing_failed',
          alertId: String(row?.alert_id || ''),
          errorCode: String(alertError?.code || 'STAFF_ORDER_ALERT_PROCESSING_FAILED'),
        },
        'Staff order alert processing failed',
      );
      failures.push({
        alertId: String(row?.alert_id || ''),
        code: String(alertError?.code || 'STAFF_ORDER_ALERT_PROCESSING_FAILED').slice(0, 80),
      });
    }
  });
  await refreshStaffOrderAlertHealth({ db, env });
  if (failures.length) {
    const batchError = new Error(
      `Staff order alert batch completed with ${failures.length} persistence failure(s)`,
    );
    batchError.code = 'STAFF_ORDER_ALERT_BATCH_PARTIAL_FAILURE';
    batchError.failures = failures;
    throw batchError;
  }
  return {
    attempted,
    sent,
    receiverConfigured: true,
    pending: latestHealth.pending,
  };
}

module.exports = {
  deliverAlert,
  flushStaffOrderAlerts,
  refreshStaffOrderAlertHealth,
  staffOrderAcceptSlaSeconds,
  staffOrderAlertHealthSnapshot,
};

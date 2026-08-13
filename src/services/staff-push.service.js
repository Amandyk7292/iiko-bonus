const { supabase } = require('../config/supabase');
const pushService = require('./push.service');
const { sessionHash } = require('./admin-session.service');

const { sendPushNotificationDetailed } = pushService;
const classifyPushSendError =
  typeof pushService.classifyPushSendError === 'function'
    ? pushService.classifyPushSendError
    : (error) => ({
        outcomeUnknown: true,
        error: String(error?.code || 'push/transport-outcome-unknown'),
      });

const rpcSingle = (value) => (Array.isArray(value) ? value[0] : value);

const sessionKey = (admin) => {
  if (!admin?.jti || admin?.role !== 'cashier') {
    const error = new Error('Активная сессия кассира обязательна');
    error.statusCode = 403;
    error.code = 'STAFF_PUSH_CASHIER_REQUIRED';
    throw error;
  }
  return sessionHash(admin.jti);
};

async function registerStaffPushDevice(
  admin,
  { fcmToken, platform, installationId },
  { db = supabase } = {},
) {
  const { data, error } = await db.rpc('register_staff_push_device', {
    p_session_jti_hash: sessionKey(admin),
    p_token: fcmToken,
    p_platform: platform,
    p_installation_id: installationId,
  });
  if (error) throw error;
  const device = rpcSingle(data);
  if (!device) throw new Error('Staff push registration was not saved');
  return { platform: String(device.platform), installationId: String(device.installation_id) };
}

async function unregisterStaffPushDevice(
  admin,
  { platform, installationId },
  { db = supabase } = {},
) {
  const { error } = await db.rpc('unregister_staff_push_device', {
    p_session_jti_hash: sessionKey(admin),
    p_platform: platform,
    p_installation_id: installationId,
  });
  if (error) throw error;
}

async function staffPushDeviceStatus(admin, { platform, installationId }, { db = supabase } = {}) {
  const { data, error } = await db.rpc('staff_push_device_status', {
    p_session_jti_hash: sessionKey(admin),
    p_platform: platform,
    p_installation_id: installationId,
  });
  if (error) throw error;
  return Boolean(data);
}

async function touchStaffPushDeviceHeartbeat(
  admin,
  { platform, installationId },
  { db = supabase } = {},
) {
  const { data, error } = await db.rpc('touch_staff_push_device_heartbeat', {
    p_session_jti_hash: sessionKey(admin),
    p_platform: platform,
    p_installation_id: installationId,
  });
  if (error) throw error;
  return data === true;
}

async function deactivateStaffDevicesForSession(jti, { db = supabase } = {}) {
  if (!jti) return;
  const { error } = await db.rpc('deactivate_staff_push_devices_for_session', {
    p_session_jti_hash: sessionHash(jti),
  });
  if (error) throw error;
}

async function sendStaffPushTest(
  admin,
  { platform, installationId },
  { db = supabase, sendToken = sendPushNotificationDetailed } = {},
) {
  const { data, error } = await db.rpc('claim_staff_push_test_device', {
    p_session_jti_hash: sessionKey(admin),
    p_platform: platform,
    p_installation_id: installationId,
  });
  if (error) {
    if (String(error.message || '').includes('staff push test cooldown')) {
      const cooldown = new Error('Повторный тест можно отправить через минуту');
      cooldown.statusCode = 429;
      cooldown.code = 'STAFF_PUSH_TEST_COOLDOWN';
      throw cooldown;
    }
    throw error;
  }
  const claimed = rpcSingle(data);
  if (!claimed?.token) {
    const unavailable = new Error('Уведомления не включены для этого устройства');
    unavailable.statusCode = 404;
    unavailable.code = 'STAFF_PUSH_DEVICE_NOT_FOUND';
    throw unavailable;
  }
  const result = await sendToken(
    claimed.token,
    'Тест уведомлений',
    'Уведомления о заказах включены',
    {
      type: 'staff.order.test',
      deepLink: '/admin/kitchen?embedded=app',
      pushDedupeKey: `staff-test:${claimed.device_id}:${Date.now()}`,
    },
  );
  if (!result.outcomeUnknown && !result.delivered && result.terminal) {
    const { error: deactivateError } = await db.rpc('deactivate_invalid_staff_push_token', {
      p_token: claimed.token,
    });
    if (deactivateError) throw deactivateError;
  }
  return {
    status: result.delivered ? 'sent' : result.terminal ? 'failed' : 'retry',
    attempted: 1,
    delivered: result.delivered ? 1 : 0,
  };
}

const retryDelaySeconds = (attempt) =>
  Math.min(15 * 2 ** Math.max(0, Number(attempt || 1) - 1), 30 * 60);
const SAFE_TRANSPORT_ERROR_CODES = new Set([
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'ENETRESET',
  'ENOTFOUND',
  'EPIPE',
  'ERR_HTTP2_GOAWAY_SESSION',
  'ERR_HTTP2_STREAM_CANCEL',
  'ERR_HTTP2_STREAM_ERROR',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
]);

function safeDeliveryError(result, status) {
  const candidate = String(result?.error || '').trim();
  const safeCode =
    /^(?:app|messaging|push)\/[a-z0-9._-]{1,100}$/.test(candidate) ||
    SAFE_TRANSPORT_ERROR_CODES.has(candidate)
      ? candidate
      : '';
  if (status === 'uncertain') {
    return safeCode
      ? `FCM delivery outcome uncertain (${safeCode})`
      : 'FCM delivery outcome uncertain';
  }
  return safeCode || (result?.terminal ? 'FCM token rejected' : 'FCM delivery failed');
}

async function completeDelivery(row, result, { db = supabase } = {}) {
  const finalAttempt = Number(row.attempt_count) >= Number(row.max_attempts);
  const status = result.outcomeUnknown
    ? 'uncertain'
    : result.delivered
      ? 'sent'
      : result.expired
        ? 'skipped'
        : result.terminal
          ? 'failed'
          : finalAttempt
            ? 'failed'
            : 'retry';
  if (!result.outcomeUnknown && !result.delivered && !result.expired && result.terminal) {
    const { error } = await db.rpc('deactivate_invalid_staff_push_token', {
      p_token: row.token,
    });
    if (error) throw error;
  }
  const { data, error } = await db.rpc('complete_staff_push_delivery', {
    p_delivery_id: row.delivery_id,
    p_lease_token: row.lease_token,
    p_status: status,
    p_last_error: result.delivered ? null : safeDeliveryError(result, status),
    p_provider_message_id: result.providerMessageId || null,
    p_retry_seconds: status === 'retry' ? retryDelaySeconds(row.attempt_count) : null,
  });
  if (error) throw error;
  if (data !== true) {
    const leaseError = new Error('Staff push delivery lease was lost');
    leaseError.code = 'STAFF_PUSH_LEASE_LOST';
    throw leaseError;
  }
  return {
    deliveryId: String(row.delivery_id),
    status,
    attempted: 1,
    delivered: result.delivered ? 1 : 0,
  };
}

async function releaseDeliveryClaim(row, error, { db = supabase } = {}) {
  try {
    const { data, error: releaseError } = await db.rpc('release_staff_push_delivery_claim', {
      p_delivery_id: row.delivery_id,
      p_lease_token: row.lease_token,
      p_last_error: String(
        error?.code || error?.message || 'Staff push delivery interrupted',
      ).slice(0, 500),
      p_retry_seconds: retryDelaySeconds(row.attempt_count),
    });
    return !releaseError && data === true;
  } catch {
    return false;
  }
}

async function beginDeliveryDispatch(row, { db = supabase } = {}) {
  const { data, error } = await db.rpc('begin_staff_push_delivery_dispatch_v2', {
    p_delivery_id: row.delivery_id,
    p_lease_token: row.lease_token,
  });
  if (error) throw error;
  if (data === 'skipped') return false;
  // Boolean true keeps injected database doubles backwards-compatible; the
  // production v2 RPC returns the explicit dispatching state.
  if (data !== 'dispatching' && data !== true) {
    const leaseError = new Error('Staff push delivery lease was lost before dispatch');
    leaseError.code = 'STAFF_PUSH_LEASE_LOST';
    throw leaseError;
  }
  return true;
}

async function recoverDeliveredClaim(row, result, { db = supabase } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await db.rpc('recover_staff_push_delivery_sent', {
        p_delivery_id: row.delivery_id,
        p_lease_token: row.lease_token,
        p_provider_message_id: result.providerMessageId || null,
      });
      if (!error && data === true) return true;
    } catch {
      // A short in-process retry covers a transient database/network response
      // without ever re-enqueueing an FCM-accepted notification.
    }
  }
  return false;
}

async function flushStaffPushOutbox(
  limit = 100,
  { db = supabase, sendToken = sendPushNotificationDetailed } = {},
) {
  const { data, error } = await db.rpc('claim_staff_push_deliveries_v2', {
    p_limit: Math.min(200, Math.max(1, Number(limit) || 100)),
  });
  if (error) throw error;
  const outcomes = [];
  const failures = [];
  const claimedRows = data || [];
  for (let index = 0; index < claimedRows.length; index += 1) {
    const row = claimedRows[index];
    try {
      // FCM must only be contacted after this durable boundary commits. An
      // expired dispatching lease becomes uncertain and is never resent.
      const dispatchStarted = await beginDeliveryDispatch(row, { db });
      if (!dispatchStarted) {
        outcomes.push({
          deliveryId: String(row.delivery_id),
          status: 'skipped',
          attempted: 0,
          delivered: 0,
        });
        continue;
      }
    } catch (dispatchStartError) {
      // No provider call was made, so releasing either a processing row or an
      // ambiguously committed dispatching row is safe.
      const released = await releaseDeliveryClaim(row, dispatchStartError, { db });
      failures.push({
        row,
        error: dispatchStartError,
        released,
        recovered: false,
        stage: 'dispatch-start',
      });
      continue;
    }
    let result;
    try {
      result = await sendToken(
        row.token,
        'Новый заказ',
        'Поступил новый оплаченный заказ',
        {
          type: 'staff.order.new',
          orderId: String(row.order_id),
          orderNumber: String(row.order_number),
          deepLink: '/admin/kitchen?embedded=app',
          pushOutboxId: String(row.outbox_id),
          pushDedupeKey: `staff-order:${row.order_id}`,
        },
        { expiresAt: row.expires_at },
      );
    } catch (sendError) {
      const failure = classifyPushSendError(sendError);
      result = {
        delivered: false,
        terminal: false,
        outcomeUnknown: failure.outcomeUnknown,
        error: failure.error,
      };
    }
    try {
      outcomes.push(await completeDelivery(row, result, { db }));
    } catch (completionError) {
      if (result.delivered) {
        const recovered = await recoverDeliveredClaim(row, result, { db });
        if (recovered) {
          outcomes.push({
            deliveryId: String(row.delivery_id),
            status: 'sent',
            attempted: 1,
            delivered: 1,
            recovered: true,
          });
        }
        failures.push({
          row,
          error: completionError,
          released: false,
          recovered,
          uncertain: !recovered,
        });
      } else if (result.outcomeUnknown) {
        // The provider may already have accepted this dispatch. Never release
        // it for retry when persisting `uncertain` fails; stale-dispatch
        // cleanup will terminally quarantine it as uncertain.
        failures.push({
          row,
          error: completionError,
          released: false,
          recovered: false,
          uncertain: true,
        });
      } else {
        const released = await releaseDeliveryClaim(row, completionError, { db });
        failures.push({ row, error: completionError, released, recovered: false });
      }
    }
  }
  if (failures.length) {
    const batchError = new Error(
      `Staff push batch completed with ${failures.length} persistence failure(s)`,
    );
    batchError.code = 'STAFF_PUSH_BATCH_PARTIAL_FAILURE';
    batchError.outcomes = outcomes;
    batchError.failures = failures.map(({ row, error, released, recovered, uncertain, stage }) => ({
      deliveryId: String(row.delivery_id),
      code: String(error?.code || 'STAFF_PUSH_DELIVERY_FAILED'),
      released,
      recovered,
      ...(uncertain ? { uncertain: true } : {}),
      ...(stage ? { stage } : {}),
    }));
    throw batchError;
  }
  return outcomes;
}

async function completeReminderDelivery(row, result, { db = supabase } = {}) {
  const finalAttempt = Number(row.attempt_count) >= Number(row.max_attempts);
  const status = result.outcomeUnknown
    ? 'uncertain'
    : result.delivered
      ? 'sent'
      : result.expired
        ? 'skipped'
        : result.terminal
          ? 'failed'
          : finalAttempt
            ? 'failed'
            : 'retry';
  if (!result.outcomeUnknown && !result.delivered && !result.expired && result.terminal) {
    const { error } = await db.rpc('deactivate_invalid_staff_push_token', {
      p_token: row.token,
    });
    if (error) throw error;
  }
  const { data, error } = await db.rpc('complete_staff_push_reminder_delivery', {
    p_delivery_id: row.delivery_id,
    p_lease_token: row.lease_token,
    p_status: status,
    p_last_error: result.delivered ? null : safeDeliveryError(result, status),
    p_provider_message_id: result.providerMessageId || null,
    p_retry_seconds: status === 'retry' ? retryDelaySeconds(row.attempt_count) : null,
  });
  if (error) throw error;
  if (data !== true) {
    const leaseError = new Error('Staff reminder delivery lease was lost');
    leaseError.code = 'STAFF_REMINDER_LEASE_LOST';
    throw leaseError;
  }
  return {
    deliveryId: String(row.delivery_id),
    status,
    attempted: 1,
    delivered: result.delivered ? 1 : 0,
  };
}

async function releaseReminderClaim(row, error, { db = supabase } = {}) {
  try {
    const { data, error: releaseError } = await db.rpc('release_staff_push_reminder_claim', {
      p_delivery_id: row.delivery_id,
      p_lease_token: row.lease_token,
      p_last_error: String(
        error?.code || error?.message || 'Staff reminder delivery interrupted',
      ).slice(0, 500),
      p_retry_seconds: retryDelaySeconds(row.attempt_count),
    });
    return !releaseError && data === true;
  } catch {
    return false;
  }
}

async function beginReminderDispatch(row, { db = supabase } = {}) {
  const { data, error } = await db.rpc('begin_staff_push_reminder_dispatch', {
    p_delivery_id: row.delivery_id,
    p_lease_token: row.lease_token,
  });
  if (error) throw error;
  if (data === 'skipped') return false;
  if (data !== 'dispatching' && data !== true) {
    const leaseError = new Error('Staff reminder lease was lost before dispatch');
    leaseError.code = 'STAFF_REMINDER_LEASE_LOST';
    throw leaseError;
  }
  return true;
}

async function recoverDeliveredReminder(row, result, { db = supabase } = {}) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const { data, error } = await db.rpc('recover_staff_push_reminder_sent', {
        p_delivery_id: row.delivery_id,
        p_lease_token: row.lease_token,
        p_provider_message_id: result.providerMessageId || null,
      });
      if (!error && data === true) return true;
    } catch {
      // Never resend a provider-accepted reminder merely because persisting
      // its success had an ambiguous database response.
    }
  }
  return false;
}

async function flushStaffPushReminders(
  limit = 100,
  { db = supabase, sendToken = sendPushNotificationDetailed } = {},
) {
  const { data, error } = await db.rpc('claim_staff_push_reminder_deliveries', {
    p_limit: Math.min(200, Math.max(1, Number(limit) || 100)),
  });
  if (error) throw error;
  const outcomes = [];
  const failures = [];
  for (const row of data || []) {
    try {
      const dispatchStarted = await beginReminderDispatch(row, { db });
      if (!dispatchStarted) {
        outcomes.push({
          deliveryId: String(row.delivery_id),
          status: 'skipped',
          attempted: 0,
          delivered: 0,
        });
        continue;
      }
    } catch (dispatchStartError) {
      failures.push({
        row,
        error: dispatchStartError,
        released: await releaseReminderClaim(row, dispatchStartError, { db }),
        recovered: false,
        stage: 'dispatch-start',
      });
      continue;
    }

    let result;
    try {
      result = await sendToken(
        row.token,
        'Заказ не принят',
        'Оплаченный заказ ждёт подтверждения',
        {
          // Keep the established native staff-kitchen route for installed app
          // versions; distinct durable ids prevent dedupe with the first push.
          type: 'staff.order.new',
          orderId: String(row.order_id),
          orderNumber: String(row.order_number),
          reminderSequence: String(row.reminder_sequence || 1),
          deepLink: '/admin/kitchen?embedded=app',
          pushOutboxId: String(row.reminder_id),
          pushDedupeKey: `staff-order:${row.order_id}:reminder:${row.reminder_sequence || 1}`,
        },
        { expiresAt: row.expires_at },
      );
    } catch (sendError) {
      const failure = classifyPushSendError(sendError);
      result = {
        delivered: false,
        terminal: false,
        outcomeUnknown: failure.outcomeUnknown,
        error: failure.error,
      };
    }

    try {
      outcomes.push(await completeReminderDelivery(row, result, { db }));
    } catch (completionError) {
      if (result.delivered) {
        const recovered = await recoverDeliveredReminder(row, result, { db });
        if (recovered) {
          outcomes.push({
            deliveryId: String(row.delivery_id),
            status: 'sent',
            attempted: 1,
            delivered: 1,
            recovered: true,
          });
        }
        failures.push({
          row,
          error: completionError,
          released: false,
          recovered,
          uncertain: !recovered,
        });
      } else if (result.outcomeUnknown) {
        failures.push({
          row,
          error: completionError,
          released: false,
          recovered: false,
          uncertain: true,
        });
      } else {
        failures.push({
          row,
          error: completionError,
          released: await releaseReminderClaim(row, completionError, { db }),
          recovered: false,
        });
      }
    }
  }
  if (failures.length) {
    const batchError = new Error(
      `Staff reminder batch completed with ${failures.length} persistence failure(s)`,
    );
    batchError.code = 'STAFF_REMINDER_BATCH_PARTIAL_FAILURE';
    batchError.outcomes = outcomes;
    batchError.failures = failures.map(
      ({ row, error: failure, released, recovered, uncertain, stage }) => ({
        deliveryId: String(row.delivery_id),
        code: String(failure?.code || 'STAFF_REMINDER_DELIVERY_FAILED'),
        released,
        recovered,
        ...(uncertain ? { uncertain: true } : {}),
        ...(stage ? { stage } : {}),
      }),
    );
    throw batchError;
  }
  return outcomes;
}

module.exports = {
  deactivateStaffDevicesForSession,
  flushStaffPushOutbox,
  flushStaffPushReminders,
  registerStaffPushDevice,
  sendStaffPushTest,
  staffPushDeviceStatus,
  touchStaffPushDeviceHeartbeat,
  unregisterStaffPushDevice,
};

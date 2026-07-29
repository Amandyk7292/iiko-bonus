const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');

const PUSH_OUTBOX_SCHEMA_MISSING_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

const cleanText = (value, maxLength) =>
  String(value || '')
    .trim()
    .slice(0, maxLength);

const digest = (value) =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');

const normalizeTokens = (tokens) => [
  ...new Set(
    (Array.isArray(tokens) ? tokens : [])
      .map((token) => cleanText(token, 4096))
      .filter((token) => token.length >= 16),
  ),
];

function pushOutboxDedupeKey(scope, ...parts) {
  const prefix =
    cleanText(scope, 40)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'push';
  return `${prefix}:${digest(parts.map((part) => String(part || '')).join('\u001f')).slice(0, 56)}`;
}

function retryDelaySeconds(attemptCount) {
  const attempt = Math.max(1, Number(attemptCount) || 1);
  return Math.min(15 * 2 ** (attempt - 1), 30 * 60);
}

function normalizeOutbox(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    dedupeKey: row.dedupe_key,
    customerId: String(row.customer_id),
    title: row.title,
    body: row.body,
    data: row.payload && typeof row.payload === 'object' ? row.payload : {},
    tokens: normalizeTokens(row.pending_tokens),
    status: row.status,
    attemptCount: Number(row.attempt_count || 0),
    maxAttempts: Number(row.max_attempts || 8),
    attemptedTokens: Number(row.attempted_tokens || 0),
    deliveredTokens: Number(row.delivered_tokens || 0),
    nextAttemptAt: row.next_attempt_at,
    leaseToken: row.lease_token || null,
    lastError: row.last_error || null,
    sentAt: row.sent_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function findPushOutboxByDedupeKey(dedupeKey, { db = supabase } = {}) {
  const { data, error } = await db
    .from('push_notification_outbox')
    .select('*')
    .eq('dedupe_key', dedupeKey)
    .maybeSingle();
  if (error) throw error;
  return normalizeOutbox(data);
}

async function enqueuePushNotification(
  { customerId, title, body, data = {}, tokens, dedupeKey, maxAttempts = 8 },
  { db = supabase } = {},
) {
  const normalizedCustomerId = cleanText(customerId, 64);
  const normalizedTitle = cleanText(title, 160);
  const normalizedBody = cleanText(body, 2000);
  const normalizedTokens = normalizeTokens(tokens);
  if (!normalizedCustomerId) throw new Error('Push customer is required');
  if (!normalizedTitle || !normalizedBody) throw new Error('Push title and body are required');
  if (!normalizedTokens.length) {
    return {
      id: null,
      customerId: normalizedCustomerId,
      status: 'skipped',
      tokens: [],
      attemptedTokens: 0,
      deliveredTokens: 0,
    };
  }
  const normalizedPayload =
    data && typeof data === 'object' && !Array.isArray(data) ? { ...data } : {};
  delete normalizedPayload.pushDedupeKey;
  const normalizedDedupeKey =
    cleanText(dedupeKey, 200) ||
    pushOutboxDedupeKey(
      normalizedPayload.type || 'push',
      normalizedCustomerId,
      normalizedPayload.notificationId ||
        normalizedPayload.eventId ||
        normalizedPayload.requestId ||
        [
          normalizedPayload.orderId || '',
          normalizedPayload.orderStatus || normalizedPayload.deliveryStatus || '',
          normalizedTitle,
          normalizedBody,
          new Date().toISOString().slice(0, 10),
        ].join(':'),
    );
  const record = {
    dedupe_key: normalizedDedupeKey,
    customer_id: normalizedCustomerId,
    title: normalizedTitle,
    body: normalizedBody,
    payload: normalizedPayload,
    pending_tokens: normalizedTokens,
    max_attempts: Math.min(20, Math.max(1, Number(maxAttempts) || 8)),
  };
  const { data: inserted, error } = await db
    .from('push_notification_outbox')
    .insert(record)
    .select('*')
    .single();
  if (error?.code === '23505') {
    return findPushOutboxByDedupeKey(normalizedDedupeKey, { db });
  }
  if (error) throw error;
  return normalizeOutbox(inserted);
}

async function updateOutbox(row, updates, { db = supabase } = {}) {
  let query = db
    .from('push_notification_outbox')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', row.id);
  if (row.leaseToken) {
    query = query.eq('status', 'processing').eq('lease_token', row.leaseToken);
  }
  const { data, error } = await query.select('id').maybeSingle();
  if (error) throw error;
  if (row.leaseToken && !data) {
    const leaseError = new Error('Push outbox lease was lost');
    leaseError.code = 'PUSH_OUTBOX_LEASE_LOST';
    throw leaseError;
  }
}

async function markSkipped(row, reason, { db = supabase } = {}) {
  await updateOutbox(
    row,
    {
      status: 'skipped',
      pending_tokens: [],
      locked_at: null,
      lease_token: null,
      last_error: cleanText(reason, 500) || null,
    },
    { db },
  );
  return {
    outboxId: row.id,
    status: 'skipped',
    attempted: 0,
    delivered: 0,
    failed: 0,
    queued: false,
  };
}

async function markDelivered(row, results, { db = supabase } = {}) {
  const attempted = results.length;
  const delivered = results.filter((result) => result.delivered).length;
  const retryable = results.filter((result) => !result.delivered && !result.terminal);
  const attemptedTokens = row.attemptedTokens + attempted;
  const deliveredTokens = row.deliveredTokens + delivered;
  const finalAttempt = row.attemptCount >= row.maxAttempts;

  if (retryable.length && !finalAttempt) {
    const nextAttemptAt = new Date(
      Date.now() + retryDelaySeconds(row.attemptCount) * 1000,
    ).toISOString();
    await updateOutbox(
      row,
      {
        status: 'retry',
        pending_tokens: retryable.map((result) => result.token),
        attempted_tokens: attemptedTokens,
        delivered_tokens: deliveredTokens,
        next_attempt_at: nextAttemptAt,
        locked_at: null,
        lease_token: null,
        last_error: cleanText(retryable[0]?.error || 'FCM delivery failed', 500),
      },
      { db },
    );
    return {
      outboxId: row.id,
      status: 'retry',
      attempted,
      delivered,
      failed: attempted - delivered,
      queued: true,
      nextAttemptAt,
    };
  }

  const terminalStatus = deliveredTokens > 0 ? 'sent' : retryable.length ? 'failed' : 'skipped';
  const sentAt = deliveredTokens > 0 ? new Date().toISOString() : null;
  await updateOutbox(
    row,
    {
      status: terminalStatus,
      pending_tokens: [],
      attempted_tokens: attemptedTokens,
      delivered_tokens: deliveredTokens,
      locked_at: null,
      lease_token: null,
      last_error:
        terminalStatus === 'sent'
          ? null
          : cleanText(
              results.find((result) => !result.delivered)?.error || 'No active tokens',
              500,
            ),
      sent_at: sentAt,
    },
    { db },
  );
  return {
    outboxId: row.id,
    status: terminalStatus,
    attempted,
    delivered,
    failed: attempted - delivered,
    queued: false,
  };
}

async function deliverPushOutbox(
  { sendToken, isAllowed, limit = 50, messageId = null },
  { db = supabase } = {},
) {
  if (typeof sendToken !== 'function') throw new Error('Push sender is required');
  const { data, error } = await db.rpc('claim_push_notification_outbox', {
    p_limit: Math.min(200, Math.max(1, Number(limit) || 50)),
    p_message_id: messageId || null,
  });
  if (error) throw error;
  const outcomes = [];
  for (const rawRow of data || []) {
    const row = normalizeOutbox(rawRow);
    try {
      if (typeof isAllowed === 'function' && !(await isAllowed(row.customerId, row.data))) {
        outcomes.push(await markSkipped(row, 'Notification preferences changed', { db }));
        continue;
      }
      if (!row.tokens.length) {
        outcomes.push(await markSkipped(row, 'No active push tokens', { db }));
        continue;
      }
      const results = await Promise.all(
        row.tokens.map(async (token) => {
          try {
            const result = await sendToken(token, row.title, row.body, {
              ...row.data,
              pushOutboxId: row.id,
              pushDedupeKey: row.dedupeKey,
            });
            return {
              token,
              delivered: Boolean(result?.delivered),
              terminal: Boolean(result?.terminal),
              error: result?.error || null,
            };
          } catch (sendError) {
            return {
              token,
              delivered: false,
              terminal: false,
              error: sendError?.message || 'FCM delivery failed',
            };
          }
        }),
      );
      outcomes.push(await markDelivered(row, results, { db }));
    } catch (stateError) {
      try {
        await updateOutbox(
          row,
          {
            status: row.attemptCount >= row.maxAttempts ? 'failed' : 'retry',
            locked_at: null,
            lease_token: null,
            last_error: cleanText(stateError?.message || 'Push outbox failed', 500),
            next_attempt_at: new Date(
              Date.now() + retryDelaySeconds(row.attemptCount) * 1000,
            ).toISOString(),
          },
          { db },
        );
      } catch {
        // The monitored worker reports the original state persistence failure.
      }
      throw stateError;
    }
  }
  return outcomes;
}

module.exports = {
  PUSH_OUTBOX_SCHEMA_MISSING_CODES,
  deliverPushOutbox,
  enqueuePushNotification,
  findPushOutboxByDedupeKey,
  normalizeOutbox,
  pushOutboxDedupeKey,
  retryDelaySeconds,
};

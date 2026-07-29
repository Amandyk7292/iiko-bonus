import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import { fileURLToPath } from 'url';
import { KASPI_QRPAY_URL } from './config.js';
import { signedQrPayHeaders } from './helpers.js';
import { decryptSecret } from './crypto.js';
import { clearActiveSession } from './activeSession.js';
import { isKaspiSessionExpired } from './kaspiResponse.js';
import { clearGlobalSession, getGlobalSession } from './sessionStorage.js';
import { getWebhooksByEvent } from './webhookStore.js';
import { logger } from './logger.js';
import { resolvePaymentEvent, shouldStopFastTracking, shouldStopPollingAfterFailures } from './paymentStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKED_FILE = process.env.KASPI_TRACKED_PAYMENTS_FILE || path.join(__dirname, '..', 'tracked-payments.json');

// ─── Tracked payments ───

const trackedPayments = new Map();
const DEFAULT_FAST_TRACKING_MAX_MS = 30 * 60 * 1000;
const MIN_FAST_TRACKING_MAX_MS = 5 * 60 * 1000;

const fastTrackingMaxMs = () => {
  const configured = Number(process.env.KASPI_FAST_TRACKING_MAX_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_FAST_TRACKING_MAX_MS;
  return Math.max(MIN_FAST_TRACKING_MAX_MS, Math.floor(configured));
};

const webhookId = (hook) =>
  String(hook?.id || '').trim() ||
  crypto
    .createHash('sha256')
    .update(String(hook?.url || ''), 'utf8')
    .digest('hex')
    .slice(0, 32);

// ─── Persistence ───

const writePrivateJson = (file, value) => {
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'w',
  });
  fs.chmodSync(temporary, 0o600);
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
};

const saveTracked = () => {
  try {
    writePrivateJson(TRACKED_FILE, Object.fromEntries(trackedPayments));
    return true;
  } catch (err) {
    logger.error('POLLING', 'Failed to save tracked payments', err.message);
    return false;
  }
};

const loadTracked = () => {
  try {
    if (!fs.existsSync(TRACKED_FILE)) return;
    const raw = fs.readFileSync(TRACKED_FILE, 'utf8');
    const data = JSON.parse(raw);
    let migrated = false;
    for (const [id, entry] of Object.entries(data)) {
      if (Array.isArray(entry?.terminalWebhookUrls)) {
        entry.terminalWebhookIds = entry.terminalWebhookUrls.map((url) => webhookId({ url }));
        delete entry.terminalWebhookUrls;
        migrated = true;
      }
      if (Array.isArray(entry?.deliveredWebhookUrls)) {
        entry.deliveredWebhookIds = entry.deliveredWebhookUrls.map((url) => webhookId({ url }));
        delete entry.deliveredWebhookUrls;
        migrated = true;
      }
      trackedPayments.set(id, entry);
    }
    if (migrated) saveTracked();
    if (trackedPayments.size > 0) {
      logger.info('POLLING', `Restored ${trackedPayments.size} tracked payments from file`);
    }
  } catch (err) {
    logger.error('POLLING', 'Failed to load tracked payments', err.message);
  }
};

// ─── Pending retries (persisted) ───

const RETRY_FILE = process.env.KASPI_WEBHOOK_RETRIES_FILE || path.join(__dirname, '..', 'webhook-retries.json');
let pendingRetries = [];
let webhookResolver = getWebhooksByEvent;

const saveRetries = () => {
  try {
    writePrivateJson(RETRY_FILE, pendingRetries);
    return true;
  } catch (err) {
    logger.error('WEBHOOK', 'Failed to save retries', err.message);
    return false;
  }
};

const normalizeRetry = (value) => {
  const savedHookId = String(value?.hook?.id || '').trim();
  const hookUrl = String(value?.hook?.url || '').trim();
  const payload = value?.payload;
  if (
    (!/^[a-f0-9]{32}$/i.test(savedHookId) && !/^https?:\/\//i.test(hookUrl)) ||
    !payload ||
    typeof payload !== 'object' ||
    !String(payload.event || '').trim() ||
    !String(payload.paymentId || '').trim()
  ) {
    return null;
  }
  return {
    hook: { id: savedHookId || webhookId({ url: hookUrl }) },
    payload,
    attempt: Math.max(1, Number(value.attempt) || 1),
    executeAfter: Math.max(0, Number(value.executeAfter) || Date.now()),
  };
};

const loadRetries = () => {
  try {
    if (!fs.existsSync(RETRY_FILE)) return;
    const raw = fs.readFileSync(RETRY_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    pendingRetries = (Array.isArray(parsed) ? parsed : []).map(normalizeRetry).filter(Boolean);
    // Rewrite legacy retry records immediately so previously persisted HMAC
    // secrets are removed and the queue gets private file permissions.
    saveRetries();
    if (pendingRetries.length > 0) {
      logger.info('WEBHOOK', `Restored ${pendingRetries.length} pending retries from file`);
    }
  } catch (err) {
    logger.error('WEBHOOK', 'Failed to load retries', err.message);
    pendingRetries = [];
  }
};

// ─── Track a payment ───

export const trackPayment = (paymentId, type, sessionHeaders, meta = {}) => {
  trackedPayments.set(String(paymentId), {
    paymentId: String(paymentId),
    type,
    status: type === 'qr' ? 'QrTokenCreated' : 'RemotePaymentCreated',
    sessionHeaders,
    meta,
    createdAt: Date.now(),
    retryCount: 0,
  });
  saveTracked();
  logger.info('POLLING', `Tracking ${type} payment ${paymentId}`);
};

// ─── Fetch status from Kaspi (quiet — no loggedFetch) ───

const fetchStatus = async (entry) => {
  const { paymentId, type } = entry;
  const sessionHeaders = getGlobalSession();

  if (!sessionHeaders) return { error: 'reauth_required' };

  let decryptedSecret;
  try {
    decryptedSecret = decryptSecret(sessionHeaders.vtokenSecret);
  } catch {
    clearActiveSession(sessionHeaders.tokenSN);
    clearGlobalSession('kaspi_session_decrypt_failed', sessionHeaders);
    logger.error('POLLING', `Failed to decrypt active Kaspi session for payment ${paymentId}`);
    return { error: 'reauth_required' };
  }

  const session = {
    tokenSN: sessionHeaders.tokenSN,
    decryptedSecret,
    profileId: sessionHeaders.profileId,
  };

  let url;
  if (type === 'qr') {
    url = `${KASPI_QRPAY_URL}/v02/kaspi-qr/status?qrOperationId=${paymentId}`;
  } else {
    url = `${KASPI_QRPAY_URL}/v01/remote/details?qrOperationId=${paymentId}`;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let resp;
    try {
      resp = await fetch(url, {
        headers: signedQrPayHeaders(url, session),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    const json = await resp.json().catch(() => ({}));
    if (isKaspiSessionExpired(json)) {
      clearActiveSession(sessionHeaders.tokenSN);
      clearGlobalSession('kaspi_session_expired', sessionHeaders);
      return { error: 'reauth_required' };
    }
    return json;
  } catch (err) {
    logger.error('POLLING', `Error fetching status for ${paymentId}:`, err.message);
    return null;
  }
};

// ─── Send webhooks ───

const fetchWithTimeout = async (url, options, timeoutMs = 10000) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return resp;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
};

const deliveryKey = (hook, payload) => `${webhookId(hook)}\n${payload.event}\n${String(payload.paymentId)}`;

const safeWebhookLabel = (hook) => {
  try {
    const parsed = new URL(String(hook?.url || ''));
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`;
  } catch {
    return 'configured webhook';
  }
};

const resolveConfiguredHook = (hook, payload) => {
  if (String(hook?.secret || '').length > 0) return hook;
  return webhookResolver(payload.event).find((candidate) => webhookId(candidate) === webhookId(hook));
};

const retryDelayMs = (attempt, retryAfter = '') => {
  const seconds = Number(retryAfter);
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(15 * 60 * 1000, Math.max(1000, Math.ceil(seconds * 1000)));
  }
  return Math.min(15 * 60 * 1000, 5000 * 2 ** Math.min(8, Math.max(0, attempt - 1)));
};

const upsertRetry = (hook, payload, attempt, retryAfter = '') => {
  const key = deliveryKey(hook, payload);
  const retry = {
    // Never persist the HMAC secret. It is resolved from the protected
    // webhook configuration immediately before each delivery attempt.
    hook: { id: webhookId(hook) },
    payload,
    attempt,
    executeAfter: Date.now() + retryDelayMs(attempt, retryAfter),
  };
  const index = pendingRetries.findIndex((entry) => deliveryKey(entry.hook, entry.payload) === key);
  if (index >= 0) pendingRetries[index] = retry;
  else pendingRetries.push(retry);
  saveRetries();
};

const removeRetry = (hook, payload) => {
  const key = deliveryKey(hook, payload);
  pendingRetries = pendingRetries.filter((entry) => deliveryKey(entry.hook, entry.payload) !== key);
  saveRetries();
};

const markTerminalHookDelivered = (payload, hook) => {
  const entry = trackedPayments.get(String(payload.paymentId));
  if (!entry || entry.terminalEvent !== payload.event) return true;
  entry.deliveredWebhookIds = [...new Set([...(entry.deliveredWebhookIds || []), webhookId(hook)])];
  return saveTracked();
};

const sendWebhook = async (hook, payload, attempt = 1) => {
  try {
    const configuredHook = resolveConfiguredHook(hook, payload);
    if (!configuredHook || String(configuredHook.secret || '').length < 1) {
      throw new Error('Webhook signing configuration is unavailable');
    }
    const body = JSON.stringify(payload);
    const signature = 'sha256=' + crypto.createHmac('sha256', configuredHook.secret).update(body).digest('hex');
    const resp = await fetchWithTimeout(configuredHook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body,
    });
    logger.info('WEBHOOK', `→ ${safeWebhookLabel(configuredHook)} | ${resp.status} ${resp.statusText}`);
    if (!resp.ok) {
      const error = new Error(`Webhook returned HTTP ${resp.status}`);
      error.retryAfter = resp.headers?.get?.('retry-after') || '';
      throw error;
    }
    if (!markTerminalHookDelivered(payload, configuredHook)) {
      throw new Error('Webhook acknowledgement could not be persisted');
    }
    removeRetry(hook, payload);
    return true;
  } catch (err) {
    logger.error('WEBHOOK', `→ ${safeWebhookLabel(hook)} | attempt ${attempt} FAILED: ${err.message}`);
    // A final payment notification is retained until the receiver confirms it
    // with a 2xx response. Backoff is capped, but retries are never discarded.
    upsertRetry(hook, payload, attempt + 1, err.retryAfter);
    return false;
  }
};

const sendWebhooks = async (event, payload, entry) => {
  const hooks = webhookResolver(event);
  entry.terminalWebhookIds = hooks.map(webhookId);
  entry.deliveredWebhookIds = entry.deliveredWebhookIds || [];
  delete entry.terminalWebhookUrls;
  delete entry.deliveredWebhookUrls;
  saveTracked();
  const results = await Promise.all(hooks.map((hook) => sendWebhook(hook, payload)));
  return results.every(Boolean);
};

// ─── Process pending retries ───

const rebuildTerminalRetries = () => {
  const existing = new Set(pendingRetries.map((retry) => deliveryKey(retry.hook, retry.payload)));
  let changed = false;
  for (const entry of trackedPayments.values()) {
    if (!entry.terminalEvent || !entry.terminalPayload) continue;
    const delivered = new Set(entry.deliveredWebhookIds || []);
    for (const id of entry.terminalWebhookIds || []) {
      if (delivered.has(id)) continue;
      const hook = { id: String(id) };
      const key = deliveryKey(hook, entry.terminalPayload);
      if (existing.has(key)) continue;
      pendingRetries.push({
        hook,
        payload: entry.terminalPayload,
        attempt: 1,
        executeAfter: Date.now(),
      });
      existing.add(key);
      changed = true;
    }
  }
  if (changed) saveRetries();
  return changed;
};

const processRetries = async () => {
  rebuildTerminalRetries();
  const now = Date.now();
  const due = pendingRetries.filter((r) => r.executeAfter <= now);
  for (const r of due) {
    const tracked = trackedPayments.get(String(r.payload.paymentId));
    if (tracked?.terminalEvent === r.payload.event && (tracked.deliveredWebhookIds || []).includes(webhookId(r.hook))) {
      removeRetry(r.hook, r.payload);
      continue;
    }
    await sendWebhook(r.hook, r.payload, r.attempt);
  }
  let changed = false;
  for (const [id, entry] of trackedPayments) {
    if (!entry.terminalEvent) continue;
    const expected = entry.terminalWebhookIds || [];
    const delivered = new Set(entry.deliveredWebhookIds || []);
    if (expected.every((hookReference) => delivered.has(hookReference))) {
      trackedPayments.delete(id);
      changed = true;
      logger.info('POLLING', `Terminal webhook delivery confirmed for payment ${id}`);
    }
  }
  if (changed) saveTracked();
};

// ─── Poll cycle ───

const pollOnce = async () => {
  let changed = false;

  if (!getGlobalSession()) {
    if (!pollPausedForReauth && trackedPayments.size > 0) {
      logger.warn('POLLING', 'Kaspi session requires SMS login; pending payments are preserved until reconnection');
    }
    pollPausedForReauth = true;
    return;
  }

  if (pollPausedForReauth) {
    pollPausedForReauth = false;
    logger.info('POLLING', 'Kaspi session restored; pending payment checks resumed automatically');
  }

  for (const [id, entry] of trackedPayments) {
    // Final provider state is already known. Only durable webhook delivery
    // remains, so never query Kaspi or discard this entry by polling TTL.
    if (entry.terminalEvent) continue;

    // TTL check via expireDate
    if (entry.meta.expireDate) {
      const expiry = new Date(entry.meta.expireDate).getTime();
      if (Date.now() > expiry && resolvePaymentEvent(entry.type, entry.status) === null) {
        logger.info('POLLING', `Payment ${id} expired (TTL)`);
        const event = 'payment.expired';
        const payload = buildPayload(event, entry, {
          Status: 'Expired',
          StatusDesc: 'Время оплаты истекло',
        });
        entry.terminalEvent = event;
        entry.terminalPayload = payload;
        const delivered = await sendWebhooks(event, payload, entry);
        if (delivered) trackedPayments.delete(id);
        changed = true;
        continue;
      }
    }

    if (!entry.meta.expireDate && shouldStopFastTracking(entry.createdAt, Date.now(), fastTrackingMaxMs())) {
      logger.info('POLLING', `Stopped fast tracking payment ${id}; background reconciliation remains active`);
      trackedPayments.delete(id);
      changed = true;
      continue;
    }

    const result = await fetchStatus(entry);

    // A replaced Kaspi session is an integration outage, not a failed client
    // payment. Preserve every pending operation and resume after SMS login.
    if (result && result.error === 'reauth_required') {
      if (!pollPausedForReauth) {
        logger.warn('POLLING', 'Kaspi session was revoked; pending payments are preserved until reconnection');
      }
      pollPausedForReauth = true;
      continue;
    }

    if (!result || !result.Data) {
      entry.retryCount++;
      if (shouldStopPollingAfterFailures(entry.retryCount)) {
        logger.warn('POLLING', `Removing payment ${id} after 10 failed attempts`);
        trackedPayments.delete(id);
        changed = true;
      }
      continue;
    }

    // Reset retry count on successful fetch
    entry.retryCount = 0;

    const newStatus = result.Data.Status;
    if (!newStatus) {
      entry.retryCount++;
      if (shouldStopPollingAfterFailures(entry.retryCount)) {
        logger.warn('POLLING', `Removing payment ${id} after 10 responses without a status`);
        trackedPayments.delete(id);
        changed = true;
      }
      continue;
    }
    if (newStatus === entry.status) continue;

    logger.info('POLLING', `Payment ${id}: ${entry.status} → ${newStatus}`);
    entry.status = newStatus;
    changed = true;

    const event = resolvePaymentEvent(entry.type, newStatus);
    if (event) {
      const payload = buildPayload(event, entry, result.Data);
      entry.terminalEvent = event;
      entry.terminalPayload = payload;
      const delivered = await sendWebhooks(event, payload, entry);
      if (delivered) trackedPayments.delete(id);
    }
  }

  if (changed) {
    saveTracked();
  }
};

const buildPayload = (event, entry, data) => ({
  event,
  paymentId: entry.paymentId,
  type: entry.type,
  status: data.Status || entry.status,
  statusDesc: data.StatusDesc || '',
  amount: entry.meta.amount || data.Amount || null,
  qrToken: entry.meta.qrToken || null,
  receiptUrl: entry.meta.receiptUrl || data.ReceiptUrl || null,
  orderNumber: entry.meta.orderNumber || data.OrderNumber || null,
  data,
  timestamp: new Date().toISOString(),
});

// ─── Polling loop (setTimeout-based, no overlap) ───

let pollActive = false;
let pollTimer = null;
let pollPausedForReauth = false;
const POLL_MS = 3000;

const scheduleNext = () => {
  if (!pollActive) return;
  pollTimer = setTimeout(async () => {
    try {
      if (trackedPayments.size > 0) {
        await pollOnce();
      }
      // Process pending webhook retries
      if (pendingRetries.length > 0) {
        await processRetries();
      }
    } catch (err) {
      logger.error('POLLING', 'Unexpected error:', err.message);
    }
    scheduleNext();
  }, POLL_MS);
};

export const startPolling = () => {
  if (pollActive) return;

  // Load persisted state
  loadTracked();
  loadRetries();
  rebuildTerminalRetries();

  pollActive = true;
  scheduleNext();
  logger.info('POLLING', 'Started (interval: 3s, persistence: enabled)');
};

export const stopPolling = () => {
  pollActive = false;
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  saveTracked();
  saveRetries();
  logger.info('POLLING', 'Stopped');
};

export const getTrackedPayments = () => Object.fromEntries(trackedPayments);
export const __test = {
  deliveryKey,
  loadTracked,
  loadRetries,
  pendingRetries: () => JSON.parse(JSON.stringify(pendingRetries)),
  processRetries,
  rebuildTerminalRetries,
  reset: () => {
    pendingRetries = [];
    trackedPayments.clear();
    webhookResolver = getWebhooksByEvent;
  },
  retryDelayMs,
  safeWebhookLabel,
  setWebhookResolver: (resolver) => {
    webhookResolver = resolver;
  },
  sendWebhook,
};

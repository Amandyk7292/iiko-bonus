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
import {
  resolvePaymentEvent,
  shouldStopFastTracking,
  shouldStopPollingAfterFailures,
} from './paymentStatus.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TRACKED_FILE = path.join(__dirname, '..', 'tracked-payments.json');

// ─── Tracked payments ───

const trackedPayments = new Map();
const DEFAULT_FAST_TRACKING_MAX_MS = 30 * 60 * 1000;
const MIN_FAST_TRACKING_MAX_MS = 5 * 60 * 1000;

const fastTrackingMaxMs = () => {
  const configured = Number(process.env.KASPI_FAST_TRACKING_MAX_MS);
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_FAST_TRACKING_MAX_MS;
  return Math.max(MIN_FAST_TRACKING_MAX_MS, Math.floor(configured));
};

// ─── Persistence ───

const saveTracked = () => {
  try {
    const data = Object.fromEntries(trackedPayments);
    fs.writeFileSync(TRACKED_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    logger.error('POLLING', 'Failed to save tracked payments', err.message);
  }
};

const loadTracked = () => {
  try {
    if (!fs.existsSync(TRACKED_FILE)) return;
    const raw = fs.readFileSync(TRACKED_FILE, 'utf8');
    const data = JSON.parse(raw);
    for (const [id, entry] of Object.entries(data)) {
      trackedPayments.set(id, entry);
    }
    if (trackedPayments.size > 0) {
      logger.info('POLLING', `Restored ${trackedPayments.size} tracked payments from file`);
    }
  } catch (err) {
    logger.error('POLLING', 'Failed to load tracked payments', err.message);
  }
};

// ─── Pending retries (persisted) ───

const RETRY_FILE = path.join(__dirname, '..', 'webhook-retries.json');
let pendingRetries = [];

const saveRetries = () => {
  try {
    fs.writeFileSync(RETRY_FILE, JSON.stringify(pendingRetries, null, 2));
  } catch (err) {
    logger.error('WEBHOOK', 'Failed to save retries', err.message);
  }
};

const loadRetries = () => {
  try {
    if (!fs.existsSync(RETRY_FILE)) return;
    const raw = fs.readFileSync(RETRY_FILE, 'utf8');
    pendingRetries = JSON.parse(raw);
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

const sendWebhook = async (hook, payload, attempt = 1) => {
  const body = JSON.stringify(payload);
  const signature =
    'sha256=' +
    crypto
      .createHmac('sha256', hook.secret || '')
      .update(body)
      .digest('hex');

  try {
    const resp = await fetchWithTimeout(hook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Webhook-Signature': signature,
      },
      body,
    });
    logger.info('WEBHOOK', `→ ${hook.url} | ${resp.status} ${resp.statusText}`);
    // Remove from pending retries on success
    pendingRetries = pendingRetries.filter(
      (r) =>
        !(r.hook.url === hook.url && r.payload.paymentId === payload.paymentId && r.payload.event === payload.event),
    );
    saveRetries();
  } catch (err) {
    logger.error('WEBHOOK', `→ ${hook.url} | attempt ${attempt} FAILED: ${err.message}`);
    if (attempt < 3) {
      // Save retry to disk so it survives restarts
      pendingRetries.push({
        hook,
        payload,
        attempt: attempt + 1,
        executeAfter: Date.now() + (attempt === 1 ? 5000 : 30000),
      });
      saveRetries();
    } else {
      logger.error('WEBHOOK', `→ ${hook.url} | FAILED after 3 retries`);
      // Remove from pending retries
      pendingRetries = pendingRetries.filter(
        (r) =>
          !(r.hook.url === hook.url && r.payload.paymentId === payload.paymentId && r.payload.event === payload.event),
      );
      saveRetries();
    }
  }
};

const sendWebhooks = (event, payload) => {
  const hooks = getWebhooksByEvent(event);
  for (const hook of hooks) {
    sendWebhook(hook, payload);
  }
};

// ─── Process pending retries ───

const processRetries = async () => {
  const now = Date.now();
  const due = pendingRetries.filter((r) => r.executeAfter <= now);
  // Remove due items from list before executing (they'll be re-added on failure)
  pendingRetries = pendingRetries.filter((r) => r.executeAfter > now);
  saveRetries();

  for (const r of due) {
    await sendWebhook(r.hook, r.payload, r.attempt);
  }
};

// ─── Poll cycle ───

const pollOnce = async () => {
  let changed = false;

  if (!getGlobalSession()) {
    if (!pollPausedForReauth && trackedPayments.size > 0) {
      logger.warn(
        'POLLING',
        'Kaspi session requires SMS login; pending payments are preserved until reconnection',
      );
    }
    pollPausedForReauth = true;
    return;
  }

  if (pollPausedForReauth) {
    pollPausedForReauth = false;
    logger.info('POLLING', 'Kaspi session restored; pending payment checks resumed automatically');
  }

  for (const [id, entry] of trackedPayments) {
    // TTL check via expireDate
    if (entry.meta.expireDate) {
      const expiry = new Date(entry.meta.expireDate).getTime();
      if (Date.now() > expiry && resolvePaymentEvent(entry.type, entry.status) === null) {
        logger.info('POLLING', `Payment ${id} expired (TTL)`);
        sendWebhooks(
          'payment.expired',
          buildPayload('payment.expired', entry, { Status: 'Expired', StatusDesc: 'Время оплаты истекло' }),
        );
        trackedPayments.delete(id);
        changed = true;
        continue;
      }
    }

    if (
      !entry.meta.expireDate &&
      shouldStopFastTracking(entry.createdAt, Date.now(), fastTrackingMaxMs())
    ) {
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
        logger.warn(
          'POLLING',
          'Kaspi session was revoked; pending payments are preserved until reconnection',
        );
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
      sendWebhooks(event, buildPayload(event, entry, result.Data));
      trackedPayments.delete(id);
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

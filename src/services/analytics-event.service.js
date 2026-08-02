const crypto = require('crypto');
const { supabase } = require('../config/supabase');

const EVENT_TYPES = new Set([
  'app_open',
  'catalog_view',
  'product_view',
  'add_to_cart',
  'remove_from_cart',
  'checkout_started',
  'checkout_quote',
  'payment_started',
  'payment_paid',
  'payment_failed',
  'payment_cancelled',
  'search',
  'promotion_view',
]);
const EVENT_TYPE_ALIASES = new Map([
  ['checkout_start', 'checkout_started'],
  ['payment_created', 'payment_started'],
]);

const normalizeEventType = (value) => {
  const eventType = String(value || '').trim();
  return EVENT_TYPE_ALIASES.get(eventType) || eventType;
};

const analyticsError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const cleanId = (value, max = 100) =>
  String(value || '')
    .trim()
    .slice(0, max) || null;

const cleanUuid = (value) => {
  const normalized = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    normalized,
  )
    ? normalized
    : crypto.randomUUID();
};

const cleanProperties = (raw) => {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result = {};
  for (const [key, value] of Object.entries(raw).slice(0, 20)) {
    const safeKey = String(key)
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 40);
    if (!safeKey) continue;
    if (typeof value === 'string') result[safeKey] = value.slice(0, 240);
    else if (typeof value === 'number' && Number.isFinite(value)) result[safeKey] = value;
    else if (typeof value === 'boolean' || value === null) result[safeKey] = value;
  }
  return result;
};

async function recordCustomerEvents(customerId, events, req) {
  if (!Array.isArray(events) || events.length === 0 || events.length > 20) {
    throw analyticsError('Отправьте от 1 до 20 событий');
  }
  const sessionSeed = String(req?.headers?.['x-bulka-session'] || '').slice(0, 128);
  const anonymousSessionId = sessionSeed
    ? crypto.createHash('sha256').update(sessionSeed).digest('hex')
    : null;
  const rows = events.map((event) => {
    const eventType = normalizeEventType(event?.type || event?.eventType);
    if (!EVENT_TYPES.has(eventType)) throw analyticsError('Некорректный тип события');
    const occurredAt = event?.occurredAt ? new Date(event.occurredAt) : new Date();
    if (
      Number.isNaN(occurredAt.getTime()) ||
      Math.abs(Date.now() - occurredAt.getTime()) > 86400000
    ) {
      throw analyticsError('Некорректное время события');
    }
    return {
      client_event_id: cleanUuid(event?.eventId),
      customer_id: customerId,
      anonymous_session_id: anonymousSessionId,
      event_type: eventType,
      product_id: cleanId(event?.productId),
      category_id: cleanId(event?.categoryId),
      branch_id: cleanId(event?.branchId, 36),
      order_id: cleanId(event?.orderId, 36),
      properties: cleanProperties(event?.properties),
      occurred_at: occurredAt.toISOString(),
    };
  });
  const { error } = await supabase
    .from('customer_app_events')
    .upsert(rows, { onConflict: 'client_event_id', ignoreDuplicates: true });
  if (error) throw error;
  return rows.length;
}

async function recordSystemEvent(customerId, event) {
  const eventType = normalizeEventType(event?.type || event?.eventType);
  if (!EVENT_TYPES.has(eventType)) throw analyticsError('Некорректный тип события');
  const row = {
    client_event_id: cleanUuid(event?.eventId),
    customer_id: customerId || null,
    event_type: eventType,
    product_id: cleanId(event?.productId),
    category_id: cleanId(event?.categoryId),
    branch_id: cleanId(event?.branchId, 36),
    order_id: cleanId(event?.orderId, 36),
    properties: cleanProperties(event?.properties),
    occurred_at: new Date().toISOString(),
  };
  const { error } = await supabase
    .from('customer_app_events')
    .upsert(row, { onConflict: 'client_event_id', ignoreDuplicates: true });
  if (error?.code === '23505') return false;
  if (error) throw error;
  return true;
}

module.exports = { EVENT_TYPES, normalizeEventType, recordCustomerEvents, recordSystemEvent };

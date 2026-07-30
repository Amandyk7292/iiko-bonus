const crypto = require('crypto');

const subscribers = new Map();
const eventHistory = [];
const MAX_HISTORY = 250;
let sequence = 0;

const writeEvent = (response, event) => {
  if (event.id !== undefined && event.id !== null) response.write(`id: ${event.id}\n`);
  response.write(`event: ${event.type}\n`);
  response.write(
    `data: ${JSON.stringify({
      id: event.id,
      type: event.type,
      occurredAt: event.occurredAt,
      data: event.data,
    })}\n\n`,
  );
};

const eventArea = (type) => {
  const prefix = String(type || '').split('.')[0];
  return (
    {
      order: 'orders',
      delivery: 'dispatch',
      courier: 'couriers',
      menu: 'menu',
      locations: 'locations',
      review: 'reviews',
      support: 'support',
      whatsapp: 'whatsapp',
      loyalty: 'customers',
      customer: 'customers',
      transaction: 'transactions',
      analytics: 'analytics',
      operations: 'operations',
      integrations: 'integrations',
    }[prefix] || ''
  );
};

const adminCanReceiveArea = (subscriber, type) => {
  const areas = Array.isArray(subscriber.areas) ? subscriber.areas : [];
  if (areas.includes('*')) return true;
  const area = eventArea(type);
  return Boolean(area && areas.includes(area));
};

const branchMatches = (subscriber, branchId) => {
  if (!branchId) return true;
  const requested = String(branchId);
  const selectedBranchIds = Array.isArray(subscriber.selectedBranchIds)
    ? subscriber.selectedBranchIds.map(String)
    : [];
  if (selectedBranchIds.length) return selectedBranchIds.includes(requested);
  if (subscriber.selectedBranchId) return String(subscriber.selectedBranchId) === requested;
  if (subscriber.globalBranchAccess) return true;
  const branchIds = Array.isArray(subscriber.branchIds) ? subscriber.branchIds.map(String) : [];
  return branchIds.includes(requested);
};

const canReceive = (subscriber, event) => {
  const audience = event.audience || {};
  if (subscriber.admin) {
    if (!(audience.adminOnly || audience.includeAdmins || audience.broadcast)) return false;
    if (
      Array.isArray(audience.roles) &&
      audience.roles.length &&
      !audience.roles.includes(String(subscriber.role || ''))
    ) {
      return false;
    }
    return (
      adminCanReceiveArea(subscriber, event.type) && branchMatches(subscriber, audience.branchId)
    );
  }
  if (!subscriber.customerId || audience.adminOnly) return false;
  if (audience.broadcast) return true;
  return Boolean(
    audience.customerId && String(audience.customerId) === String(subscriber.customerId),
  );
};

function publish(type, data = {}, audience = {}) {
  const normalizedAudience =
    audience && Object.keys(audience).length ? { ...audience } : { adminOnly: true };
  const event = {
    id: String(++sequence),
    type: String(type),
    occurredAt: new Date().toISOString(),
    data,
    audience: normalizedAudience,
  };
  eventHistory.push(event);
  if (eventHistory.length > MAX_HISTORY) eventHistory.splice(0, eventHistory.length - MAX_HISTORY);
  for (const subscriber of subscribers.values()) {
    if (!canReceive(subscriber, event)) continue;
    try {
      writeEvent(subscriber.response, event);
    } catch {
      subscriber.close();
    }
  }
  return event;
}

function openStream(req, res, identity = {}) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate',
    Connection: 'keep-alive',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n');

  const id = crypto.randomUUID();
  let heartbeat = null;
  const close = () => {
    if (heartbeat) clearInterval(heartbeat);
    subscribers.delete(id);
    if (!res.writableEnded) res.end();
  };
  const subscriber = {
    response: res,
    customerId: identity.customerId || null,
    admin: identity.admin === true,
    role: identity.role || null,
    areas: Array.isArray(identity.areas) ? identity.areas.map(String) : [],
    branchIds: Array.isArray(identity.branchIds) ? identity.branchIds.map(String) : [],
    selectedBranchId: identity.selectedBranchId || null,
    selectedBranchIds: Array.isArray(identity.selectedBranchIds)
      ? identity.selectedBranchIds.map(String)
      : [],
    globalBranchAccess: identity.globalBranchAccess === true,
    close,
  };
  subscribers.set(id, subscriber);

  const lastEventId = Number.parseInt(
    String(req.get?.('last-event-id') || req.query?.lastEventId || ''),
    10,
  );
  if (Number.isFinite(lastEventId) && lastEventId >= 0) {
    for (const event of eventHistory) {
      if (Number(event.id) > lastEventId && canReceive(subscriber, event)) writeEvent(res, event);
    }
  }
  writeEvent(res, {
    id: String(sequence),
    type: 'connected',
    occurredAt: new Date().toISOString(),
    data: { ready: true },
  });

  heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return close();
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      close();
    }
  }, 20000);
  heartbeat.unref?.();
  req.on('close', close);
}

function activeConnections({ admin = null } = {}) {
  if (admin === null) return subscribers.size;
  return [...subscribers.values()].filter((subscriber) => subscriber.admin === admin).length;
}

function resetForTests() {
  for (const subscriber of subscribers.values()) subscriber.close();
  subscribers.clear();
  eventHistory.length = 0;
  sequence = 0;
}

module.exports = { activeConnections, canReceive, openStream, publish, resetForTests };

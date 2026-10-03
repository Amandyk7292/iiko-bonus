const crypto = require('crypto');

const subscribers = new Map();
const eventHistory = [];
const MAX_HISTORY = 250;
const MAX_PENDING = MAX_HISTORY * 2;
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
  response.flush?.();
};

const eventArea = (type) => {
  const prefix = String(type || '').split('.')[0];
  return (
    {
      order: 'orders',
      delivery: 'dispatch',
      courier: 'couriers',
      menu: 'menu',
      inventory: 'staff',
      locations: 'locations',
      'photo-reports': 'photo-reports',
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
  if (subscriber.public) {
    return event.type === 'client.data.changed' && audience.public === true;
  }
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
    subscriber.deliver(event);
  }
  // Service/job driven updates use the same public invalidation channel.
  if (type === 'menu.updated')
    publishClientChange(['menu'], {
      inventory: data.inventory === true,
      // Photos and other menu overrides apply to every branch of the profile.
      // Only inventory changes are limited to the originating bakery.
      branchId: data.inventory === true ? data.branchId || audience.branchId : undefined,
      profileKey: data.inventory === true ? undefined : data.profileKey,
    });
  if (type === 'menu.updated' && data.inventory === true) {
    publish(
      'inventory.updated',
      { branchId: data.branchId || null },
      { adminOnly: true, branchId: data.branchId || audience.branchId || null },
    );
  }
  if (type === 'order.created' || type === 'order.updated')
    publishClientChange(['menu'], {
      inventory: true,
      branchId: data.branchId || audience.branchId,
    });
  if (type === 'locations.updated') publishClientChange(['locations', 'menu']);
  return event;
}

function publishClientChange(domains, scope = {}) {
  const allowed = new Set([
    'menu',
    'locations',
    'content',
    'contacts',
    'rewards',
    'settings',
    'loyalty',
    'checkout',
    'notifications',
  ]);
  const safe = [...new Set(domains)].filter((domain) => allowed.has(domain));
  if (!safe.length) return null;
  const data = { domains: safe };
  if (scope.inventory === true) data.inventory = true;
  if (typeof scope.branchId === 'string' && scope.branchId.length <= 100)
    data.branchId = scope.branchId;
  if (typeof scope.profileKey === 'string' && /^[a-z0-9_-]{1,64}$/.test(scope.profileKey))
    data.profileKey = scope.profileKey;
  return publish('client.data.changed', data, { public: true, broadcast: true });
}

function openStream(req, res, identity = {}) {
  res.status(200);
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-store, must-revalidate, no-transform',
    Connection: 'keep-alive',
    'Content-Encoding': 'identity',
    'X-Accel-Buffering': 'no',
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n');

  const id = crypto.randomUUID();
  let heartbeat = null;
  let expiryTimer = null;
  let closed = false;
  let pending = 0;
  let deliveryTail = Promise.resolve();
  const close = () => {
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    if (expiryTimer) clearTimeout(expiryTimer);
    subscribers.delete(id);
    if (!res.writableEnded) res.end();
  };
  const subscriber = {
    response: res,
    customerId: identity.customerId || null,
    public: identity.public === true,
    admin: identity.admin === true,
    role: identity.role || null,
    areas: Array.isArray(identity.areas) ? identity.areas.map(String) : [],
    branchIds: Array.isArray(identity.branchIds) ? identity.branchIds.map(String) : [],
    selectedBranchId: identity.selectedBranchId || null,
    selectedBranchIds: Array.isArray(identity.selectedBranchIds)
      ? identity.selectedBranchIds.map(String)
      : [],
    globalBranchAccess: identity.globalBranchAccess === true,
    sessionJti: identity.sessionJti || null,
    adminSubject: identity.adminSubject || null,
    expiresAt: identity.expiresAt || null,
    close,
  };
  const expired = () => subscriber.expiresAt && Date.parse(subscriber.expiresAt) <= Date.now();
  const scheduleExpiry = () => {
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!subscriber.expiresAt) return;
    const remaining = Date.parse(subscriber.expiresAt) - Date.now();
    if (!Number.isFinite(remaining) || remaining <= 0) return close();
    expiryTimer = setTimeout(
      () => {
        if (expired()) close();
        else scheduleExpiry();
      },
      Math.min(remaining, 2147483647),
    );
    expiryTimer.unref?.();
  };
  const enqueue = (operation) => {
    if (closed || res.writableEnded || res.destroyed || expired()) return close();
    if (++pending > MAX_PENDING) return close();
    deliveryTail = deliveryTail
      .then(async () => {
        if (closed || res.writableEnded || res.destroyed || expired()) return close();
        if (typeof identity.authorize === 'function') {
          const current = await identity.authorize();
          if (closed) return;
          if (!current) return close();
          for (const key of [
            'role',
            'areas',
            'branchIds',
            'selectedBranchId',
            'selectedBranchIds',
            'globalBranchAccess',
            'expiresAt',
          ]) {
            if (Object.hasOwn(current, key)) subscriber[key] = current[key];
          }
          if (expired()) return close();
          scheduleExpiry();
        }
        operation();
      })
      .catch(close)
      .finally(() => pending--);
  };
  subscriber.deliver = (event, filter = true) => {
    const audience = event.audience || {};
    if (
      filter &&
      subscriber.admin &&
      !(audience.adminOnly || audience.includeAdmins || audience.broadcast)
    )
      return;
    // Public invalidations have no admin data or permission area. They do not
    // need a session lookup for each connected administrator.
    if (filter && subscriber.admin && event.type === 'client.data.changed') return;
    const write = () => {
      if (!filter || canReceive(subscriber, event)) writeEvent(res, event);
    };
    if (typeof identity.authorize === 'function') return enqueue(write);
    if (closed || expired()) return close();
    try {
      write();
    } catch {
      close();
    }
  };
  subscribers.set(id, subscriber);
  scheduleExpiry();
  if (closed) return;

  const lastEventId = Number.parseInt(
    String(req.get?.('last-event-id') || req.query?.lastEventId || ''),
    10,
  );
  if (Number.isFinite(lastEventId) && lastEventId >= 0) {
    for (const event of eventHistory) {
      if (Number(event.id) > lastEventId) subscriber.deliver(event);
    }
  }
  subscriber.deliver(
    {
      id: String(sequence),
      type: 'connected',
      occurredAt: new Date().toISOString(),
      data: { ready: true },
    },
    false,
  );

  heartbeat = setInterval(() => {
    if (res.writableEnded || res.destroyed) return close();
    const ping = () => {
      res.write(`: heartbeat ${Date.now()}\n\n`);
      res.flush?.();
    };
    if (typeof identity.authorize === 'function') return enqueue(ping);
    try {
      ping();
    } catch {
      close();
    }
  }, 20000);
  heartbeat.unref?.();
  req.on('close', close);
}

function closeAdminStreams({ jti, subject } = {}) {
  if (!jti && !subject) return;
  for (const subscriber of subscribers.values()) {
    if (
      subscriber.admin &&
      ((jti && subscriber.sessionJti === jti) || (subject && subscriber.adminSubject === subject))
    )
      subscriber.close();
  }
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

module.exports = {
  activeConnections,
  canReceive,
  closeAdminStreams,
  openStream,
  publish,
  publishClientChange,
  resetForTests,
};

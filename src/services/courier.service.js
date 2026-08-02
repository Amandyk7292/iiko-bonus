const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { buildWhatsAppContact } = require('../utils/whatsapp.util');
const otpStore = require('./otpStore.service');
const { sendPushToCustomer } = require('./push.service');
const { sendOrderLiveActivity } = require('./live-activity.service');
const { refreshOrderEta } = require('./eta.service');
const realtime = require('./realtime.service');

const courierError = (message, statusCode = 400, code = null) =>
  Object.assign(new Error(message), { statusCode, ...(code && { code }) });

const DELIVERY_TRANSITIONS = {
  unassigned: ['assigned', 'cancelled'],
  assigned: ['picked_up', 'en_route', 'cancelled'],
  picked_up: ['en_route', 'cancelled'],
  en_route: ['cancelled'],
  delivered: [],
  cancelled: [],
};

const cleanPhone = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  const normalized =
    digits.length === 11 && digits.startsWith('8') ? `7${digits.slice(1)}` : digits;
  if (!/^7\d{10}$/.test(normalized)) throw courierError('Введите номер курьера в формате +7');
  return `+${normalized}`;
};

const phoneDigits = (value) => cleanPhone(value).slice(1);
const otpKey = (phone) => `courier_${phoneDigits(phone)}`;
const COURIER_LOGIN_TTL_MS = 5 * 60 * 1000;
const sha256 = (value) =>
  crypto
    .createHash('sha256')
    .update(String(value || ''))
    .digest('hex');
const sessionHours = () => {
  const configured = Number(process.env.COURIER_SESSION_HOURS || 12);
  return Number.isFinite(configured) ? Math.min(72, Math.max(1, Math.floor(configured))) : 12;
};

const courierUrl = () => {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '');
  return base ? `${base}/courier` : '/courier';
};

const normalizeCourier = (row, sessionCount = 0) => ({
  id: String(row.id),
  name: row.name,
  phone: row.phone,
  vehicle: row.vehicle || null,
  active: row.active !== false,
  latitude: row.current_latitude == null ? null : Number(row.current_latitude),
  longitude: row.current_longitude == null ? null : Number(row.current_longitude),
  locationUpdatedAt: row.location_updated_at || null,
  availabilityStatus: row.availability_status || 'offline',
  maxActiveOrders: Number(row.max_active_orders || 3),
  activeSessions: Number(sessionCount || 0),
  lastLoginAt: row.last_login_at || null,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  accessUrl: courierUrl(),
});

const safeMetadata = (metadata) => {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};
  const serialized = JSON.stringify(metadata);
  return serialized.length <= 4000 ? JSON.parse(serialized) : {};
};

async function recordCourierEvent({
  courierId,
  sessionId = null,
  orderId = null,
  eventType,
  latitude = null,
  longitude = null,
  metadata = {},
}) {
  const { error } = await supabase.from('courier_route_events').insert({
    courier_id: courierId,
    session_id: sessionId,
    order_id: orderId,
    event_type: String(eventType || '').slice(0, 32),
    latitude,
    longitude,
    metadata: safeMetadata(metadata),
  });
  if (error) throw error;
}

async function requestCourierLogin(rawPhone) {
  const phone = cleanPhone(rawPhone);
  const { data: courier, error } = await supabase
    .from('couriers')
    .select('id,active')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;

  const requestToken = crypto.randomBytes(18).toString('base64url');
  const expiresAtMs = Date.now() + COURIER_LOGIN_TTL_MS;
  const expiresAt = new Date(expiresAtMs).toISOString();
  const contact = buildWhatsAppContact(requestToken);
  if (!contact.whatsappUrl) {
    throw courierError('WhatsApp-бот временно недоступен', 503, 'COURIER_BOT_UNAVAILABLE');
  }

  // Unknown numbers receive the exact same public response. Only registered
  // couriers get a server-side challenge, so the endpoint cannot enumerate staff.
  if (courier) {
    const { error: cleanupError } = await supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('data->>purpose', 'courier_login')
      .eq('data->>phone', phone);
    if (cleanupError) throw cleanupError;
    const { error: challengeError } = await supabase.from('whatsapp_sessions').insert({
      id: `token_${requestToken}`,
      data: {
        phone,
        purpose: 'courier_login',
        courierId: courier.id,
        expires: expiresAtMs,
      },
      expires_at: expiresAt,
    });
    if (challengeError) throw challengeError;
  }

  return {
    accepted: true,
    channel: 'whatsapp_user_initiated',
    requestToken,
    expiresAt,
    expiresIn: 300,
    whatsappPhone: contact.whatsappPhone,
    whatsappUrl: contact.whatsappUrl,
  };
}

const parseSessionData = (value) => {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

async function consumeCourierBotRequest(rawToken, rawSenderDigits) {
  const token = String(rawToken || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { status: 'not_courier' };
  const sessionId = `token_${token}`;
  const { data: session, error } = await supabase
    .from('whatsapp_sessions')
    .select('data,expires_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;
  const request = parseSessionData(session?.data);
  if (!request || request.purpose !== 'courier_login') return { status: 'not_courier' };

  if (
    Number(request.expires || 0) <= Date.now() ||
    !session.expires_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    await supabase.from('whatsapp_sessions').delete().eq('id', sessionId);
    return { status: 'expired' };
  }

  const senderDigits = String(rawSenderDigits || '').replace(/\D/g, '');
  const requestedDigits = phoneDigits(request.phone);
  if (!senderDigits || senderDigits.slice(-10) !== requestedDigits.slice(-10)) {
    return { status: 'phone_mismatch' };
  }

  // Claim and delete the challenge in one database statement. A repeated bot
  // message cannot mint another OTP from the same identifier.
  const { data: claimed, error: claimError } = await supabase
    .from('whatsapp_sessions')
    .delete()
    .eq('id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .select('data')
    .maybeSingle();
  if (claimError) throw claimError;
  const claimedRequest = parseSessionData(claimed?.data);
  if (!claimedRequest) return { status: 'expired' };

  const { data: courier, error: courierReadError } = await supabase
    .from('couriers')
    .select('id,phone,active')
    .eq('id', claimedRequest.courierId)
    .eq('phone', request.phone)
    .eq('active', true)
    .maybeSingle();
  if (courierReadError) throw courierReadError;
  if (!courier) return { status: 'unavailable' };

  const code = crypto.randomInt(100000, 1000000).toString();
  await otpStore.set(otpKey(request.phone), {
    code,
    attempts: 0,
    purpose: 'courier_login',
    courierId: courier.id,
    expires: Date.now() + COURIER_LOGIN_TTL_MS,
  });
  return { status: 'success', code, expiresIn: 300 };
}

async function verifyCourierLogin(rawPhone, rawCode, { ip = '', userAgent = '' } = {}) {
  const phone = cleanPhone(rawPhone);
  const code = String(rawCode || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw courierError('Введите шестизначный код');
  const key = otpKey(phone);
  const storedOtp = await otpStore.get(key);
  const consumed = await otpStore.consume(key, code);
  if (consumed.status === 'attempts_exceeded') {
    throw courierError('Слишком много попыток. Запросите новый код.', 429);
  }
  if (consumed.status !== 'success') {
    throw courierError(
      consumed.status === 'expired' ? 'Код истёк. Запросите новый.' : 'Неверный код',
      401,
    );
  }

  const { data: courier, error } = await supabase
    .from('couriers')
    .select('*')
    .eq('phone', phone)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!courier || String(storedOtp?.courierId || '') !== String(courier.id)) {
    throw courierError('Учётная запись курьера недоступна', 401);
  }

  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + sessionHours() * 60 * 60 * 1000).toISOString();
  const { data: session, error: sessionError } = await supabase
    .from('courier_auth_sessions')
    .insert({
      courier_id: courier.id,
      token_hash: sha256(token),
      auth_version: Number(courier.auth_version || 1),
      expires_at: expiresAt,
      last_used_at: new Date().toISOString(),
      ip_hash: ip ? sha256(ip) : null,
      user_agent_hash: userAgent ? sha256(userAgent) : null,
    })
    .select('*')
    .single();
  if (sessionError) throw sessionError;
  await supabase
    .from('couriers')
    .update({
      last_login_at: new Date().toISOString(),
      availability_status: 'available',
      updated_at: new Date().toISOString(),
    })
    .eq('id', courier.id);
  await recordCourierEvent({
    courierId: courier.id,
    sessionId: session.id,
    eventType: 'login',
  }).catch((eventError) => console.error('Courier login event failed:', eventError.message));
  return { token, expiresAt, courier: normalizeCourier(courier, 1), sessionId: session.id };
}

async function authenticateCourier(token) {
  const cleanToken = String(token || '').trim();
  if (cleanToken.length < 32) throw courierError('Сессия курьера недействительна', 401);
  const now = new Date().toISOString();
  const { data: session, error: sessionError } = await supabase
    .from('courier_auth_sessions')
    .select('*')
    .eq('token_hash', sha256(cleanToken))
    .is('revoked_at', null)
    .gt('expires_at', now)
    .maybeSingle();
  if (sessionError) throw sessionError;
  if (!session) throw courierError('Сессия курьера истекла. Войдите снова.', 401);
  const { data: courier, error } = await supabase
    .from('couriers')
    .select('*')
    .eq('id', session.courier_id)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (!courier || Number(courier.auth_version || 1) !== Number(session.auth_version)) {
    throw courierError('Сессия курьера отозвана. Войдите снова.', 401);
  }
  const lastUsed = session.last_used_at ? new Date(session.last_used_at).getTime() : 0;
  if (Date.now() - lastUsed > 60_000) {
    await supabase
      .from('courier_auth_sessions')
      .update({ last_used_at: now })
      .eq('id', session.id)
      .is('revoked_at', null);
  }
  return { courier, session };
}

async function revokeCourierSession(courierId, sessionId) {
  const now = new Date().toISOString();
  await supabase
    .from('courier_auth_sessions')
    .update({ revoked_at: now })
    .eq('id', sessionId)
    .eq('courier_id', courierId)
    .is('revoked_at', null);
  await recordCourierEvent({
    courierId,
    sessionId,
    eventType: 'logout',
  }).catch(() => {});
}

async function revokeCourierSessions(courierId, reason = 'admin') {
  const { data: courier, error: readError } = await supabase
    .from('couriers')
    .select('id,auth_version')
    .eq('id', courierId)
    .maybeSingle();
  if (readError) throw readError;
  if (!courier) throw courierError('Курьер не найден', 404);
  const now = new Date().toISOString();
  const { error } = await supabase
    .from('courier_auth_sessions')
    .update({ revoked_at: now })
    .eq('courier_id', courierId)
    .is('revoked_at', null);
  if (error) throw error;
  await supabase
    .from('couriers')
    .update({ auth_version: Number(courier.auth_version || 1) + 1, updated_at: now })
    .eq('id', courierId);
  await recordCourierEvent({
    courierId,
    eventType: 'sessions_revoked',
    metadata: { reason: String(reason).slice(0, 160) },
  }).catch(() => {});
  return true;
}

async function listCourierOrders(courierId) {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select(
      'id,order_number,branch_name,delivery_address,delivery_latitude,delivery_longitude,delivery_status,estimated_delivery_at,eta_min_at,eta_max_at,eta_confidence,cart_items,comment,amount,additional_phone,phone,updated_at',
    )
    .eq('courier_id', courierId)
    .eq('status', 'paid')
    .not('delivery_status', 'in', '(delivered,cancelled)')
    .order('estimated_delivery_at', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return (data || []).map((order) => ({
    id: String(order.id),
    number: Number(order.order_number || 0),
    branch: order.branch_name || '',
    deliveryAddress: order.delivery_address || null,
    deliveryLatitude: order.delivery_latitude == null ? null : Number(order.delivery_latitude),
    deliveryLongitude: order.delivery_longitude == null ? null : Number(order.delivery_longitude),
    deliveryStatus: order.delivery_status || 'assigned',
    estimatedDeliveryAt: order.estimated_delivery_at || null,
    etaMinAt: order.eta_min_at || null,
    etaMaxAt: order.eta_max_at || null,
    etaConfidence: order.eta_confidence || null,
    items: Array.isArray(order.cart_items) ? order.cart_items : [],
    comment: order.comment || null,
    customerPhone: order.additional_phone || order.phone || null,
    amount: Number(order.amount || 0),
    updatedAt: order.updated_at,
  }));
}

async function updateCourierOrderStatus(courierId, orderId, status, sessionId = null) {
  if (status === 'delivered') {
    throw courierError(
      'Для завершения доставки введите PIN клиента и приложите фото.',
      409,
      'DELIVERY_PROOF_REQUIRED',
    );
  }
  const { data: order, error } = await supabase
    .from('kaspi_orders')
    .select('courier_id')
    .eq('id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!order || String(order.courier_id || '') !== String(courierId)) {
    throw courierError('Заказ не назначен этому курьеру', 403);
  }
  const updated = await updateDeliveryStatus(orderId, status);
  await recordCourierEvent({
    courierId,
    sessionId,
    orderId,
    eventType: 'status_changed',
    metadata: { status },
  });
  return updated;
}

async function listCouriers({ includeInactive = true } = {}) {
  let query = supabase
    .from('couriers')
    .select('*')
    .order('active', { ascending: false })
    .order('name');
  if (!includeInactive) query = query.eq('active', true);
  const [{ data, error }, { data: sessions, error: sessionError }] = await Promise.all([
    query,
    supabase
      .from('courier_auth_sessions')
      .select('courier_id')
      .is('revoked_at', null)
      .gt('expires_at', new Date().toISOString()),
  ]);
  if (error) throw error;
  if (sessionError) throw sessionError;
  const counts = new Map();
  for (const session of sessions || []) {
    counts.set(String(session.courier_id), (counts.get(String(session.courier_id)) || 0) + 1);
  }
  return (data || []).map((row) => normalizeCourier(row, counts.get(String(row.id)) || 0));
}

async function saveCourier(payload = {}, id = null) {
  const name = String(payload.name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .slice(0, 160);
  if (name.length < 2) throw courierError('Укажите имя курьера');
  const phone = cleanPhone(payload.phone);
  let previous = null;
  if (id) {
    const { data, error } = await supabase.from('couriers').select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) throw courierError('Курьер не найден', 404);
    previous = data;
  }
  const invalidateSessions =
    Boolean(previous) && (previous.phone !== phone || payload.active === false);
  const record = {
    name,
    phone,
    vehicle:
      String(payload.vehicle || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 80) || null,
    active: payload.active !== false,
    availability_status: ['offline', 'available', 'busy', 'break'].includes(
      payload.availabilityStatus,
    )
      ? payload.availabilityStatus
      : payload.active === false
        ? 'offline'
        : 'available',
    max_active_orders: Math.min(20, Math.max(1, Number(payload.maxActiveOrders || 3))),
    ...(invalidateSessions ? { auth_version: Number(previous.auth_version || 1) + 1 } : {}),
    updated_at: new Date().toISOString(),
  };
  const query = id
    ? supabase.from('couriers').update(record).eq('id', id)
    : supabase.from('couriers').insert(record);
  const { data, error } = await query.select().maybeSingle();
  if (error?.code === '23505') throw courierError('Курьер с таким номером уже существует', 409);
  if (error) throw error;
  if (!data) throw courierError('Курьер не найден', 404);
  if (invalidateSessions) {
    await supabase
      .from('courier_auth_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('courier_id', data.id)
      .is('revoked_at', null);
  }
  return normalizeCourier(data, 0);
}

async function setCourierActive(id, active) {
  if (typeof active !== 'boolean') throw courierError('Некорректный статус курьера');
  const { data: current, error: currentError } = await supabase
    .from('couriers')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (currentError) throw currentError;
  if (!current) throw courierError('Курьер не найден', 404);
  const { data, error } = await supabase
    .from('couriers')
    .update({
      active,
      ...(active ? {} : { availability_status: 'offline' }),
      ...(!active ? { auth_version: Number(current.auth_version || 1) + 1 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw courierError('Курьер не найден', 404);
  if (!active) {
    await supabase
      .from('courier_auth_sessions')
      .update({ revoked_at: new Date().toISOString() })
      .eq('courier_id', id)
      .is('revoked_at', null);
  }
  return normalizeCourier(data, 0);
}

async function notifyDeliveryPin(order, courier, pin) {
  if (!order.customer_id) return;
  const title = 'Курьер назначен';
  const body = `Код передачи заказа №${order.order_number}: ${pin}. Сообщите его курьеру только при получении.`;
  const [{ data: customer }, { data: notification }] = await Promise.all([
    supabase.from('customers').select('fcm_token').eq('id', order.customer_id).maybeSingle(),
    supabase
      .from('customer_notifications')
      .insert({
        customer_id: order.customer_id,
        title,
        body,
        type: 'delivery',
        payload: { orderId: order.id, orderNumber: order.order_number, courier: courier.name },
      })
      .select('id')
      .maybeSingle(),
  ]);
  if (order.customer_id) {
    await sendPushToCustomer(
      order.customer_id,
      title,
      body,
      {
        type: 'delivery',
        orderId: String(order.id),
        orderNumber: String(order.order_number),
        orderStatus: String(order.fulfillment_status || 'ready'),
        deliveryStatus: String(order.delivery_status || 'assigned'),
        fulfillmentType: 'delivery',
        notificationId: String(notification?.id || ''),
      },
      customer?.fcm_token,
    );
  }
}

async function notifyDeliveryStatus(order) {
  await sendOrderLiveActivity(order).catch((activityError) =>
    console.error('Live Activity delivery update failed:', activityError.message),
  );
  if (!order?.customer_id) return;
  const copy = {
    picked_up: ['Курьер забрал заказ', `Заказ №${order.order_number} передан курьеру.`],
    en_route: [
      'Курьер в пути',
      `Курьер везёт заказ №${order.order_number}. Следите за ним в приложении.`,
    ],
    cancelled: [
      'Статус доставки изменён',
      `Доставка заказа №${order.order_number} остановлена. Мы свяжемся с вами.`,
    ],
  }[order.delivery_status];
  if (!copy) return;
  const [{ data: customer }, { data: saved }] = await Promise.all([
    supabase.from('customers').select('fcm_token').eq('id', order.customer_id).maybeSingle(),
    supabase
      .from('customer_notifications')
      .insert({
        customer_id: order.customer_id,
        title: copy[0],
        body: copy[1],
        type: 'delivery',
        payload: { orderId: order.id, orderNumber: order.order_number },
      })
      .select('id')
      .maybeSingle(),
  ]);
  await sendPushToCustomer(
    order.customer_id,
    copy[0],
    copy[1],
    {
      type: 'delivery',
      orderId: String(order.id),
      orderNumber: String(order.order_number),
      orderStatus: String(order.fulfillment_status || 'ready'),
      deliveryStatus: String(order.delivery_status || ''),
      fulfillmentType: 'delivery',
      orderEta: String(order.estimated_delivery_at || ''),
      notificationId: String(saved?.id || ''),
      deepLink: `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/orders?order=${encodeURIComponent(order.id)}`,
    },
    customer?.fcm_token,
  );
}

async function assignCourier(orderId, courierId, estimatedDeliveryAt = null) {
  const [{ data: order, error: orderError }, { data: courier, error: courierReadError }] =
    await Promise.all([
      supabase.from('kaspi_orders').select('*').eq('id', orderId).maybeSingle(),
      supabase.from('couriers').select('*').eq('id', courierId).eq('active', true).maybeSingle(),
    ]);
  if (orderError) throw orderError;
  if (courierReadError) throw courierReadError;
  if (!order) throw courierError('Заказ не найден', 404);
  if (!courier) throw courierError('Курьер не найден или выключен', 404);
  if (order.fulfillment_type !== 'delivery') throw courierError('Курьер нужен только для доставки');
  if (order.status !== 'paid') throw courierError('Назначить курьера можно после оплаты', 409);
  if (['completed', 'cancelled'].includes(order.fulfillment_status)) {
    throw courierError('Заказ уже закрыт', 409);
  }
  const eta = estimatedDeliveryAt ? new Date(estimatedDeliveryAt) : null;
  if (eta && Number.isNaN(eta.getTime())) throw courierError('Некорректное время доставки');
  const now = new Date().toISOString();
  const pin = crypto.randomInt(1000, 10000).toString();
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update({
      courier_id: courierId,
      delivery_status: 'assigned',
      delivery_pin: pin,
      delivery_confirmed_at: null,
      courier_assigned_at: now,
      estimated_delivery_at: eta?.toISOString() || null,
      updated_at: now,
    })
    .eq('id', orderId)
    .select('*')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw courierError('Заказ уже изменился. Обновите список.', 409);
  await notifyDeliveryPin(data, courier, pin).catch((notificationError) =>
    console.error('Delivery PIN notification failed:', notificationError.message),
  );
  await sendOrderLiveActivity({ ...data, couriers: courier }).catch((activityError) =>
    console.error('Live Activity assignment update failed:', activityError.message),
  );
  await recordCourierEvent({
    courierId,
    orderId,
    eventType: 'assigned',
    metadata: { orderNumber: Number(data.order_number || 0) },
  }).catch(() => {});
  return data;
}

async function updateDeliveryStatus(orderId, nextStatus) {
  if (!Object.hasOwn(DELIVERY_TRANSITIONS, nextStatus)) {
    throw courierError('Некорректный статус доставки');
  }
  if (nextStatus === 'delivered') {
    throw courierError(
      'Завершение доставки требует PIN клиента и фото подтверждения.',
      409,
      'DELIVERY_PROOF_REQUIRED',
    );
  }
  const { data: order, error: readError } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle();
  if (readError) throw readError;
  if (!order) throw courierError('Заказ не найден', 404);
  const current = order.delivery_status || 'unassigned';
  if (current === nextStatus) return order;
  if (!(DELIVERY_TRANSITIONS[current] || []).includes(nextStatus)) {
    throw courierError(`Нельзя изменить доставку «${current}» на «${nextStatus}»`, 409);
  }
  const now = new Date().toISOString();
  const updates = { delivery_status: nextStatus, updated_at: now };
  if (nextStatus === 'en_route') updates.out_for_delivery_at = now;
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update(updates)
    .eq('id', orderId)
    .eq('delivery_status', current)
    .select('*,couriers(name)')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw courierError('Статус уже изменён. Обновите список.', 409);
  const refreshed = await refreshOrderEta(data).catch((etaError) => {
    console.error('Courier status ETA refresh failed:', etaError.message);
    return data;
  });
  await notifyDeliveryStatus(refreshed).catch((notificationError) =>
    console.error('Delivery status notification failed:', notificationError.message),
  );
  return refreshed;
}

async function updateCourierLocation(courierId, latitude, longitude, sessionId = null) {
  const lat = Number(latitude);
  const lon = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    lat < -90 ||
    lat > 90 ||
    !Number.isFinite(lon) ||
    lon < -180 ||
    lon > 180
  ) {
    throw courierError('Некорректные координаты курьера');
  }
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('couriers')
    .update({
      current_latitude: lat,
      current_longitude: lon,
      location_updated_at: now,
      availability_status: 'available',
      updated_at: now,
    })
    .eq('id', courierId)
    .eq('active', true)
    .select()
    .maybeSingle();
  if (error) throw error;
  if (!data) throw courierError('Курьер не найден или выключен', 404);

  const { data: lastEvent } = await supabase
    .from('courier_route_events')
    .select('created_at')
    .eq('courier_id', courierId)
    .eq('event_type', 'location')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!lastEvent || Date.now() - new Date(lastEvent.created_at).getTime() >= 30_000) {
    await recordCourierEvent({
      courierId,
      sessionId,
      eventType: 'location',
      latitude: lat,
      longitude: lon,
    }).catch((eventError) => console.error('Courier route history failed:', eventError.message));
  }
  const staleBefore = Date.now() - 90_000;
  const { data: activeOrders, error: activeOrdersError } = await supabase
    .from('kaspi_orders')
    .select('id,eta_updated_at')
    .eq('courier_id', courierId)
    .eq('status', 'paid')
    .not('delivery_status', 'in', '(delivered,cancelled)')
    .limit(3);
  if (activeOrdersError) {
    console.error('Courier location ETA lookup failed:', activeOrdersError.message);
  } else {
    await Promise.all(
      (activeOrders || [])
        .filter((order) => !order.eta_updated_at || Date.parse(order.eta_updated_at) <= staleBefore)
        .map(async (order) => {
          try {
            const refreshed = await refreshOrderEta(order.id);
            if (!refreshed) return;
            realtime.publish(
              'order.updated',
              {
                orderId: refreshed.id,
                orderNumber: refreshed.order_number,
                orderStatus: refreshed.fulfillment_status,
                deliveryStatus: refreshed.delivery_status,
                etaMinAt: refreshed.eta_min_at || null,
                etaMaxAt: refreshed.eta_max_at || null,
                etaConfidence: refreshed.eta_confidence || null,
              },
              {
                customerId: refreshed.customer_id,
                includeAdmins: true,
                branchId: refreshed.branch_id,
              },
            );
            await sendOrderLiveActivity(refreshed).catch((activityError) =>
              console.error('Courier location Live Activity failed:', activityError.message),
            );
          } catch (etaError) {
            console.error('Courier location ETA refresh failed:', etaError.message);
          }
        }),
    );
  }
  return normalizeCourier(data);
}

async function confirmCourierDelivery({
  courierId,
  sessionId,
  orderId,
  pin,
  photo,
  imageType,
  latitude = null,
  longitude = null,
}) {
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw courierError('Введите PIN клиента');
  if (!photo?.length || !imageType?.extension || !imageType?.mime) {
    throw courierError('Добавьте фото подтверждения');
  }
  const { data: existingProof, error: existingProofError } = await supabase
    .from('delivery_proofs')
    .select('id')
    .eq('order_id', orderId)
    .eq('courier_id', courierId)
    .maybeSingle();
  if (existingProofError) throw existingProofError;
  if (existingProof) {
    const { data: completedOrder, error: completedOrderError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('id', orderId)
      .eq('courier_id', courierId)
      .eq('delivery_status', 'delivered')
      .maybeSingle();
    if (completedOrderError) throw completedOrderError;
    if (completedOrder) return completedOrder;
    throw courierError('Подтверждение уже сохранено. Обновите список заказов.', 409);
  }
  const objectPath = `${courierId}/${orderId}/${Date.now()}-${crypto.randomUUID()}.${imageType.extension}`;
  const { error: uploadError } = await supabase.storage
    .from('delivery-proofs')
    .upload(objectPath, photo, {
      contentType: imageType.mime,
      cacheControl: '31536000',
      upsert: false,
    });
  if (uploadError) throw uploadError;

  const { data, error } = await supabase.rpc('complete_courier_delivery', {
    p_order_id: orderId,
    p_courier_id: courierId,
    p_session_id: sessionId,
    p_delivery_pin: String(pin),
    p_photo_path: objectPath,
    p_latitude: latitude == null ? null : Number(latitude),
    p_longitude: longitude == null ? null : Number(longitude),
  });
  if (error) {
    await supabase.storage
      .from('delivery-proofs')
      .remove([objectPath])
      .catch(() => {});
    const message = String(error.message || '');
    if (message.includes('invalid delivery pin')) {
      throw courierError('Неверный PIN клиента', 401, 'INVALID_DELIVERY_PIN');
    }
    if (message.includes('not ready')) {
      throw courierError('Сначала отметьте, что заказ забран и курьер выехал', 409);
    }
    throw error;
  }
  const order = Array.isArray(data) ? data[0] : data;
  await recordCourierEvent({
    courierId,
    sessionId,
    orderId,
    eventType: 'delivered',
    latitude: latitude == null ? null : Number(latitude),
    longitude: longitude == null ? null : Number(longitude),
    metadata: { proof: true },
  });
  const { releaseOrderReservations } = require('./inventory.service');
  await releaseOrderReservations(orderId).catch((releaseError) =>
    console.error('Delivered order reservation release failed:', releaseError.message),
  );
  if (order?.customer_id) {
    const title = 'Заказ доставлен';
    const body = `Заказ №${order.order_number} передан. Спасибо, что выбрали Bulka!`;
    const [{ data: customer }, { data: notification }] = await Promise.all([
      supabase.from('customers').select('fcm_token').eq('id', order.customer_id).maybeSingle(),
      supabase
        .from('customer_notifications')
        .insert({
          customer_id: order.customer_id,
          title,
          body,
          type: 'delivery',
          payload: { orderId: order.id, orderNumber: order.order_number, delivered: true },
        })
        .select('id')
        .maybeSingle(),
    ]);
    if (order.customer_id) {
      await sendPushToCustomer(
        order.customer_id,
        title,
        body,
        {
          type: 'delivery',
          orderId: String(order.id),
          orderNumber: String(order.order_number),
          orderStatus: 'delivered',
          deliveryStatus: 'delivered',
          fulfillmentType: 'delivery',
          notificationId: String(notification?.id || ''),
        },
        customer?.fcm_token,
      ).catch((pushError) =>
        console.error('Delivered order push notification failed:', pushError.message),
      );
    }
  }
  await sendOrderLiveActivity(order, { end: true }).catch((activityError) =>
    console.error('Live Activity delivery completion failed:', activityError.message),
  );
  return order;
}

async function getDeliveryProof(orderId) {
  const { data, error } = await supabase
    .from('delivery_proofs')
    .select('*,couriers(name,phone)')
    .eq('order_id', orderId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw courierError('Подтверждение доставки не найдено', 404);
  const { data: signed, error: signedError } = await supabase.storage
    .from('delivery-proofs')
    .createSignedUrl(data.photo_path, 10 * 60);
  if (signedError) throw signedError;
  return {
    id: data.id,
    orderId: data.order_id,
    courierId: data.courier_id,
    courier: data.couriers || null,
    pinVerified: data.pin_verified === true,
    latitude: data.latitude == null ? null : Number(data.latitude),
    longitude: data.longitude == null ? null : Number(data.longitude),
    createdAt: data.created_at,
    photoUrl: signed.signedUrl,
    photoExpiresIn: 600,
  };
}

async function listCourierActivity(courierId, { branchIds = [], limit = 200 } = {}) {
  let allowedOrderIds = null;
  if (Array.isArray(branchIds) && branchIds.length) {
    const { data: orders, error } = await supabase
      .from('kaspi_orders')
      .select('id')
      .eq('courier_id', courierId)
      .in('branch_id', branchIds)
      .limit(1000);
    if (error) throw error;
    allowedOrderIds = (orders || []).map((order) => order.id);
    if (!allowedOrderIds.length) return [];
  }
  let query = supabase
    .from('courier_route_events')
    .select('id,order_id,event_type,latitude,longitude,metadata,created_at')
    .eq('courier_id', courierId)
    .order('created_at', { ascending: false })
    .limit(Math.min(500, Math.max(1, Number(limit) || 200)));
  if (allowedOrderIds) query = query.in('order_id', allowedOrderIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map((event) => ({
    id: event.id,
    orderId: event.order_id || null,
    type: event.event_type,
    latitude: event.latitude == null ? null : Number(event.latitude),
    longitude: event.longitude == null ? null : Number(event.longitude),
    metadata: event.metadata || {},
    createdAt: event.created_at,
  }));
}

module.exports = {
  DELIVERY_TRANSITIONS,
  authenticateCourier,
  assignCourier,
  cleanPhone,
  confirmCourierDelivery,
  consumeCourierBotRequest,
  getDeliveryProof,
  listCourierActivity,
  listCourierOrders,
  listCouriers,
  notifyDeliveryStatus,
  requestCourierLogin,
  revokeCourierSession,
  revokeCourierSessions,
  saveCourier,
  setCourierActive,
  updateCourierLocation,
  updateCourierOrderStatus,
  updateDeliveryStatus,
  verifyCourierLogin,
};

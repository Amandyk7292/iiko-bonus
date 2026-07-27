const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { optimizeUploadedImage } = require('../utils/image.util');
const { sendPushToCustomer } = require('./push.service');
const realtime = require('./realtime.service');
const { cleanSupportResolution, determineSupportClosure } = require('../utils/support.util');

const CATEGORIES = new Set(['order_issue', 'product_quality', 'delivery', 'refund', 'other']);
const STATUSES = new Set(['new', 'in_review', 'resolved', 'rejected']);
const PRIORITIES = new Set(['low', 'normal', 'high', 'urgent']);
const CLOSED_STATUSES = ['resolved', 'rejected'];
const SLA_MINUTES = {
  low: 24 * 60,
  normal: 4 * 60,
  high: 2 * 60,
  urgent: 30,
};

const supportError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const detectImage = (buffer) => {
  if (buffer?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return 'image/jpeg';
  if (
    buffer?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return 'image/png';
  }
  if (
    buffer?.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer?.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
};

const attachmentPaths = (value) =>
  (Array.isArray(value) ? value : [])
    .map((item) => String(item?.path || item || '').trim())
    .filter(Boolean)
    .slice(0, 3);

const cleanSearch = (value) =>
  String(value || '')
    .trim()
    .replace(/[%_,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);

const priorityDueAt = (priority, from = new Date()) =>
  new Date(from.getTime() + SLA_MINUTES[priority] * 60_000).toISOString();

async function signedAttachmentMap(paths) {
  const unique = [...new Set(paths.filter(Boolean))];
  if (!unique.length) return new Map();
  const { data, error } = await supabase.storage
    .from('support-attachments')
    .createSignedUrls(unique, 60 * 60);
  if (error) {
    console.error('Failed to sign support attachments:', error.message);
    return new Map();
  }
  return new Map(
    (data || []).map((item, index) => [
      item.path || unique[index],
      item.signedUrl || item.signedURL || null,
    ]),
  );
}

const normalizeMessage = (row, signed = new Map()) => ({
  id: row.id,
  requestId: row.request_id,
  senderType: row.sender_type,
  senderId: row.sender_id || null,
  body: row.body,
  attachments: attachmentPaths(row.attachments).map((path) => ({
    path,
    url: signed.get(path) || null,
  })),
  internal: row.is_internal === true,
  createdAt: row.created_at,
});

const normalize = (row, signed = new Map()) => {
  const status = row.status || 'new';
  const dueAt = row.due_at || null;
  return {
    id: row.id,
    orderId: row.order_id || null,
    orderNumber: row.kaspi_orders?.order_number || null,
    branchId: row.kaspi_orders?.branch_id || null,
    branch: row.kaspi_orders?.branch_name || '',
    customer: row.customers || null,
    category: row.category,
    message: row.message,
    preview: row.last_message_preview || row.message,
    status,
    priority: PRIORITIES.has(row.priority) ? row.priority : 'normal',
    refundRequested: row.refund_requested === true,
    attachments: attachmentPaths(row.attachments).map((path) => ({
      path,
      url: signed.get(path) || null,
    })),
    resolution: row.resolution || null,
    assignedTo: row.assigned_to || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at || null,
    dueAt,
    firstRespondedAt: row.first_responded_at || null,
    lastMessageAt: row.last_message_at || row.updated_at || row.created_at,
    overdue: Boolean(dueAt) && !CLOSED_STATUSES.includes(status) && Date.parse(dueAt) < Date.now(),
  };
};

async function normalizeMany(rows) {
  const paths = rows.flatMap((row) => attachmentPaths(row.attachments));
  const signed = await signedAttachmentMap(paths);
  return rows.map((row) => normalize(row, signed));
}

async function uploadSupportAttachment(customerId, file) {
  const detected = detectImage(file?.buffer);
  if (!detected || detected !== file?.mimetype) {
    throw supportError('Допустимы JPEG, PNG и WebP до 5 МБ');
  }
  const optimized = await optimizeUploadedImage(file.buffer, detected);
  const date = new Date().toISOString().slice(0, 10);
  const path = `${customerId}/${date}/${Date.now()}-${crypto.randomUUID()}.${optimized.extension}`;
  const { error } = await supabase.storage
    .from('support-attachments')
    .upload(path, optimized.buffer, {
      contentType: optimized.mime,
      cacheControl: '86400',
      upsert: false,
    });
  if (error) throw error;
  const signed = await signedAttachmentMap([path]);
  return { path, url: signed.get(path) || null, optimized: optimized.optimized };
}

async function createSupportRequest(customerId, payload = {}) {
  const category = String(payload.category || '').trim();
  if (!CATEGORIES.has(category)) throw supportError('Выберите тему обращения');
  const message = String(payload.message || '').trim();
  if (message.length < 5 || message.length > 2000) {
    throw supportError('Опишите проблему: от 5 до 2000 символов');
  }
  const orderId = String(payload.orderId || '').trim() || null;
  const refundRequested = payload.refundRequested === true || category === 'refund';
  let order = null;
  if (orderId) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select('id,order_number,status,branch_id,branch_name')
      .eq('id', orderId)
      .eq('customer_id', customerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw supportError('Заказ не найден', 404);
    order = data;
  }
  if (refundRequested && (!order || order.status !== 'paid')) {
    throw supportError('Запрос возврата доступен только для оплаченного заказа', 409);
  }
  const attachments = attachmentPaths(payload.attachments);
  if (attachments.some((path) => !path.startsWith(`${customerId}/`))) {
    throw supportError('Некорректное вложение');
  }
  const now = new Date();
  const priority = refundRequested ? 'high' : 'normal';
  const { data, error } = await supabase
    .from('customer_support_requests')
    .insert({
      customer_id: customerId,
      order_id: orderId,
      category,
      message,
      refund_requested: refundRequested,
      attachments,
      priority,
      due_at: priorityDueAt(priority, now),
      last_message_at: now.toISOString(),
      last_message_preview: message.slice(0, 500),
      updated_at: now.toISOString(),
    })
    .select('*')
    .single();
  if (error) throw error;
  const { error: messageError } = await supabase.from('customer_support_messages').insert({
    request_id: data.id,
    sender_type: 'customer',
    sender_id: customerId,
    body: message,
    attachments,
    is_internal: false,
    created_at: data.created_at,
  });
  if (messageError) {
    const { error: cleanupError } = await supabase
      .from('customer_support_requests')
      .delete()
      .eq('id', data.id);
    if (cleanupError) {
      console.error('Failed to rollback support request:', cleanupError.message);
    }
    throw messageError;
  }
  const event = {
    requestId: data.id,
    orderId,
    orderNumber: order?.order_number || null,
    status: data.status,
    priority,
    category,
    branchId: order?.branch_id || null,
  };
  realtime.publish('support.created', event, {
    customerId,
    includeAdmins: true,
    branchId: order?.branch_id || null,
    roles: order?.branch_id ? undefined : ['owner', 'admin'],
  });
  return normalize(data, await signedAttachmentMap(attachments));
}

async function listCustomerSupport(customerId) {
  const { data, error } = await supabase
    .from('customer_support_requests')
    .select('*,kaspi_orders(order_number,branch_id,branch_name)')
    .eq('customer_id', customerId)
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return normalizeMany(data || []);
}

async function listAdminSupport({
  status = '',
  queue = '',
  priority = '',
  assignedTo = '',
  search = '',
  page = 1,
  pageSize = 30,
  branchIds = [],
} = {}) {
  const safePage = Math.max(1, Number(page) || 1);
  const safeSize = Math.min(100, Math.max(10, Number(pageSize) || 30));
  const scoped = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  const orderRelation = scoped.length
    ? 'kaspi_orders!inner(order_number,branch_id,branch_name)'
    : 'kaspi_orders(order_number,branch_id,branch_name)';
  let query = supabase
    .from('customer_support_requests')
    .select(`*,customers(name,phone),${orderRelation}`, { count: 'exact' });

  if (STATUSES.has(status)) query = query.eq('status', status);
  if (PRIORITIES.has(priority)) query = query.eq('priority', priority);
  if (queue === 'new') query = query.eq('status', 'new');
  if (queue === 'mine' && assignedTo) {
    query = query
      .eq('assigned_to', String(assignedTo).slice(0, 120))
      .not('status', 'in', '(resolved,rejected)');
  }
  if (queue === 'overdue') {
    query = query.lt('due_at', new Date().toISOString()).not('status', 'in', '(resolved,rejected)');
  }
  if (queue === 'closed') query = query.in('status', CLOSED_STATUSES);
  if (scoped.length) query = query.in('kaspi_orders.branch_id', scoped);

  const needle = cleanSearch(search);
  if (needle) {
    const [customerResult, orderResult] = await Promise.all([
      supabase
        .from('customers')
        .select('id')
        .or(`name.ilike.%${needle}%,phone.ilike.%${needle}%`)
        .limit(100),
      /^\d+$/.test(needle)
        ? supabase.from('kaspi_orders').select('id').eq('order_number', needle).limit(100)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (customerResult.error) throw customerResult.error;
    if (orderResult.error) throw orderResult.error;
    const customerIds = (customerResult.data || []).map((item) => item.id);
    const orderIds = (orderResult.data || []).map((item) => item.id);
    const predicates = [
      `message.ilike.%${needle}%`,
      `last_message_preview.ilike.%${needle}%`,
      ...(customerIds.length ? [`customer_id.in.(${customerIds.join(',')})`] : []),
      ...(orderIds.length ? [`order_id.in.(${orderIds.join(',')})`] : []),
      ...(/^[0-9a-f-]{36}$/i.test(needle) ? [`id.eq.${needle}`] : []),
    ];
    query = query.or(predicates.join(','));
  }
  const from = (safePage - 1) * safeSize;
  const { data, error, count } = await query
    .order('due_at', { ascending: true, nullsFirst: false })
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .range(from, from + safeSize - 1);
  if (error) throw error;
  return {
    requests: await normalizeMany(data || []),
    total: count || 0,
    page: safePage,
    pageSize: safeSize,
  };
}

async function readSupportRow(requestId, { customerId = null } = {}) {
  let query = supabase
    .from('customer_support_requests')
    .select('*,customers(name,phone),kaspi_orders(order_number,branch_id,branch_name)')
    .eq('id', requestId);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw supportError('Обращение не найдено', 404);
  return data;
}

async function getSupportRequest(requestId, { customerId = null, includeInternal = true } = {}) {
  const row = await readSupportRow(requestId, { customerId });
  let messageQuery = supabase
    .from('customer_support_messages')
    .select('*')
    .eq('request_id', row.id)
    .order('created_at', { ascending: true });
  if (!includeInternal) messageQuery = messageQuery.eq('is_internal', false);
  const { data: messageRows, error: messageError } = await messageQuery;
  if (messageError) throw messageError;
  const paths = [
    ...attachmentPaths(row.attachments),
    ...(messageRows || []).flatMap((message) => attachmentPaths(message.attachments)),
  ];
  const signed = await signedAttachmentMap(paths);
  return {
    request: normalize(row, signed),
    messages: (messageRows || []).map((message) => normalizeMessage(message, signed)),
  };
}

async function readLatestPublicSupportMessage(requestId) {
  const { data, error } = await supabase
    .from('customer_support_messages')
    .select('id,sender_type,body,is_internal,created_at')
    .eq('request_id', requestId)
    .eq('is_internal', false)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function notifySupportCustomer(row, body) {
  const title = 'Новое сообщение по обращению';
  const { data: saved } = await supabase
    .from('customer_notifications')
    .insert({
      customer_id: row.customer_id,
      title,
      body,
      type: 'support',
      payload: { supportRequestId: row.id, orderId: row.order_id },
    })
    .select('id')
    .maybeSingle();
  await sendPushToCustomer(row.customer_id, title, body, {
    type: 'support',
    supportRequestId: String(row.id),
    orderId: String(row.order_id || ''),
    notificationId: String(saved?.id || ''),
    deepLink: `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/orders?support=${encodeURIComponent(row.id)}`,
  }).catch((error) => console.error('Failed to send support push:', error.message));
}

async function addSupportMessage(
  requestId,
  payload = {},
  { senderType, senderId = '', customerId = null } = {},
) {
  if (!['customer', 'admin'].includes(senderType)) {
    throw supportError('Некорректный отправитель');
  }
  const row = await readSupportRow(requestId, { customerId });
  const body = String(payload.body || payload.message || '')
    .trim()
    .slice(0, 4000);
  if (!body) throw supportError('Введите сообщение');
  const internal = senderType === 'admin' && payload.internal === true;
  const attachments = attachmentPaths(payload.attachments);
  if (
    senderType === 'customer' &&
    attachments.some((path) => !path.startsWith(`${row.customer_id}/`))
  ) {
    throw supportError('Некорректное вложение');
  }
  const { data, error } = await supabase
    .from('customer_support_messages')
    .insert({
      request_id: row.id,
      sender_type: senderType,
      sender_id: String(senderId || '').slice(0, 160) || null,
      body,
      attachments,
      is_internal: internal,
    })
    .select('*')
    .single();
  if (error) throw error;

  if (senderType === 'admin' && !internal) await notifySupportCustomer(row, body);
  const event = {
    requestId: row.id,
    orderId: row.order_id,
    messageId: data.id,
    senderType,
    internal,
    branchId: row.kaspi_orders?.branch_id || null,
  };
  realtime.publish(
    'support.updated',
    event,
    internal
      ? {
          adminOnly: true,
          branchId: row.kaspi_orders?.branch_id || null,
          roles: row.kaspi_orders?.branch_id ? undefined : ['owner', 'admin'],
        }
      : {
          customerId: row.customer_id,
          includeAdmins: true,
          branchId: row.kaspi_orders?.branch_id || null,
          roles: row.kaspi_orders?.branch_id ? undefined : ['owner', 'admin'],
        },
  );
  return getSupportRequest(row.id, {
    customerId: senderType === 'customer' ? row.customer_id : null,
    includeInternal: senderType === 'admin',
  });
}

async function updateSupportRequest(requestId, payload = {}, actor = '') {
  const current = await readSupportRow(requestId);
  const status = payload.status === undefined ? current.status : String(payload.status).trim();
  if (!STATUSES.has(status)) throw supportError('Некорректный статус обращения');
  const closing = CLOSED_STATUSES.includes(status);
  const wasClosed = CLOSED_STATUSES.includes(current.status);
  const priority =
    payload.priority === undefined ? current.priority || 'normal' : String(payload.priority);
  if (!PRIORITIES.has(priority)) throw supportError('Некорректный приоритет');
  const hasExplicitResolution = Object.prototype.hasOwnProperty.call(payload, 'resolution');
  const explicitResolution = hasExplicitResolution
    ? cleanSupportResolution(payload.resolution)
    : '';
  let resolution = closing ? current.resolution || null : null;
  let addClosureMessage = false;
  let protectLastMessage = false;
  if (closing && (!wasClosed || hasExplicitResolution)) {
    const latestPublicMessage = await readLatestPublicSupportMessage(requestId);
    const closure = determineSupportClosure(latestPublicMessage, explicitResolution);
    if (!closure) {
      throw supportError('Ответьте на последнее сообщение клиента перед закрытием');
    }
    resolution = closure.resolution;
    addClosureMessage = closure.addMessage;
    protectLastMessage = true;
  }

  let assignedTo = current.assigned_to || null;
  if (payload.assignToMe === true) assignedTo = String(actor || '').slice(0, 120) || null;
  if (Object.prototype.hasOwnProperty.call(payload, 'assignedTo')) {
    assignedTo =
      String(payload.assignedTo || '')
        .trim()
        .slice(0, 120) || null;
  }
  const now = new Date();
  const priorityChanged = priority !== (current.priority || 'normal');
  const updates = {
    status,
    priority,
    resolution,
    assigned_to: assignedTo,
    updated_at: now.toISOString(),
    resolved_at: CLOSED_STATUSES.includes(status) ? current.resolved_at || now.toISOString() : null,
    due_at:
      priorityChanged && !CLOSED_STATUSES.includes(status)
        ? priorityDueAt(priority, now)
        : current.due_at,
  };
  let updateQuery = supabase.from('customer_support_requests').update(updates).eq('id', requestId);
  if (protectLastMessage && current.last_message_at) {
    updateQuery = updateQuery.eq('last_message_at', current.last_message_at);
  }
  const { data, error } = await updateQuery
    .select('*,customers(name,phone),kaspi_orders(order_number,branch_id,branch_name)')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw supportError(
      protectLastMessage
        ? 'Обращение изменилось — обновите переписку и попробуйте снова'
        : 'Обращение не найдено',
      protectLastMessage ? 409 : 404,
    );
  }

  if (addClosureMessage) {
    const detail = await addSupportMessage(
      requestId,
      { body: resolution },
      { senderType: 'admin', senderId: actor },
    );
    return detail.request;
  }
  if (status !== current.status) {
    await notifySupportCustomer(
      data,
      status === 'resolved'
        ? 'Обращение решено.'
        : status === 'rejected'
          ? 'Обращение закрыто.'
          : 'Команда Bulka обновила статус обращения.',
    );
  }
  realtime.publish(
    'support.updated',
    { requestId: data.id, orderId: data.order_id, status, priority, assignedTo },
    {
      customerId: data.customer_id,
      includeAdmins: true,
      branchId: data.kaspi_orders?.branch_id || null,
      roles: data.kaspi_orders?.branch_id ? undefined : ['owner', 'admin'],
    },
  );
  return normalize(data, await signedAttachmentMap(attachmentPaths(data.attachments)));
}

module.exports = {
  addSupportMessage,
  createSupportRequest,
  getSupportRequest,
  listAdminSupport,
  listCustomerSupport,
  updateSupportRequest,
  uploadSupportAttachment,
};

const { supabase } = require('../config/supabase');
const { branchScopeForAdmin } = require('../utils/admin-scope.util');
const { normalizeOrder } = require('./customer-order.service');

const SEARCH_TYPES = Object.freeze({
  owner: new Set(['order', 'customer', 'support']),
  admin: new Set(['order', 'customer', 'support']),
  branch_manager: new Set(['order', 'customer', 'support']),
  operator: new Set(['order', 'customer', 'support']),
  editor: new Set(['order', 'customer', 'support']),
  viewer: new Set(['order', 'customer', 'support']),
  marketer: new Set(['customer', 'support']),
});

const searchError = (message, statusCode = 400, code = 'ADMIN_SEARCH_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

const allowedTypes = (admin) => SEARCH_TYPES[String(admin?.role || '')] || new Set();
const cleanNeedle = (value) =>
  String(value || '')
    .trim()
    .replace(/[,%()_\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 120);
const isUuid = (value) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const deduplicate = (rows) => [
  ...new Map(rows.filter(Boolean).map((row) => [String(row.id), row])).values(),
];

const customerProfile = (customer) =>
  customer
    ? {
        id: String(customer.id),
        name: customer.name || null,
        phone: customer.phone || null,
        balance: Number(customer.balance || 0),
        totalSpent: Number(customer.total_spent || 0),
      }
    : null;

const supportView = (support) =>
  support
    ? {
        id: String(support.id),
        customerId: support.customer_id || null,
        orderId: support.order_id || null,
        category: support.category,
        message: support.message,
        status: support.status,
        priority: support.priority || 'normal',
        refundRequested: support.refund_requested === true,
        resolution: support.resolution || null,
        assignedTo: support.assigned_to || null,
        createdAt: support.created_at,
        updatedAt: support.updated_at,
        resolvedAt: support.resolved_at || null,
      }
    : null;

const timelineSort = (events) =>
  events
    .filter((event) => event?.occurredAt)
    .sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt))
    .slice(0, 250);

const orderTimeline = (order) => {
  const events = [
    {
      id: `order:${order.id}:created`,
      kind: 'order',
      title: `Заказ №${order.order_number} создан`,
      description: `${Number(order.amount || 0).toLocaleString('ru-RU')} ₸`,
      status: order.fulfillment_status || 'pending',
      occurredAt: order.created_at,
    },
  ];
  if (['paid', 'refunded'].includes(order.status)) {
    events.push({
      id: `payment:${order.id}`,
      kind: 'payment',
      title: 'Оплата подтверждена',
      description: order.payment_method === 'forte_card' ? 'ForteBank' : 'Kaspi Pay',
      status: order.status,
      occurredAt: order.payment_reconciled_at || order.updated_at,
    });
  }
  if (order.refund_status || order.status === 'refunded') {
    events.push({
      id: `refund:${order.id}`,
      kind: 'refund',
      title: 'Возврат по заказу',
      description: order.refund_error || order.cancellation_reason || null,
      status: order.refund_status || order.status,
      occurredAt: order.refunded_at || order.refund_requested_at || order.updated_at,
      requestId: order.refund_request_id || null,
    });
  }
  if (order.fulfillment_status === 'completed') {
    events.push({
      id: `order:${order.id}:completed`,
      kind: 'order',
      title: 'Заказ завершён',
      status: 'completed',
      occurredAt: order.fulfilled_at || order.updated_at,
    });
  }
  return events;
};

const supportTimeline = (support) => [
  {
    id: `support:${support.id}:created`,
    kind: 'support',
    title: 'Обращение создано',
    description: support.message,
    status: support.status,
    occurredAt: support.created_at,
  },
  ...(support.resolved_at
    ? [
        {
          id: `support:${support.id}:resolved`,
          kind: 'support',
          title: 'Обращение закрыто',
          description: support.resolution || null,
          status: support.status,
          occurredAt: support.resolved_at,
          actor: support.assigned_to || null,
        },
      ]
    : []),
];

const auditTimeline = (audit) => ({
  id: `audit:${audit.id}`,
  kind: 'audit',
  title: audit.action_code || `${audit.action} ${audit.path}`,
  description: audit.reason || null,
  status: audit.outcome || String(audit.status_code || ''),
  occurredAt: audit.created_at,
  actor: audit.admin_subject || null,
  requestId: audit.request_id || null,
});

async function candidateCustomers(needle, limit) {
  const pattern = `%${needle}%`;
  const lookups = [
    supabase
      .from('customers')
      .select('id,name,phone,balance,total_spent,created_at,updated_at')
      .ilike('name', pattern)
      .is('deleted_at', null)
      .limit(limit),
    supabase
      .from('customers')
      .select('id,name,phone,balance,total_spent,created_at,updated_at')
      .ilike('phone', pattern)
      .is('deleted_at', null)
      .limit(limit),
  ];
  if (isUuid(needle)) {
    lookups.push(
      supabase
        .from('customers')
        .select('id,name,phone,balance,total_spent,created_at,updated_at')
        .eq('id', needle)
        .is('deleted_at', null)
        .limit(1),
    );
  }
  const results = await Promise.all(lookups);
  for (const result of results) if (result.error) throw result.error;
  return deduplicate(results.flatMap((result) => result.data || []));
}

async function filterScopedCustomers(customers, branchIds) {
  if (!branchIds.length || customers.length === 0) return customers;
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('customer_id')
    .in(
      'customer_id',
      customers.map((customer) => customer.id),
    )
    .in('branch_id', branchIds)
    .limit(5000);
  if (error) throw error;
  const visible = new Set((data || []).map((order) => String(order.customer_id)));
  return customers.filter((customer) => visible.has(String(customer.id)));
}

async function searchOrders(needle, customerIds, branchIds, limit) {
  const queries = [];
  const base = () => {
    let query = supabase
      .from('kaspi_orders')
      .select(
        'id,order_number,status,fulfillment_status,branch_id,branch_name,customer_id,phone,amount,updated_at,customers(id,name,phone)',
      );
    if (branchIds.length) query = query.in('branch_id', branchIds);
    return query;
  };
  if (isUuid(needle)) queries.push(base().eq('id', needle).limit(1));
  if (/^\d{1,18}$/.test(needle)) queries.push(base().eq('order_number', needle).limit(limit));
  if (customerIds.length) queries.push(base().in('customer_id', customerIds).limit(limit));
  if (!queries.length) return [];
  const results = await Promise.all(queries);
  for (const result of results) if (result.error) throw result.error;
  return deduplicate(results.flatMap((result) => result.data || []));
}

async function searchSupport(needle, customerIds, branchIds, limit) {
  const selection = branchIds.length
    ? 'id,customer_id,order_id,message,status,priority,updated_at,customers(id,name,phone),kaspi_orders!inner(branch_id,branch_name,order_number)'
    : 'id,customer_id,order_id,message,status,priority,updated_at,customers(id,name,phone),kaspi_orders(branch_id,branch_name,order_number)';
  const base = () => {
    let query = supabase.from('customer_support_requests').select(selection);
    if (branchIds.length) query = query.in('kaspi_orders.branch_id', branchIds);
    return query;
  };
  const queries = [base().ilike('message', `%${needle}%`).limit(limit)];
  if (isUuid(needle)) queries.push(base().eq('id', needle).limit(1));
  if (customerIds.length) queries.push(base().in('customer_id', customerIds).limit(limit));
  const results = await Promise.all(queries);
  for (const result of results) if (result.error) throw result.error;
  return deduplicate(results.flatMap((result) => result.data || []));
}

async function globalSearch(admin, query) {
  const types = allowedTypes(admin);
  if (types.size === 0) {
    throw searchError('Поиск недоступен для этой роли', 403, 'ADMIN_SEARCH_FORBIDDEN');
  }
  const needle = cleanNeedle(query.q);
  const limit = Number(query.limit || 20);
  const branchIds = branchScopeForAdmin(admin);
  const rawCustomers = await candidateCustomers(needle, Math.max(limit, 30));
  const customers = await filterScopedCustomers(rawCustomers, branchIds);
  const customerIds = customers.map((customer) => customer.id);
  const [orders, support] = await Promise.all([
    types.has('order') ? searchOrders(needle, customerIds, branchIds, limit) : [],
    types.has('support') ? searchSupport(needle, customerIds, branchIds, limit) : [],
  ]);
  const results = [];
  if (types.has('customer')) {
    results.push(
      ...customers.map((customer) => ({
        type: 'customer',
        id: String(customer.id),
        title: customer.name || customer.phone || 'Клиент',
        subtitle: customer.phone || null,
        status: null,
        branch: null,
        updatedAt: customer.updated_at || customer.created_at,
      })),
    );
  }
  results.push(
    ...orders.map((order) => ({
      type: 'order',
      id: String(order.id),
      title: `Заказ №${order.order_number}`,
      subtitle: [order.customers?.name || order.phone, `${Number(order.amount)} ₸`]
        .filter(Boolean)
        .join(' · '),
      status: order.fulfillment_status || order.status,
      branch: order.branch_name || null,
      updatedAt: order.updated_at,
    })),
    ...support.map((request) => ({
      type: 'support',
      id: String(request.id),
      title: `Обращение ${String(request.id).slice(0, 8)}`,
      subtitle: request.message?.slice(0, 140) || request.customers?.phone || null,
      status: request.status,
      branch: request.kaspi_orders?.branch_name || null,
      updatedAt: request.updated_at,
    })),
  );
  return results
    .sort((left, right) => Date.parse(right.updatedAt || 0) - Date.parse(left.updatedAt || 0))
    .slice(0, limit);
}

async function loadScopedOrder(id, branchIds) {
  let query = supabase
    .from('kaspi_orders')
    .select('*,customers(id,name,phone,balance,total_spent,created_at,updated_at)')
    .eq('id', id);
  if (branchIds.length) query = query.in('branch_id', branchIds);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw searchError('Заказ не найден', 404, 'ADMIN_SEARCH_RESULT_NOT_FOUND');
  return data;
}

async function loadScopedSupport(id, branchIds) {
  const selection = branchIds.length
    ? '*,customers(id,name,phone,balance,total_spent,created_at,updated_at),kaspi_orders!inner(*)'
    : '*,customers(id,name,phone,balance,total_spent,created_at,updated_at),kaspi_orders(*)';
  let query = supabase.from('customer_support_requests').select(selection).eq('id', id);
  if (branchIds.length) query = query.in('kaspi_orders.branch_id', branchIds);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw searchError('Обращение не найдено', 404, 'ADMIN_SEARCH_RESULT_NOT_FOUND');
  return data;
}

async function auditEvents(targetType, targetIds, branchIds) {
  if (!targetIds.length) return [];
  let query = supabase
    .from('admin_audit_logs')
    .select('*')
    .eq('target_type', targetType)
    .in('target_id', targetIds)
    .order('created_at', { ascending: false })
    .limit(100);
  if (branchIds.length) query = query.in('branch_id', branchIds);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).map(auditTimeline);
}

async function orderDetail(admin, id, branchIds) {
  const order = await loadScopedOrder(id, branchIds);
  const [supportResult, audit] = await Promise.all([
    supabase
      .from('customer_support_requests')
      .select('*')
      .eq('order_id', order.id)
      .order('created_at', { ascending: false })
      .limit(100),
    auditEvents('order', [String(order.id), String(order.order_number)], branchIds),
  ]);
  if (supportResult.error) throw supportResult.error;
  const support = supportResult.data || [];
  return {
    type: 'order',
    id: String(order.id),
    title: `Заказ №${order.order_number}`,
    subtitle: order.customers?.name || order.phone || null,
    status: order.fulfillment_status || order.status,
    branch: order.branch_name || null,
    customer: order.customers
      ? {
          id: String(order.customers.id),
          name: order.customers.name || null,
          phone: order.customers.phone || null,
        }
      : null,
    order: normalizeOrder(order),
    customerProfile: customerProfile(order.customers),
    support: support[0] ? supportView(support[0]) : null,
    timeline: timelineSort([
      ...orderTimeline(order),
      ...support.flatMap(supportTimeline),
      ...audit,
    ]),
  };
}

async function customerDetail(admin, id, branchIds) {
  let customerQuery = supabase
    .from('customers')
    .select('id,name,phone,balance,total_spent,created_at,updated_at')
    .eq('id', id)
    .is('deleted_at', null);
  const { data: customer, error: customerError } = await customerQuery.maybeSingle();
  if (customerError) throw customerError;
  if (!customer) throw searchError('Клиент не найден', 404, 'ADMIN_SEARCH_RESULT_NOT_FOUND');

  let orderQuery = supabase
    .from('kaspi_orders')
    .select('*')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (branchIds.length) orderQuery = orderQuery.in('branch_id', branchIds);
  const { data: orders, error: ordersError } = await orderQuery;
  if (ordersError) throw ordersError;
  if (branchIds.length && !(orders || []).length) {
    throw searchError('Клиент не найден', 404, 'ADMIN_SEARCH_RESULT_NOT_FOUND');
  }

  let supportQuery = supabase
    .from('customer_support_requests')
    .select(branchIds.length ? '*,kaspi_orders!inner(branch_id)' : '*')
    .eq('customer_id', id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (branchIds.length) supportQuery = supportQuery.in('kaspi_orders.branch_id', branchIds);
  const [supportResult, audit] = await Promise.all([
    supportQuery,
    auditEvents('customer', [String(id)], branchIds),
  ]);
  if (supportResult.error) throw supportResult.error;
  const support = supportResult.data || [];
  const timeline = [
    {
      id: `customer:${id}:created`,
      kind: 'customer',
      title: 'Клиент зарегистрирован',
      occurredAt: customer.created_at,
    },
    ...(orders || []).flatMap(orderTimeline),
    ...support.flatMap(supportTimeline),
    ...audit,
  ];
  return {
    type: 'customer',
    id: String(customer.id),
    title: customer.name || customer.phone || 'Клиент',
    subtitle: customer.phone || null,
    status: null,
    branch: null,
    customer: {
      id: String(customer.id),
      name: customer.name || null,
      phone: customer.phone || null,
    },
    order: orders?.[0] ? normalizeOrder(orders[0]) : null,
    customerProfile: customerProfile(customer),
    support: support[0] ? supportView(support[0]) : null,
    timeline: timelineSort(timeline),
  };
}

async function supportDetail(admin, id, branchIds) {
  const support = await loadScopedSupport(id, branchIds);
  const order = support.kaspi_orders || null;
  const [messagesResult, audit] = await Promise.all([
    supabase
      .from('customer_support_messages')
      .select('*')
      .eq('request_id', id)
      .order('created_at', { ascending: true })
      .limit(500),
    auditEvents('support', [String(id)], branchIds),
  ]);
  if (messagesResult.error) throw messagesResult.error;
  const messageEvents = (messagesResult.data || []).map((message) => ({
    id: `support-message:${message.id}`,
    kind: 'support',
    title:
      message.sender_type === 'customer'
        ? 'Сообщение клиента'
        : message.is_internal
          ? 'Внутренняя заметка'
          : 'Ответ сотрудника',
    description: message.body,
    occurredAt: message.created_at,
    actor: message.sender_id || null,
  }));
  return {
    type: 'support',
    id: String(support.id),
    title: `Обращение ${String(support.id).slice(0, 8)}`,
    subtitle: support.customers?.phone || null,
    status: support.status,
    branch: order?.branch_name || null,
    customer: support.customers
      ? {
          id: String(support.customers.id),
          name: support.customers.name || null,
          phone: support.customers.phone || null,
        }
      : null,
    order: order ? normalizeOrder(order) : null,
    customerProfile: customerProfile(support.customers),
    support: supportView(support),
    timeline: timelineSort([
      ...supportTimeline(support),
      ...(order ? orderTimeline(order) : []),
      ...messageEvents,
      ...audit,
    ]),
  };
}

async function globalSearchDetail(admin, type, id) {
  const types = allowedTypes(admin);
  if (!types.has(type)) {
    throw searchError('Недостаточно прав для результата поиска', 403, 'ADMIN_SEARCH_FORBIDDEN');
  }
  const branchIds = branchScopeForAdmin(admin);
  if (type === 'order') return orderDetail(admin, id, branchIds);
  if (type === 'customer') return customerDetail(admin, id, branchIds);
  return supportDetail(admin, id, branchIds);
}

module.exports = {
  allowedTypes,
  globalSearch,
  globalSearchDetail,
};

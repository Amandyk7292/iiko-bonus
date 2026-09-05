const { supabase } = require('../config/supabase');
const { isDeliveryFulfillment } = require('../utils/fulfillment.util');

const CLOSED_ORDER_STATUSES = new Set(['completed', 'cancelled']);
const CLOSED_DELIVERY_STATUSES = new Set(['delivered', 'cancelled']);
const CLOSED_SUPPORT_STATUSES = new Set(['resolved', 'rejected']);
const DASHBOARD_PAGE_SIZE = 1000;

const fetchAllPages = async (buildQuery) => {
  const rows = [];
  for (let offset = 0; ; offset += DASHBOARD_PAGE_SIZE) {
    const { data, error } = await buildQuery(offset, offset + DASHBOARD_PAGE_SIZE - 1);
    if (error) return { data: rows, error };
    const page = Array.isArray(data) ? data : [];
    rows.push(...page);
    if (page.length < DASHBOARD_PAGE_SIZE) return { data: rows, error: null };
  }
};

const normalizeOrderItem = (order) => ({
  id: order.id,
  number: order.order_number,
  amount: Number(order.amount || 0),
  branchId: order.branch_id || null,
  branch: order.branch_name || '',
  paymentStatus: order.status,
  orderStatus: order.fulfillment_status,
  kitchenStatus: order.kitchen_status || null,
  deliveryStatus: order.delivery_status || null,
  promisedReadyAt: order.promised_ready_at || null,
  createdAt: order.created_at,
  lastError: order.last_error || null,
});

const normalizeSupportItem = (request) => ({
  id: request.id,
  category: request.category,
  status: request.status,
  priority: request.priority || 'normal',
  assignedTo: request.assigned_to || null,
  dueAt: request.due_at || null,
  lastMessageAt: request.last_message_at || request.updated_at || request.created_at,
  createdAt: request.created_at,
  orderNumber: request.kaspi_orders?.order_number || null,
  branchId: request.kaspi_orders?.branch_id || null,
  branch: request.kaspi_orders?.branch_name || '',
  customer: request.customers || null,
  preview: String(request.last_message_preview || request.message || '').slice(0, 180),
});

async function getOperationsSummary({
  branchIds = [],
  includeOrders = true,
  includeKitchen = true,
  includeDispatch = true,
  includeSupport = true,
  includeWhatsApp = true,
  includeInventory = true,
  assignedTo = '',
} = {}) {
  const scoped = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  const orderSelect =
    'id,order_number,amount,branch_id,branch_name,status,fulfillment_status,fulfillment_type,preorder_fulfillment_type,kitchen_status,promised_ready_at,delivery_status,courier_id,refund_status,last_error,created_at,updated_at';
  // Load the complete actionable set instead of taking the newest N orders.
  // An unresolved order can be old while still requiring an operator's
  // attention, so closed history must not displace it in this dashboard.
  const activeOrderQuery = (from, to) => {
    let query = supabase
      .from('kaspi_orders')
      .select(orderSelect)
      .eq('status', 'paid')
      .not('fulfillment_status', 'in', '(completed,cancelled)')
      .order('created_at', { ascending: false });
    if (scoped.length) query = query.in('branch_id', scoped);
    return query.range(from, to);
  };

  const paymentIssueQuery = (from, to) => {
    let query = supabase
      .from('kaspi_orders')
      .select(orderSelect)
      .or('status.in.(failed,expired),refund_status.in.(failed,unknown),last_error.not.is.null')
      .order('created_at', { ascending: false });
    if (scoped.length) query = query.in('branch_id', scoped);
    return query.range(from, to);
  };

  const orderRelation = scoped.length
    ? 'kaspi_orders!inner(order_number,branch_id,branch_name)'
    : 'kaspi_orders(order_number,branch_id,branch_name)';
  const supportQuery = (from, to) => {
    let query = supabase
      .from('customer_support_requests')
      .select(
        `id,category,message,last_message_preview,status,priority,assigned_to,due_at,last_message_at,created_at,updated_at,customers(name,phone),${orderRelation}`,
      )
      .not('status', 'in', '(resolved,rejected)')
      .order('last_message_at', { ascending: false, nullsFirst: false });
    if (scoped.length) query = query.in('kaspi_orders.branch_id', scoped);
    return query.range(from, to);
  };

  let inventoryQuery = supabase
    .from('branch_product_inventory')
    .select('branch_id,product_id,product_name,source_quantity,manual_stop,last_synced_at')
    .limit(3000);
  if (scoped.length) inventoryQuery = inventoryQuery.in('branch_id', scoped);

  const promises = [
    includeOrders ? fetchAllPages(activeOrderQuery) : Promise.resolve({ data: [], error: null }),
    includeOrders ? fetchAllPages(paymentIssueQuery) : Promise.resolve({ data: [], error: null }),
    includeSupport ? fetchAllPages(supportQuery) : Promise.resolve({ data: [], error: null }),
    includeInventory ? inventoryQuery : Promise.resolve({ data: [], error: null }),
  ];
  if (includeWhatsApp) {
    promises.push(
      supabase
        .from('whatsapp_conversations')
        .select('id,display_name,phone,unread_count,last_message_preview,last_message_at,status')
        .gt('unread_count', 0)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(100),
    );
  }
  const [activeOrdersResult, paymentIssuesResult, supportResult, inventoryResult, whatsappResult] =
    await Promise.all(promises);
  for (const result of [
    activeOrdersResult,
    paymentIssuesResult,
    supportResult,
    inventoryResult,
    whatsappResult,
  ].filter(Boolean)) {
    if (result.error) throw result.error;
  }

  const now = Date.now();
  const orders = Array.from(
    new Map(
      [...(activeOrdersResult.data || []), ...(paymentIssuesResult.data || [])].map((order) => [
        String(order.id),
        order,
      ]),
    ).values(),
  );
  const support = supportResult.data || [];
  const inventory = inventoryResult.data || [];
  const whatsapp = whatsappResult?.data || [];

  const newOrders = orders.filter(
    (order) =>
      order.status === 'paid' && ['pending', 'new'].includes(order.fulfillment_status || 'pending'),
  );
  const activeOrders = orders.filter(
    (order) =>
      order.status === 'paid' && !CLOSED_ORDER_STATUSES.has(order.fulfillment_status || 'pending'),
  );
  const kitchenOverdue = activeOrders.filter(
    (order) =>
      includeKitchen &&
      ['queued', 'preparing'].includes(order.kitchen_status || 'queued') &&
      order.promised_ready_at &&
      Date.parse(order.promised_ready_at) < now,
  );
  const deliveryAttention = activeOrders.filter(
    (order) =>
      includeDispatch &&
      isDeliveryFulfillment(order) &&
      !CLOSED_DELIVERY_STATUSES.has(order.delivery_status || 'new') &&
      (!order.courier_id ||
        ['new', 'awaiting_courier', 'courier_assigned'].includes(order.delivery_status || 'new')),
  );
  const paymentIssues = orders.filter(
    (order) =>
      ['failed', 'expired'].includes(order.status) ||
      ['failed', 'unknown'].includes(order.refund_status) ||
      Boolean(order.last_error),
  );
  const openSupport = support.filter((request) => !CLOSED_SUPPORT_STATUSES.has(request.status));
  const overdueSupport = openSupport.filter(
    (request) => request.due_at && Date.parse(request.due_at) < now,
  );
  const mySupport = openSupport.filter(
    (request) => assignedTo && request.assigned_to === assignedTo,
  );
  const stoppedProducts = inventory.filter(
    (item) => item.manual_stop === true || Number(item.source_quantity) === 0,
  );
  const whatsappUnread = whatsapp.reduce(
    (sum, conversation) => sum + Number(conversation.unread_count || 0),
    0,
  );

  return {
    updatedAt: new Date().toISOString(),
    capabilities: {
      orders: includeOrders,
      kitchen: includeOrders && includeKitchen,
      dispatch: includeOrders && includeDispatch,
      support: includeSupport,
      whatsapp: includeWhatsApp,
      inventory: includeInventory,
    },
    counts: {
      newOrders: newOrders.length,
      activeOrders: activeOrders.length,
      kitchenOverdue: kitchenOverdue.length,
      deliveryAttention: deliveryAttention.length,
      paymentIssues: paymentIssues.length,
      supportNew: support.filter((request) => request.status === 'new').length,
      supportOverdue: overdueSupport.length,
      supportMine: mySupport.length,
      whatsappUnread,
      whatsappDialogs: whatsapp.length,
      stoppedProducts: stoppedProducts.length,
    },
    orders: [...kitchenOverdue, ...deliveryAttention, ...newOrders]
      .filter(
        (order, index, values) =>
          values.findIndex((candidate) => candidate.id === order.id) === index,
      )
      .slice(0, 12)
      .map(normalizeOrderItem),
    support: [...overdueSupport, ...support.filter((request) => request.status === 'new')]
      .filter(
        (request, index, values) =>
          values.findIndex((candidate) => candidate.id === request.id) === index,
      )
      .slice(0, 12)
      .map(normalizeSupportItem),
    whatsapp: whatsapp.slice(0, 8).map((conversation) => ({
      id: conversation.id,
      displayName: conversation.display_name || '',
      phone: conversation.phone || '',
      unreadCount: Number(conversation.unread_count || 0),
      preview: conversation.last_message_preview || '',
      lastMessageAt: conversation.last_message_at || null,
    })),
  };
}

module.exports = { getOperationsSummary };

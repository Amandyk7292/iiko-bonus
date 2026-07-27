const { supabase } = require('../config/supabase');

const CLOSED_ORDER_STATUSES = new Set(['completed', 'cancelled']);
const CLOSED_DELIVERY_STATUSES = new Set(['delivered', 'cancelled']);
const CLOSED_SUPPORT_STATUSES = new Set(['resolved', 'rejected']);

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
  let orderQuery = supabase
    .from('kaspi_orders')
    .select(
      'id,order_number,amount,branch_id,branch_name,status,fulfillment_status,fulfillment_type,kitchen_status,promised_ready_at,delivery_status,courier_id,refund_status,last_error,created_at,updated_at',
    )
    .order('created_at', { ascending: false })
    .limit(400);
  if (scoped.length) orderQuery = orderQuery.in('branch_id', scoped);

  const orderRelation = scoped.length
    ? 'kaspi_orders!inner(order_number,branch_id,branch_name)'
    : 'kaspi_orders(order_number,branch_id,branch_name)';
  let supportQuery = supabase
    .from('customer_support_requests')
    .select(
      `id,category,message,last_message_preview,status,priority,assigned_to,due_at,last_message_at,created_at,updated_at,customers(name,phone),${orderRelation}`,
    )
    .order('last_message_at', { ascending: false, nullsFirst: false })
    .limit(250);
  if (scoped.length) supportQuery = supportQuery.in('kaspi_orders.branch_id', scoped);

  let inventoryQuery = supabase
    .from('branch_product_inventory')
    .select('branch_id,product_id,product_name,source_quantity,manual_stop,last_synced_at')
    .limit(3000);
  if (scoped.length) inventoryQuery = inventoryQuery.in('branch_id', scoped);

  const promises = [
    includeOrders ? orderQuery : Promise.resolve({ data: [], error: null }),
    includeSupport ? supportQuery : Promise.resolve({ data: [], error: null }),
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
  const [ordersResult, supportResult, inventoryResult, whatsappResult] =
    await Promise.all(promises);
  for (const result of [ordersResult, supportResult, inventoryResult, whatsappResult].filter(
    Boolean,
  )) {
    if (result.error) throw result.error;
  }

  const now = Date.now();
  const orders = ordersResult.data || [];
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
      order.fulfillment_type === 'delivery' &&
      !CLOSED_DELIVERY_STATUSES.has(order.delivery_status || 'new') &&
      (!order.courier_id ||
        ['new', 'awaiting_courier', 'courier_assigned'].includes(order.delivery_status || 'new')),
  );
  const paymentIssues = orders.filter(
    (order) =>
      order.status === 'failed' ||
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

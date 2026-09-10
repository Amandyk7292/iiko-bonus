const { supabase } = require('../config/supabase');
const { updateKitchenStatus } = require('./kitchen.service');
const { decideFrontOrder } = require('./front-order-inbox.service');

const STAGES = ['new', 'preparing', 'ready', 'handed_over'];
const PAGE_SIZE = 25;
const fields =
  'id,order_number,phone,cart_items,amount,delivery_fee,fulfillment_type,scheduled_at,comment,kitchen_status,fulfillment_status,pos_receipt_due,created_at,customers(name,phone),front_receipt_jobs(status,last_error),delivery_jobs(courier_name,courier_phone,courier_car_model,courier_car_number,updated_at)';

function card(order) {
  const courier = [...(order.delivery_jobs || [])].sort((a, b) =>
    String(b.updated_at || '').localeCompare(String(a.updated_at || '')),
  )[0];
  return {
    id: order.id,
    number: Number(order.order_number),
    customer: order.customers?.name || '',
    phone: order.phone || order.customers?.phone || '',
    items: (order.cart_items || []).map((item) => ({
      name: String(item.name || item.productName || ''),
      quantity: Number(item.quantity || 0),
      unit: item.unit || 'шт.',
    })),
    orderType: order.fulfillment_type,
    scheduledAt: order.scheduled_at,
    createdAt: order.created_at,
    amount: Number(order.amount),
    deliveryFee: Number(order.delivery_fee || 0),
    comment: order.comment || '',
    posReceiptDue: Boolean(order.pos_receipt_due),
    automaticReceipt: Boolean(order.front_receipt_jobs),
    receiptError: order.front_receipt_jobs?.last_error || '',
    courierName: courier?.courier_name || '',
    courierPhone: courier?.courier_phone || '',
    courierVehicle: [courier?.courier_car_model, courier?.courier_car_number]
      .filter(Boolean)
      .join(' · '),
  };
}

async function listFrontBoard(branchId, pages = {}) {
  const columns = await Promise.all(
    STAGES.map(async (stage) => {
      const page = pages[stage] || 1;
      let query = supabase
        .from('kaspi_orders')
        .select(fields, { count: 'exact' })
        .eq('branch_id', branchId)
        .eq('status', 'paid')
        .is('refund_status', null);
      if (stage === 'handed_over') {
        const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        query = query.or(
          [
            `and(kitchen_status.eq.handed_over,handed_to_courier_at.gte.${cutoff})`,
            `and(fulfillment_status.eq.completed,fulfilled_at.gte.${cutoff})`,
            'and(pos_receipt_due.eq.true,or(kitchen_status.eq.handed_over,fulfillment_status.eq.completed))',
          ].join(','),
        );
      } else {
        query = query.eq('fulfillment_status', stage).neq('kitchen_status', 'handed_over');
      }
      const { data, count, error } = await query
        .order('created_at', { ascending: stage !== 'handed_over' })
        .order('id')
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
      if (error) throw error;
      return { stage, page, total: count || 0, orders: (data || []).map(card) };
    }),
  );
  return { columns };
}

async function pollFrontBoard(branchId, { terminalId }) {
  const { data, error } = await supabase.rpc('poll_front_order_board', {
    p_branch: branchId,
    p_terminal: terminalId,
  });
  if (error) throw error;
  return data;
}

async function moveFrontOrder(branchId, payload) {
  if (!['accept', 'reject', 'ready', 'hand_over'].includes(payload.action))
    throw Object.assign(new Error('Неизвестное действие'), { statusCode: 400 });
  if (['accept', 'reject'].includes(payload.action)) return decideFrontOrder(branchId, payload);
  // The same authenticated state machine as the tablet: atomic transitions,
  // reservation handling, delivery checks and customer notifications, without a pickup PIN.
  return updateKitchenStatus(
    payload.orderId,
    payload.action === 'ready' ? 'ready' : 'handed_over',
    null,
    {
      branchIds: [branchId],
      admin: { sub: `iikofront:${payload.terminalId}` },
    },
  );
}

module.exports = { listFrontBoard, pollFrontBoard, moveFrontOrder };

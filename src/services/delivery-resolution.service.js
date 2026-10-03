const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');
const { listAvailableSlots } = require('./slot.service');
const { sendPushToCustomer } = require('./push.service');
const { cancelExternalDeliveryForOrder } = require('./external-delivery-lifecycle.service');

const resolutionError = (message, code = 'DELIVERY_RESOLUTION_CONFLICT', statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const timeoutMs = (env = process.env) => {
  const minutes = Number(env.DELIVERY_COURIER_WAIT_MINUTES || 20);
  return (Number.isFinite(minutes) && minutes > 0 && minutes <= 1440 ? minutes : 20) * 60_000;
};
function dependencies(options = {}) {
  return {
    db: supabase,
    publish: realtime.publish,
    slots: listAvailableSlots,
    send: sendPushToCustomer,
    normalize: (order) => require('./customer-order.service').normalizeOrder(order),
    cancel: (...args) => require('./customer-order.service').cancelPaidOrder(...args),
    refundFee: (...args) =>
      require('./delivery-fee-refund.service').refundDeliveryReplacementFee(...args),
    closeDelivery: (id) =>
      cancelExternalDeliveryForOrder(id, {
        cancel: (orderId) =>
          require('./yandex-delivery.service').cancelDelivery(orderId, { onlyUnassigned: true }),
      }),
    now: new Date(),
    ...options,
  };
}
async function rpc(db, name, args) {
  const { data, error } = await db.rpc(name, args);
  if (error) {
    if (error.message?.includes('DELIVERY_RESOLUTION_NOT_FOUND'))
      throw resolutionError('Заказ не найден', 'DELIVERY_RESOLUTION_NOT_FOUND', 404);
    if (error.message?.includes('DELIVERY_RESOLUTION_'))
      throw resolutionError(
        'Заказ уже изменился. Обновите его и повторите выбор.',
        error.message.match(/DELIVERY_RESOLUTION_[A-Z_]+/)?.[0],
      );
    throw error;
  }
  return data;
}
async function readOrder(id, customerId, d) {
  let query = d.db.from('kaspi_orders').select('*').eq('id', id);
  if (customerId) query = query.eq('customer_id', customerId);
  const { data, error } = await query.maybeSingle();
  if (error) throw error;
  if (!data) throw resolutionError('Заказ не найден', 'DELIVERY_RESOLUTION_NOT_FOUND', 404);
  return data;
}
function publish(order, d) {
  d.publish(
    'order.updated',
    {
      orderId: order.id,
      orderNumber: order.order_number,
      deliveryResolution: order.delivery_resolution?.status,
    },
    { customerId: order.customer_id, includeAdmins: true, branchId: order.branch_id },
  );
}
async function pickupOptions(order, d) {
  const { data: branch, error } = await d.db
    .from('bulka_locations')
    .select('id,name,address')
    .eq('id', order.branch_id)
    .maybeSingle();
  if (error) throw error;
  if (!branch)
    throw resolutionError(
      'Точка заказа больше недоступна',
      'DELIVERY_RESOLUTION_BRANCH_UNAVAILABLE',
    );
  const slots = await d.slots({
    branchId: order.branch_id,
    orderType: 'pickup',
    horizonHours: 24,
    now: d.now,
    db: d.db,
    excludeRequestId: order.delivery_resolution?.id,
  });
  return {
    branch,
    slots: slots.slots,
    timezoneOffsetMinutes: slots.timezoneOffsetMinutes,
    serverTime: slots.serverTime,
    expiresAt: new Date(d.now.getTime() + 86400000).toISOString(),
  };
}
async function getDeliveryResolution(customerId, orderId, options = {}) {
  const d = dependencies(options),
    order = await readOrder(orderId, customerId, d);
  let pickup = null;
  if (order.delivery_resolution?.status === 'pending') {
    try {
      pickup = await pickupOptions(order, d);
    } catch (error) {
      // Cancellation remains available if pickup is temporarily unavailable.
      if (
        error.statusCode !== 400 &&
        error.statusCode !== 404 &&
        error.code !== 'DELIVERY_RESOLUTION_BRANCH_UNAVAILABLE'
      )
        throw error;
      pickup = {
        branch: { id: order.branch_id, name: order.branch_name || '', address: '' },
        slots: [],
        serverTime: d.now.toISOString(),
        expiresAt: d.now.toISOString(),
        timezoneOffsetMinutes: 300,
      };
    }
  }
  return { order: d.normalize(order), options: pickup };
}
async function finish(order, next, d, actor = null) {
  const updated = await rpc(d.db, 'finish_delivery_resolution', {
    p_order: order.id,
    p_resolution: order.delivery_resolution.id,
    p_next: next,
    p_actor: actor,
  });
  publish(updated, d);
  return updated;
}
async function advance(order, d) {
  const state = order.delivery_resolution.status;
  try {
    if (['pickup_cancelling', 'cancel_cancelling'].includes(state)) {
      await d.closeDelivery(order.id);
      order = await finish(
        order,
        state === 'pickup_cancelling' ? 'pickup_pending_approval' : 'cancel_refunding',
        d,
      );
      if (order.delivery_resolution.status === 'pickup_pending_approval') return order;
    }
    if (order.delivery_resolution.status === 'pickup_accepting') {
      const fee = await d.refundFee(order.id, order.delivery_resolution.id);
      if (fee.status === 'succeeded') {
        order = await readOrder(order.id, null, d);
        try {
          return await finish(order, 'pickup_accepted', d);
        } catch (error) {
          if (error.code !== 'DELIVERY_RESOLUTION_INVALID_SLOT') throw error;
          // The bank may confirm after the selected time expires. Finish the
          // remaining refund instead of leaving an unusable paid delivery.
          const { error: saved } = await d.db
            .from('kaspi_orders')
            .update({
              delivery_resolution: {
                ...order.delivery_resolution,
                rejectionReason: 'pickup_slot_unavailable',
              },
            })
            .eq('id', order.id)
            .eq('delivery_resolution->>status', 'pickup_accepting');
          if (saved) throw saved;
          order = await finish(await readOrder(order.id, null, d), 'pickup_rejecting', d);
        }
      } else {
        const { error } = await d.db
          .from('kaspi_orders')
          .update({
            delivery_resolution: {
              ...order.delivery_resolution,
              feeStatus: fee.status,
              error:
                fee.status === 'failed'
                  ? 'Возврат стоимости доставки требует проверки сотрудником'
                  : null,
            },
          })
          .eq('id', order.id)
          .eq('delivery_resolution->>status', 'pickup_accepting');
        if (error) throw error;
        return order;
      }
    }
    if (['cancel_refunding', 'pickup_rejecting'].includes(order.delivery_resolution.status)) {
      const rejected = order.delivery_resolution.status === 'pickup_rejecting';
      const reason =
        order.delivery_resolution.rejectionReason === 'pickup_slot_unavailable'
          ? 'Время самовывоза истекло во время подтверждения возврата доставки'
          : rejected
            ? 'Самовывоз взамен доставки отклонён точкой'
            : 'Отменено клиентом: курьер не найден';
      await d.cancel(order, reason, {
        allowedFulfillmentStatuses: [order.fulfillment_status],
        cancelBeforeRefund: true,
        reuseRefundRequestId: true,
        acceptPendingRefund: true,
        courierTimeout: true,
      });
      order = await readOrder(order.id, null, d);
      if (order.fulfillment_status === 'cancelled' && order.refund_status === 'succeeded')
        return await finish(order, rejected ? 'pickup_rejected' : 'cancelled', d);
    }
    return order;
  } catch (error) {
    if (
      [
        'COURIER_TIMEOUT_NOT_UNASSIGNED',
        'DELIVERY_RESOLUTION_CONFLICT',
        'DELIVERY_RESOLUTION_DELIVERY_ACTIVE',
      ].includes(error.code)
    ) {
      const current = await readOrder(order.id, null, d);
      if (current.delivery_resolution?.status === 'delivery_resumed') {
        publish(current, d);
        return current;
      }
      if (error.code === 'COURIER_TIMEOUT_NOT_UNASSIGNED')
        return finish(current, 'delivery_resumed', d);
    }
    const latest = await readOrder(order.id, null, d);
    if (
      latest.delivery_resolution?.id !== order.delivery_resolution.id ||
      latest.delivery_resolution.status !== order.delivery_resolution.status
    )
      throw error;
    const { error: saveError } = await d.db
      .from('kaspi_orders')
      .update({
        delivery_resolution: {
          ...latest.delivery_resolution,
          retryAt: new Date(d.now.getTime() + 60000).toISOString(),
          error: String(error.message || '').slice(0, 500),
        },
      })
      .eq('id', order.id)
      .eq('delivery_resolution->>id', order.delivery_resolution.id)
      .eq('delivery_resolution->>status', order.delivery_resolution.status);
    if (saveError) throw saveError;
    throw error;
  }
}
async function work(orderId, d) {
  const rows = await rpc(d.db, 'claim_delivery_resolution_work', { p_order: orderId || null });
  const failures = [];
  for (const order of rows || []) {
    try {
      await advance(order, d);
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length) throw new AggregateError(failures, 'Не все решения по доставке завершены');
}
async function chooseDeliveryResolution(customerId, orderId, choice, options = {}) {
  const d = dependencies(options),
    current = await readOrder(orderId, customerId, d);
  let offset = 300;
  if (choice.action === 'pickup' && current.delivery_resolution?.status === 'pending') {
    const pickup = await pickupOptions(current, d);
    if (!pickup.slots.some((slot) => Date.parse(slot.startsAt) === Date.parse(choice.pickupTime)))
      throw resolutionError(
        'Выберите доступное время самовывоза',
        'DELIVERY_RESOLUTION_INVALID_SLOT',
      );
    offset = pickup.timezoneOffsetMinutes;
  }
  const order = await rpc(d.db, 'choose_delivery_resolution', {
    p_order: orderId,
    p_customer: customerId,
    p_action: choice.action,
    p_pickup: choice.pickupTime || null,
    p_offset: offset,
  });
  publish(order, d);
  // The persisted choice survives an uncertain provider response. The worker retries;
  // the response keeps the customer on the authoritative waiting state.
  await work(orderId, d).catch((error) =>
    console.error('Delivery resolution remains pending:', error.message),
  );
  return d.normalize(await readOrder(orderId, customerId, d));
}
async function reviewDeliveryResolution(
  orderId,
  action,
  { resolutionId = null, branchIds = [], actor = 'staff', ...options } = {},
) {
  const d = dependencies(options),
    current = await readOrder(orderId, null, d);
  if (branchIds.length && !branchIds.map(String).includes(String(current.branch_id)))
    throw resolutionError('Заказ не найден', 'DELIVERY_RESOLUTION_NOT_FOUND', 404);
  const resolution = current.delivery_resolution;
  if (!resolution || (resolutionId && resolution.id !== resolutionId))
    throw resolutionError('Запрос уже изменился');
  if (!['accept', 'reject'].includes(action))
    throw resolutionError('Некорректное действие', 'DELIVERY_RESOLUTION_INVALID_ACTION', 400);
  if (
    (action === 'accept' && ['pickup_accepted', 'pickup_accepting'].includes(resolution.status)) ||
    (action === 'reject' && ['pickup_rejected', 'pickup_rejecting'].includes(resolution.status))
  ) {
    if (['pickup_rejecting', 'pickup_accepting'].includes(resolution.status))
      await work(orderId, d);
    return d.normalize(await readOrder(orderId, null, d));
  }
  if (action === 'accept') {
    const pickup = await pickupOptions(current, d);
    if (
      !pickup.slots.some((slot) => Date.parse(slot.startsAt) === Date.parse(resolution.pickupTime))
    )
      throw resolutionError(
        'Время самовывоза уже недоступно. Отклоните замену с возвратом оплаты.',
        'DELIVERY_RESOLUTION_INVALID_SLOT',
      );
  }
  await finish(
    current,
    action === 'accept' ? 'pickup_accepting' : 'pickup_rejecting',
    d,
    String(actor).slice(0, 160),
  );
  await work(orderId, d);
  return d.normalize(await readOrder(orderId, null, d));
}
async function notifyPending(order, d) {
  const id = order.delivery_resolution.id;
  const title = 'Не удалось найти курьера';
  const body = `Заказ №${order.order_number} готов. Можно забрать его самовывозом или отменить с возвратом оплаты.`;
  const { error } = await d.db.from('customer_notifications').upsert(
    {
      id,
      customer_id: order.customer_id,
      title,
      body,
      type: 'order',
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        messageKey: 'delivery_resolution',
      },
    },
    { onConflict: 'id', ignoreDuplicates: true },
  );
  if (error) throw error;
  await d.send(order.customer_id, title, body, {
    type: 'delivery_resolution',
    orderId: String(order.id),
    orderNumber: String(order.order_number),
    notificationId: id,
    pushDedupeKey: `delivery-resolution:${id}`,
    deepLink: `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/orders?order=${encodeURIComponent(order.id)}`,
  });
  const { error: saved } = await d.db
    .from('kaspi_orders')
    .update({
      delivery_resolution: { ...order.delivery_resolution, noticeSentAt: d.now.toISOString() },
    })
    .eq('id', order.id)
    .eq('delivery_resolution->>status', 'pending');
  if (saved) throw saved;
  publish(order, d);
}
async function processDeliveryResolutions(options = {}) {
  const d = dependencies(options);
  await rpc(d.db, 'claim_delivery_resolutions', {
    p_before: new Date(d.now.getTime() - timeoutMs()).toISOString(),
  });
  const { data: notices, error } = await d.db
    .from('kaspi_orders')
    .select('*')
    .eq('delivery_resolution->>status', 'pending')
    .is('delivery_resolution->noticeSentAt', null)
    .limit(50);
  if (error) throw error;
  const failures = [];
  for (const order of notices || []) {
    try {
      await notifyPending(order, d);
    } catch (failure) {
      failures.push(failure);
    }
  }
  const { error: refundRecoveryError } = await d.db
    .from('kaspi_orders')
    .update({
      refund_status: 'unknown',
      refund_error: 'Возврат после изменения доставки ожидает подтверждения банка',
    })
    .eq('status', 'paid')
    .eq('refund_status', 'processing')
    .in('delivery_resolution->>status', ['cancel_refunding', 'pickup_rejecting'])
    .lt('refund_requested_at', new Date(d.now.getTime() - 5 * 60000).toISOString());
  if (refundRecoveryError) failures.push(refundRecoveryError);
  await work(null, d).catch((failure) => failures.push(failure));
  if (failures.length)
    throw new AggregateError(failures, 'Не все уведомления и решения по доставке обработаны');
}
module.exports = {
  timeoutMs,
  getDeliveryResolution,
  chooseDeliveryResolution,
  reviewDeliveryResolution,
  processDeliveryResolutions,
};

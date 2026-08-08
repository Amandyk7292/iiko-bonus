const { supabase } = require('../config/supabase');
const {
  commitOrReacquireOrderReservations,
  releaseOrderReservations,
} = require('./inventory.service');
const realtime = require('./realtime.service');
const { recordSystemEvent } = require('./analytics-event.service');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');
const { buildEtaForecast, etaDatabaseFields } = require('./eta.service');
const { effectiveFulfillmentType } = require('../utils/fulfillment.util');

const LATE_PAYMENT_CANCELLATION_REASONS = new Set(['Срок оплаты истёк', 'Оплата не прошла']);
const LATE_PAYMENT_AUTO_REFUND_PREFIX = 'Автоматический возврат поздней оплаты: ';

const isLatePaymentAutoRefund = (order) =>
  String(order?.cancellation_reason || '').startsWith(LATE_PAYMENT_AUTO_REFUND_PREFIX);

const paymentStatusCanTransition = (currentStatus, nextStatus) => {
  const current = String(currentStatus || 'pending');
  const next = String(nextStatus || '');
  if (!['pending', 'paid', 'failed', 'expired', 'refunded'].includes(next)) return false;
  if (current === next) return true;
  if (current === 'refunded') return false;
  if (current === 'paid') return next === 'refunded';
  if (next === 'paid') return true;
  return current === 'pending' && ['failed', 'expired'].includes(next);
};

const eligibleOrderAmount = (order) =>
  Math.max(0, Number(order?.subtotal ?? order?.amount ?? 0) - Number(order?.discount_amount || 0));

class OrderPaymentStateService {
  orderRecord({
    customerId,
    operationId,
    normalizedPhone,
    pricing,
    cartItems,
    checkout,
    paymentMethod,
    qrToken = null,
    eta = null,
  }) {
    const preparationMinutes = Math.min(240, Math.max(1, Number(pricing.preparationMinutes) || 15));
    const effectiveType =
      checkout.effectiveFulfillmentType ||
      effectiveFulfillmentType({
        fulfillment_type: checkout.orderType,
        preorder_fulfillment_type: checkout.preorderFulfillmentType,
      });
    const resolvedEta =
      eta ||
      buildEtaForecast({
        orderType: effectiveType,
        scheduledAt: checkout.scheduledAt,
        preparationMinutes,
        directDistanceKm: checkout.deliveryZone?.distanceKm,
      });
    return {
      customer_id: customerId,
      operation_id: operationId == null ? null : String(operationId),
      phone: normalizedPhone,
      amount: pricing.total,
      status: 'pending',
      cart_items: cartItems,
      subtotal: pricing.subtotal,
      discount_amount: pricing.discount,
      delivery_fee: pricing.deliveryFee || 0,
      promo_code: pricing.promoCode,
      fulfillment_type: checkout.orderType,
      preorder_fulfillment_type:
        checkout.orderType === 'preorder' ? checkout.preorderFulfillmentType : null,
      branch_id: checkout.branchId,
      branch_name: checkout.branch,
      scheduled_at: checkout.scheduledAt,
      pickup_time: checkout.pickupTime,
      delivery_address: checkout.deliveryAddress,
      delivery_latitude: checkout.deliveryAddress?.latitude ?? null,
      delivery_longitude: checkout.deliveryAddress?.longitude ?? null,
      additional_phone: checkout.additionalPhone,
      comment: checkout.comment,
      substitution_preference: checkout.substitutionPreference,
      fulfillment_status: 'pending',
      order_kind: checkout.orderKind === 'gift_certificate' ? 'gift_certificate' : 'product',
      preparation_minutes: preparationMinutes,
      ...etaDatabaseFields(resolvedEta, effectiveType),
      client_request_id: checkout.requestId,
      payment_method: paymentMethod,
      qr_token: qrToken,
    };
  }

  /**
   * Получение статуса заказа из нашей БД
   */
  async getOrderStatus(operationId, customerId) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .eq('customer_id', String(customerId))
      .maybeSingle();

    if (error) throw new Error('DB Error: ' + error.message);
    if (!data) {
      const error = new Error('Заказ не найден');
      error.statusCode = 404;
      throw error;
    }

    return data;
  }

  async reverseOrderLoyalty(order) {
    if (!order?.customer_id || order?.bonus_reversed_at) return order;
    const { error: reverseError } = await supabase.rpc('reverse_loyalty_order', {
      p_customer_id: order.customer_id,
      p_order_id: `kaspi:${order.operation_id}`,
      p_real_money_paid: eligibleOrderAmount(order),
    });
    if (reverseError) throw new Error('Не удалось сторнировать кэшбэк: ' + reverseError.message);
    queueCustomerLoyaltySync(order.customer_id);

    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ bonus_reversed_at: new Date().toISOString(), last_error: null })
      .eq('id', order.id)
      .is('bonus_reversed_at', null)
      .select()
      .maybeSingle();
    if (error) throw error;
    return data || order;
  }

  /**
   * Обновление статуса заказа (вызывается из вебхука)
   */
  async updateOrderStatus(operationId, newStatus, analytics = {}) {
    const normalizedStatus = String(newStatus || '');
    const { data: current, error: readError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();
    if (readError) throw readError;
    if (!current) return null;
    if (!paymentStatusCanTransition(current.status, normalizedStatus)) return current;
    if (current.status === normalizedStatus) return current;

    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ status: normalizedStatus, updated_at: new Date().toISOString() })
      .eq('operation_id', String(operationId))
      .eq('status', current.status)
      .select()
      .maybeSingle();

    if (error) {
      console.error('Ошибка обновления kaspi_orders:', error);
      throw error;
    }

    if (data) {
      if (data.order_kind === 'gift_certificate') {
        const {
          syncGiftCertificatePurchaseForOrder,
        } = require('./gift-certificate-purchase.service');
        if (data.status !== 'paid') {
          await syncGiftCertificatePurchaseForOrder(data).catch((giftError) =>
            console.error('Не удалось обновить покупку сертификата:', giftError.message),
          );
        }
      } else if (data.status === 'paid') {
        // recordPaidOrder performs the authoritative commit/reacquire before
        // any bonus, receipt or fulfillment transition.
      } else if (['failed', 'expired'].includes(data.status)) {
        await releaseOrderReservations(data.id).catch((error) =>
          console.error('Не удалось освободить резерв заказа:', error.message),
        );
        const { releasePromotionReservation } = require('./commerce-marketing.service');
        await releasePromotionReservation({ orderId: data.id }).catch((error) =>
          console.error('Не удалось освободить промокод заказа:', error.message),
        );
        await recordSystemEvent(data.customer_id, {
          type:
            analytics.type || (data.status === 'expired' ? 'payment_cancelled' : 'payment_failed'),
          orderId: data.id,
          branchId: data.branch_id,
          properties: {
            paymentMethod: data.payment_method || 'historical',
            providerStatus: String(analytics.providerStatus || data.status).slice(0, 120),
          },
        }).catch((eventError) =>
          console.error('Не удалось записать аналитику неуспешной оплаты:', eventError.message),
        );
      }
      realtime.publish(
        'order.updated',
        { orderId: data.id, paymentStatus: data.status, orderStatus: data.fulfillment_status },
        { customerId: data.customer_id, includeAdmins: true, branchId: data.branch_id },
      );
      return data;
    }
    const { data: latest, error: latestError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();
    if (latestError) throw latestError;
    return latest;
  }

  async awardOrderBonus(order) {
    if (!order?.customer_id || order.bonus_awarded_at) return order;
    const { getCustomerById, applyLoyaltyTransaction } = require('./customer.service');
    const { getSettings } = require('./settings.service');
    const { getActiveLoyaltyTiers } = require('./tier.service');
    const { getTierInfo } = require('../utils/tier.util');
    const [customer, settings] = await Promise.all([
      getCustomerById(order.customer_id),
      getSettings(),
    ]);
    if (!customer) throw new Error('Клиент оплаченного заказа не найден');
    const tiers = await getActiveLoyaltyTiers(settings);
    const tier = getTierInfo(customer.total_spent, tiers, settings);
    const eligibleAmount = eligibleOrderAmount(order);
    const earnedBonus = Math.max(0, Math.round(eligibleAmount * (Number(tier.percent || 0) / 100)));
    await applyLoyaltyTransaction({
      customerId: order.customer_id,
      orderId: `kaspi:${order.operation_id}`,
      discountAmount: 0,
      earnedBonus,
      orderTotal: eligibleAmount,
      realMoneyPaid: eligibleAmount,
      activationDelayDays: Number(settings.bonus_activation?.delay_days || 0),
      items: order.cart_items,
      branchId: order.branch_id,
    });
    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ earned_bonus: earnedBonus, bonus_awarded_at: new Date().toISOString() })
      .eq('id', order.id)
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async recordPaidOrder(operationId) {
    const { data: order, error: readError } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();
    if (readError) throw readError;
    if (!order || order.status !== 'paid') return order;

    if (
      ['processing', 'unknown', 'succeeded'].includes(String(order.refund_status || '')) ||
      order.status === 'refunded'
    ) {
      return order;
    }
    if (order.order_kind === 'gift_certificate') {
      const {
        activateGiftCertificateForPaidOrder,
      } = require('./gift-certificate-purchase.service');
      await activateGiftCertificateForPaidOrder(order);
      const { data: activatedOrder, error: activatedReadError } = await supabase
        .from('kaspi_orders')
        .select('*')
        .eq('id', order.id)
        .single();
      if (activatedReadError) throw activatedReadError;
      const { ensurePaymentReceipt } = require('./payment-receipt.service');
      await ensurePaymentReceipt(activatedOrder).catch((receiptError) =>
        console.error(
          `Не удалось создать чек сертификата ${activatedOrder.order_number}:`,
          receiptError.message,
        ),
      );
      realtime.publish(
        'gift-certificate.activated',
        {
          orderId: activatedOrder.id,
          orderNumber: activatedOrder.order_number,
          paymentStatus: activatedOrder.status,
        },
        {
          customerId: activatedOrder.customer_id,
          includeAdmins: true,
          branchId: null,
        },
      );
      return activatedOrder;
    }
    const latePaymentAutoRefund = isLatePaymentAutoRefund(order);
    const lateCleanupCancellation =
      order.fulfillment_status === 'cancelled' &&
      (latePaymentAutoRefund ||
        LATE_PAYMENT_CANCELLATION_REASONS.has(String(order.cancellation_reason || '')));
    if (order.fulfillment_status === 'cancelled' && !lateCleanupCancellation) {
      return order;
    }

    const beforeFulfillment = ['pending', 'new'].includes(
      String(order.fulfillment_status || 'pending'),
    );
    const mustValidateCapacity = beforeFulfillment || lateCleanupCancellation;
    const refundUnavailableOrder = async (reason) => {
      const { releasePromotionReservation } = require('./commerce-marketing.service');
      const { cancelPaidOrder } = require('./customer-order.service');
      const cancellationReason = String(reason || '').startsWith(LATE_PAYMENT_AUTO_REFUND_PREFIX)
        ? String(reason)
        : `${LATE_PAYMENT_AUTO_REFUND_PREFIX}${String(reason || '').trim()}`;
      await releasePromotionReservation({ orderId: order.id }).catch((error) =>
        console.error('Не удалось освободить промокод поздней оплаты:', error.message),
      );
      await cancelPaidOrder(order, cancellationReason, {
        allowedFulfillmentStatuses: [String(order.fulfillment_status || 'pending')],
        cancelBeforeRefund: true,
        reuseRefundRequestId: true,
      });
      const { data: refundedOrder, error: refundedReadError } = await supabase
        .from('kaspi_orders')
        .select('*')
        .eq('id', order.id)
        .maybeSingle();
      if (refundedReadError) throw refundedReadError;
      return refundedOrder || order;
    };

    if (latePaymentAutoRefund && order.refund_status === 'failed') {
      return refundUnavailableOrder(order.cancellation_reason);
    }

    if (mustValidateCapacity) {
      const reservation = await commitOrReacquireOrderReservations(order.id, {
        allowReacquire: true,
      });
      if (!['committed', 'already_committed'].includes(reservation.status)) {
        const productSuffix = reservation.productId ? ` (${reservation.productId})` : '';
        return refundUnavailableOrder(
          `Оплата поступила после освобождения резерва, а товар или время уже недоступны${productSuffix}`,
        );
      }
    }

    const {
      consumePromotionReservation,
      qualifyReferralForOrder,
    } = require('./commerce-marketing.service');
    const promotion = await consumePromotionReservation(order);
    if (
      mustValidateCapacity &&
      ['unavailable', 'promotion_missing'].includes(String(promotion.status || ''))
    ) {
      return refundUnavailableOrder(
        'Оплата поступила после истечения резерва промокода, и скидка уже недоступна',
      );
    }

    let recorded = order;
    if (order.fulfillment_status === 'pending' || lateCleanupCancellation) {
      const { data, error } = await supabase
        .from('kaspi_orders')
        .update({
          fulfillment_status: 'new',
          cancellation_reason: null,
          last_error: null,
        })
        .eq('id', order.id)
        .eq('fulfillment_status', order.fulfillment_status)
        .eq('status', 'paid')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (!data) {
        const { data: latest, error: latestError } = await supabase
          .from('kaspi_orders')
          .select('*')
          .eq('id', order.id)
          .maybeSingle();
        if (latestError) throw latestError;
        if (
          !latest ||
          latest.status !== 'paid' ||
          ['processing', 'unknown'].includes(String(latest.refund_status || '')) ||
          latest.fulfillment_status === 'cancelled'
        ) {
          return latest || order;
        }
        recorded = latest;
      } else {
        recorded = data;
      }
    }
    const finalOrder = recorded.bonus_awarded_at ? recorded : await this.awardOrderBonus(recorded);
    await recordSystemEvent(finalOrder.customer_id, {
      type: 'payment_paid',
      orderId: finalOrder.id,
      branchId: finalOrder.branch_id,
      properties: { amount: Number(finalOrder.amount || 0) },
    }).catch((eventError) =>
      console.error('Не удалось записать аналитику оплаты:', eventError.message),
    );
    await qualifyReferralForOrder(finalOrder).catch((marketingError) =>
      console.error(
        `Не удалось применить реферальный бонус заказа ${finalOrder.order_number}:`,
        marketingError.message,
      ),
    );
    const { ensurePaymentReceipt } = require('./payment-receipt.service');
    await ensurePaymentReceipt(finalOrder).catch((receiptError) =>
      console.error(
        `Не удалось создать или отправить чек заказа ${finalOrder.order_number}:`,
        receiptError.message,
      ),
    );
    realtime.publish(
      'order.created',
      {
        orderId: finalOrder.id,
        orderNumber: finalOrder.order_number,
        paymentStatus: finalOrder.status,
        orderStatus: finalOrder.fulfillment_status,
      },
      {
        customerId: finalOrder.customer_id,
        includeAdmins: true,
        branchId: finalOrder.branch_id,
      },
    );
    return finalOrder;
  }
}

module.exports = new OrderPaymentStateService();
module.exports.OrderPaymentStateService = OrderPaymentStateService;
module.exports.eligibleOrderAmount = eligibleOrderAmount;

module.exports.paymentStatusCanTransition = paymentStatusCanTransition;

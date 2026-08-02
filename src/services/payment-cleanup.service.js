const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');
const kaspiService = require('./kaspi.service');
const forteService = require('./forte.service');
const forteWidgetService = require('./forte-widget.service');
const { releaseOrderReservations } = require('./inventory.service');
const paymentOperations = require('./payment-operations.service');
const realtime = require('./realtime.service');
const { releasePromotionReservation } = require('./commerce-marketing.service');

const MINIMUM_PENDING_AGE_MS = 10 * 60 * 1000;
const WIDGET_EXPIRATION_GRACE_MS = 5 * 60 * 1000;
const KASPI_INVOICE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const FINAL_UNPAID_STATUSES = new Set(['failed', 'expired']);

const orderCreatedAtMs = (order) => Date.parse(order?.created_at || '') || 0;

const widgetExpirationMs = (order) => {
  const explicit = Date.parse(order?.payment_expires_at || '');
  if (Number.isFinite(explicit)) return explicit;
  const createdAt = orderCreatedAtMs(order);
  return createdAt ? createdAt + 30 * 60 * 1000 : 0;
};

const cancellationReason = (status) =>
  status === 'expired' ? 'Срок оплаты истёк' : 'Оплата не прошла';

const defaultListPendingOrders = async ({ cutoff, limit }) => {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('*')
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
};

const defaultListUnfinishedOrders = async ({ limit }) => {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .select('*')
    .in('status', [...FINAL_UNPAID_STATUSES])
    .in('fulfillment_status', ['pending', 'new'])
    .order('updated_at', { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data || [];
};

const defaultUpdateFulfillment = async (order, status, now) => {
  const { data, error } = await supabase
    .from('kaspi_orders')
    .update({
      fulfillment_status: 'cancelled',
      cancellation_reason: order.cancellation_reason || cancellationReason(status),
      updated_at: now.toISOString(),
    })
    .eq('id', order.id)
    .in('status', [...FINAL_UNPAID_STATUSES])
    .in('fulfillment_status', ['pending', 'new'])
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
};

class PaymentCleanupService {
  constructor({
    listPendingOrders = defaultListPendingOrders,
    listUnfinishedOrders = defaultListUnfinishedOrders,
    updateFulfillment = defaultUpdateFulfillment,
    releaseReservations = releaseOrderReservations,
    releasePromotion,
    kaspi = kaspiService,
    forte = forteService,
    widget = forteWidgetService,
    operations = paymentOperations,
    publish = realtime.publish.bind(realtime),
    env = process.env,
    loggerInstance = logger,
  } = {}) {
    this.listPendingOrders = listPendingOrders;
    this.listUnfinishedOrders = listUnfinishedOrders;
    this.updateFulfillment = updateFulfillment;
    this.releaseReservations = releaseReservations;
    this.releasePromotion =
      releasePromotion ||
      (releaseReservations === releaseOrderReservations
        ? releasePromotionReservation
        : async () => false);
    this.kaspi = kaspi;
    this.forte = forte;
    this.widget = widget;
    this.operations = operations;
    this.publish = publish;
    this.env = env;
    this.logger = loggerInstance;
  }

  async finalizeUnpaidOrder(order, status, now) {
    if (!order?.id || !FINAL_UNPAID_STATUSES.has(status)) return null;
    const updated = await this.updateFulfillment(order, status, now);
    if (!updated) return null;
    await this.releaseReservations(updated.id);
    await this.releasePromotion({ orderId: updated.id });
    this.publish(
      'order.updated',
      {
        orderId: updated.id,
        paymentStatus: updated.status,
        orderStatus: updated.fulfillment_status,
      },
      {
        customerId: updated.customer_id,
        includeAdmins: true,
        branchId: updated.branch_id,
      },
    );
    return updated;
  }

  async reconcilePendingOrder(order, now) {
    if (order.provider_payment_system === 'forte_widget') {
      let currentOrder = order;
      let status = order.status;
      let providerVerified = false;
      let verificationFailed = !this.widget.availability();
      if (!verificationFailed) {
        try {
          const result = await this.widget.syncOrder(order);
          currentOrder = result?.order || currentOrder;
          status = result?.status || status;
          providerVerified = true;
        } catch (error) {
          verificationFailed = true;
          this.logger.warn(
            { err: error, event: 'expired_payment_widget_sync_failed', orderId: order.id },
            'Widget payment could not be reconciled before cleanup',
          );
        }
      }
      if (
        providerVerified &&
        status === 'pending' &&
        widgetExpirationMs(order) > 0 &&
        now.getTime() >= widgetExpirationMs(order) + WIDGET_EXPIRATION_GRACE_MS
      ) {
        const updated = await this.kaspi.updateOrderStatus(order.operation_id, 'expired');
        return {
          order: updated || currentOrder,
          status: 'expired',
          expiredByCleanup: true,
          verificationFailed,
        };
      }
      return { order: currentOrder, status, expiredByCleanup: false, verificationFailed };
    }

    if (order.payment_method === 'forte_card') {
      if (!this.forte.availability()) return { order, status: order.status };
      const result = await this.forte.syncOrder(order);
      return { order: result?.order || order, status: result?.status || order.status };
    }

    if (this.env.KASPI_POS_ENABLED !== 'true') return { order, status: order.status };
    const status = await this.kaspi.syncRemoteOrder(order.operation_id);
    if (
      status === 'pending' &&
      order.payment_method === 'invoice' &&
      now.getTime() - orderCreatedAtMs(order) >= KASPI_INVOICE_MAX_AGE_MS
    ) {
      await this.kaspi.cancelInvoice(order.operation_id);
      const updated = await this.kaspi.updateOrderStatus(order.operation_id, 'expired');
      return { order: updated || order, status: 'expired', expiredByCleanup: true };
    }
    return { order, status: status || order.status, expiredByCleanup: false };
  }

  async cleanupExpiredPayments({ limit = 100, now = new Date() } = {}) {
    const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
    const cutoff = new Date(now.getTime() - MINIMUM_PENDING_AGE_MS).toISOString();
    const summary = {
      inspected: 0,
      expired: 0,
      cancelled: 0,
      released: 0,
      errors: 0,
    };
    const finalizedIds = new Set();
    const pendingOrders = await this.listPendingOrders({ cutoff, limit: safeLimit });

    for (const order of pendingOrders) {
      summary.inspected += 1;
      try {
        const result = await this.reconcilePendingOrder(order, now);
        if (result.verificationFailed) summary.errors += 1;
        if (result.expiredByCleanup) summary.expired += 1;
        if (FINAL_UNPAID_STATUSES.has(result.status)) {
          const finalized = await this.finalizeUnpaidOrder(
            result.order || order,
            result.status,
            now,
          );
          if (finalized) {
            summary.cancelled += 1;
            summary.released += 1;
            finalizedIds.add(String(order.id));
          }
        }
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          { err: error, event: 'expired_payment_cleanup_failed', orderId: order.id },
          'Expired payment cleanup failed',
        );
      }
    }

    const unfinishedOrders = await this.listUnfinishedOrders({ limit: safeLimit });

    for (const order of unfinishedOrders) {
      if (finalizedIds.has(String(order.id))) continue;
      try {
        const finalized = await this.finalizeUnpaidOrder(order, order.status, now);
        if (finalized) {
          summary.cancelled += 1;
          summary.released += 1;
        }
      } catch (error) {
        summary.errors += 1;
        this.logger.error(
          { err: error, event: 'unpaid_fulfillment_cleanup_failed', orderId: order.id },
          'Unpaid fulfillment cleanup failed',
        );
      }
    }

    await this.operations.recordCleanupResult(summary);
    return summary;
  }
}

const paymentCleanup = new PaymentCleanupService();

module.exports = {
  PaymentCleanupService,
  cleanupExpiredPayments: (...args) => paymentCleanup.cleanupExpiredPayments(...args),
  finalizeUnpaidOrder: (...args) => paymentCleanup.finalizeUnpaidOrder(...args),
  reconcilePendingOrder: (...args) => paymentCleanup.reconcilePendingOrder(...args),
  widgetExpirationMs,
};

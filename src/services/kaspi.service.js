const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');

const KASPI_URL =
  process.env.KASPI_MICROSERVICE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/kaspi-pos`;

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

const normalizeKaspiPhoneNumber = (value) => {
  const digits = digitsOnly(value);

  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;

  return null;
};

class KaspiService {
  internalHeaders(extra = {}) {
    const secret = String(process.env.KASPI_INTERNAL_SECRET || '');
    if (secret.length < 32) throw new Error('KASPI_INTERNAL_SECRET is not configured');
    return { Authorization: `Bearer ${secret}`, ...extra };
  }

  /**
   * Отправляет запрос на микросервис Kaspi для создания счета
   */
  async createInvoice(phone, pricing, customerId, checkout = {}) {
    const normalizedPhone = normalizeKaspiPhoneNumber(phone);
    if (!normalizedPhone) throw new Error('Invalid phoneNumber format');
    const { total: amount, canonicalItems: cartItems } = pricing;
    const { data: existing, error: existingError } = await supabase
      .from('kaspi_orders')
      .select('operation_id, payment_method, qr_token, amount')
      .eq('customer_id', customerId)
      .eq('client_request_id', checkout.requestId)
      .maybeSingle();
    if (existingError) throw new Error('Не удалось проверить заказ: ' + existingError.message);
    if (existing) {
      return {
        success: true,
        method: existing.payment_method || 'invoice',
        operationId: existing.operation_id,
        qrToken: existing.qr_token || undefined,
        amount: Number(existing.amount),
      };
    }

    let comment = 'Оплата заказа Bulka';
    if (cartItems && cartItems.length > 0) {
      const itemsList = cartItems.map((item) => `${item.name} x${item.quantity}`).join(', ');
      comment += `\n${itemsList}`;
    }

    // 1. Создаем счет через микросервис Kaspi
    const response = await fetch(`${KASPI_URL}/api/invoice/create`, {
      method: 'POST',
      headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify({
        phoneNumber: normalizedPhone,
        amount: amount,
        comment: comment,
      }),
    });

    let data;
    if (response.ok) {
      data = await response.json();
    } else {
      const err = await response.text();
      data = { ErrorMessage: err };
    }

    let operationId = data?.Data?.Id || data?.Data?.QrOperationId;

    // Если нет operationId, это значит счет выставить не удалось (например, нет Kaspi у клиента).
    // FALLBACK: Пробуем сгенерировать QR-код!
    if (!operationId) {
      console.warn('Kaspi invoice unavailable; falling back to QR payment');
      const qrResponse = await fetch(`${KASPI_URL}/api/qr/create`, {
        method: 'POST',
        headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ amount: amount, comment: comment }),
      });

      if (!qrResponse.ok) {
        const qrErr = await qrResponse.text();
        throw new Error(`Kaspi QR Service Error: ${qrErr}`);
      }

      const qrData = await qrResponse.json();
      operationId = qrData?.Data?.Id || qrData?.Data?.QrOperationId;
      const qrToken = qrData?.Data?.QrToken;

      if (!qrData.Data || !operationId || !qrToken) {
        throw new Error('Не удалось получить QR-код от Kaspi');
      }

      // Сохраняем QR-заказ в БД
      const { error } = await supabase.from('kaspi_orders').insert([
        {
          customer_id: customerId,
          operation_id: String(operationId),
          phone: normalizedPhone,
          amount: amount,
          status: 'pending',
          cart_items: cartItems,
          subtotal: pricing.subtotal,
          discount_amount: pricing.discount,
          promo_code: pricing.promoCode,
          branch_name: checkout.branch,
          pickup_time: checkout.pickupTime,
          additional_phone: checkout.additionalPhone,
          comment: checkout.comment,
          fulfillment_status: 'pending',
          client_request_id: checkout.requestId,
          payment_method: 'qr',
          qr_token: qrToken,
        },
      ]);

      if (error) throw new Error('Не удалось сохранить заказ: ' + error.message);

      return {
        success: true,
        method: 'qr',
        operationId: operationId,
        qrToken: qrToken,
        amount,
      };
    }

    // Если счет (invoice) успешно выставлен:
    const { error } = await supabase.from('kaspi_orders').insert([
      {
        customer_id: customerId,
        operation_id: String(operationId),
        phone: normalizedPhone,
        amount: amount,
        status: 'pending',
        cart_items: cartItems,
        subtotal: pricing.subtotal,
        discount_amount: pricing.discount,
        promo_code: pricing.promoCode,
        branch_name: checkout.branch,
        pickup_time: checkout.pickupTime,
        additional_phone: checkout.additionalPhone,
        comment: checkout.comment,
        fulfillment_status: 'pending',
        client_request_id: checkout.requestId,
        payment_method: 'invoice',
      },
    ]);

    if (error) {
      try {
        const cancelResponse = await fetch(`${KASPI_URL}/api/invoice/cancel`, {
          method: 'POST',
          headers: this.internalHeaders({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ operationId: String(operationId) }),
        });
        if (!cancelResponse.ok) throw new Error(`Kaspi returned ${cancelResponse.status}`);
      } catch (cancelError) {
        console.error('Не удалось отменить несохранённый счёт Kaspi:', cancelError.message);
      }
      throw new Error('Не удалось сохранить заказ: ' + error.message);
    }

    return {
      success: true,
      method: 'invoice',
      operationId: operationId,
      amount,
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

  /**
   * Обновление статуса заказа (вызывается из вебхука)
   */
  async updateOrderStatus(operationId, newStatus) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('operation_id', String(operationId))
      .select()
      .maybeSingle();

    if (error) {
      console.error('Ошибка обновления kaspi_orders:', error);
      throw error;
    }

    return data;
  }

  async syncRemoteOrder(operationId) {
    const response = await fetch(`${KASPI_URL}/api/payment/check/${operationId}`, {
      headers: this.internalHeaders(),
    });
    if (!response.ok) return null;
    const result = await response.json();
    const status = result?.kaspiStatus;
    if (!result?.success || !status) return null;

    if (status === 'Processed') {
      await this.updateOrderStatus(operationId, 'paid');
      await this.recordPaidOrder(operationId);
      return 'paid';
    }
    if (
      [
        'RemotePaymentCanceled',
        'RemotePaymentRejected',
        'CancelledByUser',
        'ProcessingFailed',
        'Rejected',
        'Error',
      ].includes(status)
    ) {
      await this.updateOrderStatus(operationId, 'failed');
      return 'failed';
    }
    if (['Expired', 'QrTokenDiscarded'].includes(status)) {
      await this.updateOrderStatus(operationId, 'expired');
      return 'expired';
    }
    return 'pending';
  }

  async reconcileOrders() {
    const { data: orders, error } = await supabase
      .from('kaspi_orders')
      .select('operation_id, status, fulfillment_status, bonus_awarded_at')
      .in('status', ['pending', 'paid'])
      .order('created_at', { ascending: true })
      .limit(50);
    if (error) throw error;

    for (const order of orders || []) {
      try {
        if (
          order.status === 'paid' &&
          (order.fulfillment_status === 'pending' || !order.bonus_awarded_at)
        ) {
          await this.recordPaidOrder(order.operation_id);
        } else if (order.status === 'pending') {
          await this.syncRemoteOrder(order.operation_id);
        }
      } catch (reconcileError) {
        console.error(`Не удалось сверить заказ ${order.operation_id}:`, reconcileError.message);
      }
    }
    return (orders || []).length;
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
    const earnedBonus = Math.max(
      0,
      Math.round(Number(order.amount || 0) * (Number(tier.percent || 0) / 100)),
    );
    await applyLoyaltyTransaction({
      customerId: order.customer_id,
      orderId: `kaspi:${order.operation_id}`,
      discountAmount: 0,
      earnedBonus,
      orderTotal: Number(order.amount || 0),
      realMoneyPaid: Number(order.amount || 0),
      activationDelayDays: Number(settings.bonus_activation?.delay_days || 0),
      items: order.cart_items,
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
    let recorded = order;
    if (order.fulfillment_status === 'pending') {
      const { data, error } = await supabase
        .from('kaspi_orders')
        .update({
          fulfillment_status: 'new',
          last_error: null,
        })
        .eq('id', order.id)
        .eq('fulfillment_status', 'pending')
        .select()
        .maybeSingle();
      if (error) throw error;
      if (data) recorded = data;
    }
    return recorded.bonus_awarded_at ? recorded : this.awardOrderBonus(recorded);
  }
}

module.exports = new KaspiService();

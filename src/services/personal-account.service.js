const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const orderState = require('./order-payment-state.service');
const realtime = require('./realtime.service');
const { toMinorUnits } = require('./forte.service');

const accountError = (message, code, statusCode = 409) =>
  Object.assign(new Error(message), { code, statusCode });
const unwrap = (value) => (Array.isArray(value) ? value[0] : value);

class PersonalAccountService {
  constructor({
    db = supabase,
    orders = orderState,
    env = process.env,
    publish = (...args) => realtime.publish(...args),
    attachInventory = (...args) => require('./inventory.service').attachOrderReservations(...args),
    attachPromotion = (...args) =>
      require('./commerce-marketing.service').attachPromotionReservation(...args),
    markPayment = (...args) =>
      require('./delivery-budget.service').deliveryBudget.markPayment(...args),
  } = {}) {
    this.db = db;
    this.orders = orders;
    this.env = env;
    this.publish = publish;
    this.attachInventory = attachInventory;
    this.attachPromotion = attachPromotion;
    this.markPayment = markPayment;
  }
  enabled() {
    return this.env.PERSONAL_ACCOUNT_ENABLED !== 'false';
  }
  notify(customerId) {
    this.publish('personal-account.updated', {}, { customerId, includeAdmins: false });
  }
  async balance(customerId) {
    const [account, history] = await Promise.all([
      this.db
        .from('personal_accounts')
        .select('balance_minor,blocked')
        .eq('customer_id', customerId)
        .maybeSingle(),
      this.db
        .from('personal_account_entries')
        .select('id,amount_minor,kind,created_at')
        .eq('customer_id', customerId)
        .order('created_at', { ascending: false })
        .limit(100),
    ]);
    if (account.error) throw account.error;
    if (history.error) throw history.error;
    return {
      enabled: this.enabled(),
      balance: Number(account.data?.balance_minor || 0) / 100,
      blocked: account.data?.blocked === true,
      entries: (history.data || []).map((row) => ({
        id: row.id,
        amount: Number(row.amount_minor) / 100,
        kind: row.kind,
        createdAt: row.created_at,
      })),
    };
  }
  async existingRequest(customerId, requestId) {
    const { data, error } = await this.db
      .from('kaspi_orders')
      .select('*')
      .eq('customer_id', customerId)
      .eq('client_request_id', requestId)
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  paymentResponse(order) {
    return {
      success: true,
      operationId: String(order.operation_id),
      orderId: String(order.id),
      amount: Number(order.amount),
      paymentStatus: order.status,
      status: order.status,
      method: 'personal_account',
      fulfillmentStatus: order.fulfillment_status || 'pending',
    };
  }
  async findOrder(operationId, customerId) {
    const { data, error } = await this.db
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', operationId)
      .eq('customer_id', customerId)
      .eq('payment_method', 'personal_account')
      .maybeSingle();
    if (error) throw error;
    return data;
  }
  async reconcileOrders() {
    const { data, error } = await this.db
      .from('kaspi_orders')
      .select('*')
      .eq('payment_method', 'personal_account')
      .eq('status', 'paid')
      .in('fulfillment_status', ['pending', 'cancelled'])
      .order('updated_at', { ascending: true })
      .limit(50);
    if (error) throw error;
    for (const order of data || []) {
      try {
        await this.orders.recordPaidOrder(order.operation_id);
      } catch (error) {
        console.error(
          'Не удалось завершить оплату с личного счёта:',
          error.code || 'PERSONAL_ACCOUNT_ORDER_PENDING',
        );
      }
    }
    return (data || []).length;
  }
  async settleOrder(order) {
    if (order.status === 'pending') {
      const { data, error } = await this.db.rpc('personal_account_pay_order', {
        p_customer_id: order.customer_id,
        p_order_id: order.id,
      });
      if (error) throw error;
      const status = unwrap(data)?.status;
      if (status === 'insufficient' || status === 'blocked') {
        await this.orders.updateOrderStatus(order.operation_id, 'failed');
        throw accountError(
          status === 'blocked'
            ? 'Личный счёт заблокирован'
            : 'Недостаточно средств на личном счёте',
          status === 'blocked' ? 'PERSONAL_ACCOUNT_BLOCKED' : 'PERSONAL_ACCOUNT_INSUFFICIENT',
        );
      }
      if (status !== 'paid')
        throw accountError(
          'Результат оплаты ещё проверяется',
          'PERSONAL_ACCOUNT_PAYMENT_PENDING',
          503,
        );
      order = { ...order, status: 'paid' };
    }
    if (order.status === 'paid')
      order = (await this.orders.recordPaidOrder(order.operation_id)) || order;
    this.notify(order.customer_id);
    return this.paymentResponse(order);
  }
  async createCheckout(phone, pricing, customerId, checkout) {
    if (!this.enabled())
      throw accountError('Личный счёт временно недоступен', 'PERSONAL_ACCOUNT_DISABLED', 503);
    let order = await this.existingRequest(customerId, checkout.requestId);
    if (order) {
      if (order.payment_method !== 'personal_account')
        throw accountError(
          'Оформление связано с другим способом оплаты',
          'PAYMENT_REQUEST_ALREADY_USED',
        );
      return this.settleOrder(order);
    }
    const record = this.orders.orderRecord({
      customerId,
      operationId: checkout.requestId,
      normalizedPhone: phone,
      pricing,
      cartItems: pricing.canonicalItems,
      checkout,
      paymentMethod: 'personal_account',
    });
    const { data, error } = await this.db
      .from('kaspi_orders')
      .insert([
        {
          ...record,
          id: crypto.randomUUID(),
          provider_status: 'pending',
          personal_account_fingerprint: crypto
            .createHash('sha256')
            .update(JSON.stringify([pricing.total, pricing.canonicalItems, checkout]))
            .digest('hex'),
        },
      ])
      .select('*')
      .single();
    if (error) {
      order = await this.existingRequest(customerId, checkout.requestId);
      if (!order || order.payment_method !== 'personal_account') throw error;
    } else order = data;
    await this.attachInventory(customerId, checkout.requestId, order.id);
    if (pricing.promotionId) await this.attachPromotion(customerId, checkout.requestId, order.id);
    await this.markPayment(pricing.deliveryBudgetReservationId);
    return this.settleOrder(order);
  }
  async refundPayment(order, amount, { idempotencyKey } = {}) {
    if (!idempotencyKey)
      throw accountError(
        'Отсутствует идентификатор возврата',
        'PERSONAL_ACCOUNT_REFUND_ID_REQUIRED',
      );
    const { data, error } = await this.db.rpc('personal_account_refund_order', {
      p_order_id: order.id,
      p_request_id: idempotencyKey,
      p_amount_minor: toMinorUnits(amount),
    });
    if (error) throw error;
    this.notify(order.customer_id);
    return unwrap(data);
  }
}
module.exports = new PersonalAccountService();
module.exports.PersonalAccountService = PersonalAccountService;
module.exports.accountError = accountError;

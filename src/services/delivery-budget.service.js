const { supabase } = require('../config/supabase');
const { isDeliveryFulfillment } = require('../utils/fulfillment.util');
const { finalJobCost, verifiedMoney } = require('./delivery-budget-cost');
const { logger } = require('../config/logger');

const budgetError = () =>
  Object.assign(new Error('В данный момент доставка временно недоступна. Выберите самовывоз.'), {
    statusCode: 503,
    code: 'DELIVERY_TEMPORARILY_UNAVAILABLE',
  });
const positiveEstimate = (value) =>
  Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 100_000;

class DeliveryBudgetService {
  constructor({ db = supabase } = {}) {
    this.db = db;
  }

  get isolated() {
    return process.env.NODE_ENV === 'test' && this.db === supabase;
  }

  async rpc(name, args = {}) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) {
      logger.error(
        { event: 'delivery_budget_store_failed', code: error.code, operation: name },
        'Delivery budget unavailable',
      );
      throw budgetError();
    }
    return data;
  }

  async snapshot() {
    if (this.isolated)
      return { balance: 5000, reserved: 0, available: 5000, bufferPercent: 50, revision: 1 };
    const result = await this.rpc('delivery_budget_snapshot');
    if (!result || !Number.isFinite(Number(result.available))) throw budgetError();
    return result;
  }

  async check(estimate) {
    if (!positiveEstimate(estimate)) throw budgetError();
    if (this.isolated) return;
    const state = await this.snapshot();
    if (
      Number(state.available) <
      Math.ceil(Number(estimate) * (1 + Number(state.bufferPercent) / 100))
    )
      throw budgetError();
  }

  async reserve(customerId, requestId, estimate, orderId = null, dispatch = false) {
    if (!positiveEstimate(estimate)) throw budgetError();
    if (this.isolated)
      return { id: 'isolated-budget-reservation', amount: Math.ceil(estimate * 1.5) };
    const result = await this.rpc('reserve_delivery_budget', {
      p_customer_id: customerId,
      p_request_id: requestId,
      p_estimate: estimate,
      p_order_id: orderId,
      p_dispatch: dispatch,
    });
    if (result?.status !== 'reserved') throw budgetError();
    return result;
  }

  async markPayment(id) {
    if (!id || this.isolated) return;
    if (!(await this.rpc('mark_delivery_budget_payment', { p_reservation_id: id })))
      throw budgetError();
  }

  async releaseUnstarted(customerId, requestId) {
    if (this.isolated || !customerId || !requestId) return;
    await this.rpc('release_unstarted_delivery_budget', {
      p_customer_id: customerId,
      p_request_id: requestId,
    });
  }

  async ensurePaid(order) {
    if (this.isolated || !isDeliveryFulfillment(order) || !order.delivery_budget_required)
      return true;
    const { data, error } = await this.db
      .from('delivery_budget_reservations')
      .select('estimate')
      .eq('customer_id', order.customer_id)
      .eq('request_id', order.client_request_id)
      .maybeSingle();
    if (error) throw budgetError();
    if (!data) return false;
    const result = await this.rpc('reserve_delivery_budget', {
      p_customer_id: order.customer_id,
      p_request_id: order.client_request_id,
      p_estimate: data.estimate,
      p_order_id: order.id,
      p_dispatch: false,
    });
    return result?.status === 'reserved';
  }

  async ensureDispatch(job, estimate) {
    if (this.isolated) return;
    const { data: order, error } = await this.db
      .from('kaspi_orders')
      .select('id,customer_id,client_request_id')
      .eq('id', job.order_id)
      .single();
    if (error || !order) throw budgetError();
    return this.reserve(
      order.customer_id,
      order.client_request_id || order.id,
      estimate,
      order.id,
      true,
    );
  }

  async observeJob(job) {
    if (this.isolated) return;
    const cost = finalJobCost(job);
    if (cost == null) return;
    await this.rpc('record_delivery_budget_cost', {
      p_source: `job:${job.id}`,
      p_cost: cost,
      p_order_id: job.order_id,
    });
  }

  async observeProbe(probe) {
    if (this.isolated) return;
    const cost =
      probe.provider_status === 'cancelled'
        ? 0
        : probe.provider_status === 'cancelled_with_payment'
          ? verifiedMoney(probe.budget_final_cost)
          : null;
    if (cost == null) return;
    await this.rpc('record_delivery_budget_cost', {
      p_source: `probe:${probe.id}`,
      p_cost: cost,
      p_order_id: null,
    });
  }

  async adjust(body, actor) {
    if (body.mode === 'balance') await this.reconcile();
    const result = await this.rpc('adjust_delivery_budget', {
      p_request_id: body.requestId,
      p_revision: body.revision,
      p_amount: body.amount,
      p_mode: body.mode,
      p_actor: actor,
    });
    if (result?.status === 'stale')
      throw Object.assign(new Error('Бюджет изменился. Обновите данные и повторите.'), {
        statusCode: 409,
      });
    if (result?.status === 'unsettled')
      throw Object.assign(
        new Error(
          'Есть доставки с неуточнённым расходом. Пока можно учесть пополнение; сверка остатка доступна после их завершения.',
        ),
        { statusCode: 409 },
      );
    return result;
  }

  async reconcile() {
    if (this.isolated) return;
    const pending = await this.rpc('pending_delivery_budget_costs');
    let failures = 0;
    for (let job of pending.jobs || []) {
      try {
        if (finalJobCost(job) == null && job.external_claim_id) {
          job = await require('./yandex-delivery.service').refreshBudgetCost(job);
        }
        await this.observeJob(job);
      } catch (error) {
        failures++;
        logger.warn(
          { event: 'delivery_budget_cost_pending', jobId: job.id, code: error.code },
          'Courier cost reconciliation pending',
        );
      }
    }
    for (const probe of pending.probes || []) await this.observeProbe(probe);
    await this.rpc('reconcile_delivery_budget');
    if (failures) throw budgetError();
  }
}

const deliveryBudget = new DeliveryBudgetService();
module.exports = { deliveryBudget, DeliveryBudgetService, budgetError };

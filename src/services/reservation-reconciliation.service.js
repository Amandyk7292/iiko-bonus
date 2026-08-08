const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const DEFAULT_RECONCILIATION_LIMIT = 200;
const MAX_RECONCILIATION_LIMIT = 1000;

const normalizedLimit = (value) => {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return DEFAULT_RECONCILIATION_LIMIT;
  return Math.min(Math.max(parsed, 1), MAX_RECONCILIATION_LIMIT);
};

const normalizedCount = (value) => Math.max(0, Number.parseInt(value, 10) || 0);

const normalizeSummary = (data) => {
  const source = Array.isArray(data) ? data[0] : data;
  const summary = source && typeof source === 'object' ? source : {};
  return {
    candidates: normalizedCount(summary.candidates),
    ordersReleased: normalizedCount(summary.ordersReleased),
    inventoryReservationsReleased: normalizedCount(summary.inventoryReservationsReleased),
    slotReservationsReleased: normalizedCount(summary.slotReservationsReleased),
  };
};

class ReservationReconciliationService {
  constructor({ db = supabase, loggerInstance = logger } = {}) {
    this.db = db;
    this.logger = loggerInstance;
  }

  async reconcileClosedOrders({ limit = DEFAULT_RECONCILIATION_LIMIT } = {}) {
    const { data, error } = await this.db.rpc('reconcile_closed_order_reservations', {
      p_limit: normalizedLimit(limit),
    });
    if (error) {
      const reconciliationError = new Error('Closed-order reservation reconciliation failed', {
        cause: error,
      });
      reconciliationError.code = 'RESERVATION_RECONCILIATION_FAILED';
      throw reconciliationError;
    }

    const summary = normalizeSummary(data);
    if (summary.ordersReleased > 0) {
      this.logger.info(
        { event: 'closed_order_reservations_reconciled', ...summary },
        'Closed-order reservations reconciled',
      );
    }
    return summary;
  }
}

const reservationReconciliationService = new ReservationReconciliationService();

const reconcileClosedOrderReservations = (options) =>
  reservationReconciliationService.reconcileClosedOrders(options);

module.exports = {
  DEFAULT_RECONCILIATION_LIMIT,
  MAX_RECONCILIATION_LIMIT,
  ReservationReconciliationService,
  normalizeSummary,
  reconcileClosedOrderReservations,
};

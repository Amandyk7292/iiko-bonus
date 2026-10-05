const { supabase } = require('../config/supabase');
const { badRequest, conflict } = require('../utils/app-error.util');

const paymentErrors = {
  CASHIER_PAYROLL_SNAPSHOT_CHANGED: 'Начисления изменились. Обновите ведомость и повторите.',
  CASHIER_PAYROLL_NOTHING_OUTSTANDING: 'Нет доступных начислений для выплаты. Обновите ведомость.',
  CASHIER_PAYROLL_IDEMPOTENCY_CONFLICT: 'Запрос выплаты изменился. Обновите ведомость.',
};

function createCashierPayroll({ db = supabase } = {}) {
  async function rpc(name, args) {
    const { data, error } = await db.rpc(name, args);
    if (error) {
      if (error.code === '22023') {
        throw badRequest('CASHIER_PAYROLL_INVALID_REQUEST', 'Некорректные параметры ведомости.');
      }
      if (error.code === 'P0001' && paymentErrors[error.message]) {
        throw conflict(error.message, paymentErrors[error.message]);
      }
      if (error.code === '23505') {
        throw conflict(
          'CASHIER_PAYROLL_SNAPSHOT_CHANGED',
          paymentErrors.CASHIER_PAYROLL_SNAPSHOT_CHANGED,
        );
      }
      throw error;
    }
    return data;
  }
  return {
    statement({ month, branches = [] }) {
      return rpc('cashier_payroll_statement', { p_month: month, p_branches: branches });
    },
    markPaid({ month, rowKey, snapshot, idempotencyKey, actor, branches = [] }) {
      return rpc('mark_cashier_payroll_paid', {
        p_month: month,
        p_row_key: rowKey,
        p_snapshot: snapshot,
        p_idempotency_key: idempotencyKey,
        p_actor: actor,
        p_branches: branches,
      });
    },
  };
}

const cashierPayroll = createCashierPayroll();
module.exports = { createCashierPayroll, cashierPayroll };

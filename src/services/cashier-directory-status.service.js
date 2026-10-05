const { supabase } = require('../config/supabase');
const { publicError } = require('../utils/app-error.util');

const unavailable = () =>
  publicError(503, 'CASHIER_DIRECTORY_STATUS_UNAVAILABLE', 'Статус синхронизации недоступен.');
const timestamp = (value) => {
  if (value == null) return null;
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) throw unavailable();
  return new Date(value).toISOString();
};
const publicStatus = (row) => {
  if (
    !row ||
    !['ok', 'error', 'stale', 'never'].includes(row.state) ||
    !Number.isInteger(row.consecutiveFailures) ||
    row.consecutiveFailures < 0 ||
    (row.cashierCount != null &&
      (!Number.isInteger(row.cashierCount) || row.cashierCount < 0 || row.cashierCount > 20000))
  ) {
    throw unavailable();
  }
  // Explicit fields only: adding internal source/error information to a future
  // database response must never expose it through the admin API.
  return {
    state: row.state,
    lastAttemptAt: timestamp(row.lastAttemptAt),
    lastSuccessAt: timestamp(row.lastSuccessAt),
    lastFailureAt: timestamp(row.lastFailureAt),
    failureSince: timestamp(row.failureSince),
    consecutiveFailures: row.consecutiveFailures,
    cashierCount: row.cashierCount ?? null,
  };
};

function createCashierDirectoryStatus({ db = supabase } = {}) {
  const rpc = async (name, args = {}) => {
    try {
      const { data, error } = await db.rpc(name, args);
      if (error) throw unavailable();
      return data;
    } catch {
      throw unavailable();
    }
  };
  return {
    async begin() {
      const attempt = await rpc('begin_cashier_directory_sync');
      if (typeof attempt !== 'string' || !/^[1-9][0-9]{0,18}$/.test(attempt)) throw unavailable();
      return attempt;
    },
    async complete(attempt, cashiers) {
      return rpc('sync_cashier_directory_with_status', {
        p_attempt_id: attempt,
        p_cashiers: cashiers,
      });
    },
    async fail(attempt) {
      await rpc('fail_cashier_directory_sync', { p_attempt_id: attempt });
    },
    async getStatus() {
      return publicStatus(await rpc('get_cashier_directory_sync_status'));
    },
  };
}

const cashierDirectoryStatus = createCashierDirectoryStatus();
module.exports = { createCashierDirectoryStatus, cashierDirectoryStatus, publicStatus };

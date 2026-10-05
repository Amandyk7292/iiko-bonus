const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { staffDirectory } = require('./staff-directory.service');
const { createCashierDirectoryStatus } = require('./cashier-directory-status.service');
const { notFound } = require('../utils/app-error.util');

const invitationUrl = (token) =>
  `${String(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').replace(/\/$/, '')}/cashier-register?cashier=${token}`;
const toPublic = (row) => ({
  id: row.employee_id,
  name: row.name,
  pointId: row.point_id ?? null,
  branchName: row.branch_name,
  city: row.city,
  inviteToken: row.invite_token,
  url: invitationUrl(row.invite_token),
});

function createCashierSignup({
  db = supabase,
  directory = staffDirectory,
  status = createCashierDirectoryStatus({ db }),
} = {}) {
  let syncTask;
  const readAndSync = async () => {
    const attempt = await status.begin();
    try {
      const cashiers = await directory.listCashiers();
      const data = await status.complete(
        attempt,
        cashiers.map((cashier) => ({
          ...cashier,
          inviteToken: crypto.randomBytes(32).toString('hex'),
        })),
      );
      return data?.items || [];
    } catch (error) {
      // Preserve the original protective failure even when health persistence
      // itself is unavailable. Saved status never authorizes a QR redemption.
      await status.fail(attempt).catch(() => {});
      throw error;
    }
  };
  // Page refreshes and the background worker share one full source read. Do
  // not retain a result: the next refresh must see new/deleted HR employees.
  const sync = async () => {
    if (!syncTask) {
      syncTask = readAndSync().finally(() => {
        syncTask = undefined;
      });
    }
    return syncTask;
  };
  const resolve = async (token) => {
    const { data: row, error } = await db
      .from('cashier_signup_directory')
      .select('employee_id,invite_token')
      .eq('invite_token', token)
      .maybeSingle();
    if (error) throw error;
    if (!row) throw notFound('CASHIER_INVITE_UNAVAILABLE', 'QR сотрудника недоступен.');
    // Read the canonical archive status for every redemption. A cached list or
    // a QR saved before dismissal cannot authorize a salary accrual.
    const cashier = await directory.findCashier(row.employee_id);
    if (!cashier?.isActive || cashier.id !== row.employee_id) {
      throw notFound('CASHIER_INVITE_UNAVAILABLE', 'QR сотрудника недоступен.');
    }
    return cashier;
  };
  return {
    sync,
    resolve,
    async list({ city, search } = {}) {
      const rows = await sync();
      const items = rows.map(toPublic);
      const cities = [...new Set(items.map((item) => item.city))].sort((a, b) =>
        a.localeCompare(b, 'ru'),
      );
      const needle = String(search || '').toLowerCase();
      return {
        items: items.filter(
          (item) =>
            (!city || item.city === city) &&
            (!needle || `${item.name} ${item.branchName}`.toLowerCase().includes(needle)),
        ),
        cities,
      };
    },
    async invitation(token) {
      const cashier = await resolve(token);
      return {
        cashier: { name: cashier.name, branchName: cashier.branchName, city: cashier.city },
        inviteToken: token,
      };
    },
    async ranking({ from, to, branches }) {
      try {
        await sync();
      } catch (error) {
        // Managers can inspect the last complete saved roster during an HR
        // outage. First-sync failure must not look like a successful empty list.
        const saved = await status.getStatus();
        if (!saved.lastSuccessAt) throw error;
      }
      const directoryStatus = await status.getStatus();
      const { data, error } = await db.rpc('cashier_signup_ranking', {
        p_from: `${from}T00:00:00+05:00`,
        p_to: new Date(Date.parse(`${to}T00:00:00+05:00`) + 86400000).toISOString(),
        p_branches: branches,
      });
      if (error) throw error;
      const items = (data?.items || []).map((item) => ({
        ...item,
        url: item.inviteToken ? invitationUrl(item.inviteToken) : null,
      }));
      return {
        items,
        reviewPolicy: data?.reviewPolicy,
        directoryStatus: {
          ...directoryStatus,
          cashierCount: branches?.length ? null : directoryStatus.cashierCount,
        },
        totals: {
          completed: items.reduce((sum, item) => sum + Number(item.completed), 0),
          rewardAmount: items.reduce((sum, item) => sum + Number(item.rewardAmount), 0),
        },
      };
    },
    async finish(customer, profile, token, phoneKey, cashierSnapshot) {
      const cashier = cashierSnapshot || (await resolve(token));
      const { data, error } = await db.rpc('finish_customer_registration_with_cashier', {
        p_customer_id: customer.id,
        p_phone_key: phoneKey,
        p_profile: profile,
        p_cashier_token: token,
        p_cashier: cashier,
      });
      if (error) throw error;
      return data;
    },
  };
}
const cashierSignup = createCashierSignup();
module.exports = { createCashierSignup, cashierSignup, invitationUrl };

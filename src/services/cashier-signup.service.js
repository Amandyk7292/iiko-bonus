const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { staffDirectory } = require('./staff-directory.service');
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

function createCashierSignup({ db = supabase, directory = staffDirectory } = {}) {
  let syncTask;
  const readAndSync = async () => {
    const cashiers = await directory.listCashiers();
    const { data, error } = await db.rpc('sync_cashier_signup_directory', {
      p_cashiers: cashiers.map((cashier) => ({
        ...cashier,
        inviteToken: crypto.randomBytes(32).toString('hex'),
      })),
    });
    if (error) throw error;
    return data?.items || [];
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
      await sync();
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

const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const {
  isValidCashierUsername,
  normalizeCashierUsername,
} = require('./admin-credential-auth.service');
const DUMMY_HASH = '$2b$12$4ojkOJkkZ0OkGMSV5W8oKuR0nm4G9Djwrn1XF.7z9KqNhxQH1Ugkq';
async function authenticateDashboard(username, password, { db = supabase } = {}) {
  username = normalizeCashierUsername(username);
  if (!isValidCashierUsername(username) || !password || Buffer.byteLength(password) > 72)
    return null;
  const { data, error } = await db.rpc('get_iiko_dashboard_auth_record', { p_username: username });
  if (error) throw error;
  const record = Array.isArray(data) ? data[0] : data;
  const valid = await bcrypt.compare(password, record?.password_hash || DUMMY_HASH);
  if (!valid || !record?.active || record.username !== username || record.role !== 'iiko_dashboard')
    return null;
  return { username, role: record.role, branchIds: [], authVersion: Number(record.auth_version) };
}
async function createDashboardAccess(username, password, { db = supabase } = {}) {
  username = normalizeCashierUsername(username);
  if (
    !isValidCashierUsername(username) ||
    String(password).length < 8 ||
    Buffer.byteLength(password) > 72
  )
    throw new Error('Invalid dashboard credentials');
  const existing = await authenticateDashboard(username, password, { db });
  if (existing) return { username, role: existing.role, existing: true };
  const hash = await bcrypt.hash(password, 12);
  const { data, error } = await db.rpc('create_iiko_dashboard_access', {
    p_username: username,
    p_display_name: username,
    p_password_hash: hash,
  });
  if (error) throw error;
  return data;
}
module.exports = { authenticateDashboard, createDashboardAccess };

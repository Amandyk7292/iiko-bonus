const { createClient } = require('@supabase/supabase-js');
const { publicError } = require('../utils/app-error.util');

const unavailable = () =>
  publicError(503, 'STAFF_DIRECTORY_UNAVAILABLE', 'Список сотрудников временно недоступен.');
const idText = (value) => {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw unavailable();
  const id = String(value ?? '');
  if (!/^[1-9][0-9]{0,18}$/.test(id)) throw unavailable();
  return id;
};
const cleanText = (value, maximum) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > maximum)
    throw unavailable();
  return value.trim().replace(/\s+/g, ' ');
};

function createStaffDirectory({ client, mappingDb, env = process.env } = {}) {
  let db = client;
  const database = () => {
    if (db) return db;
    const url = String(env.STAFF_DIRECTORY_SUPABASE_URL || '');
    const key = String(
      env.STAFF_DIRECTORY_SERVICE_ROLE_KEY || env.STAFF_DIRECTORY_SUPABASE_KEY || '',
    );
    if (!/^https:\/\/[^/]+\.supabase\.co\/?$/.test(url) || !key) throw unavailable();
    db = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: {
        fetch: (input, options) => fetch(input, { ...options, signal: AbortSignal.timeout(10000) }),
      },
    });
    return db;
  };
  const read = async () => {
    try {
      // The source grants this dedicated, read-only function access to the five
      // public directory fields. Employee/contact/auth/payroll tables stay under
      // their existing RLS. An anon key cannot silently hide the roster here.
      const source = database();
      const rows = [];
      // PostgREST caps rows even for set-returning RPCs. Request smaller pages
      // explicitly so a roster above the default 1000 is never marked archived.
      for (let offset = 0; offset <= 20000; offset += 500) {
        const { data, error } = await source
          .rpc('bulka_cashier_signup_directory')
          .range(offset, offset + 499);
        if (error || !Array.isArray(data) || data.length > 500) throw unavailable();
        rows.push(...data);
        if (rows.length > 20000) throw unavailable();
        if (data.length < 500) break;
      }
      // HR point IDs and customer branch UUIDs are different identity spaces.
      // Only an explicitly reviewed mapping may establish branch permissions.
      const branchMappings = new Map();
      if (rows.some((row) => row.point_id != null)) {
        const target = mappingDb || require('../config/supabase').supabase;
        for (let offset = 0; offset <= 20000; offset += 500) {
          const { data, error } = await target
            .from('staff_cashier_branch_mappings')
            .select('point_id,branch_id')
            .order('point_id')
            .range(offset, offset + 499);
          if (error || !Array.isArray(data) || data.length > 500) throw unavailable();
          for (const mapping of data) {
            const point = idText(mapping.point_id);
            if (
              !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                mapping.branch_id,
              ) ||
              branchMappings.has(point)
            )
              throw unavailable();
            branchMappings.set(point, mapping.branch_id.toLowerCase());
          }
          if (branchMappings.size > 20000) throw unavailable();
          if (data.length < 500) break;
        }
      }
      const seen = new Set();
      return rows.map((row) => {
        const id = idText(row.id);
        if (seen.has(id)) throw unavailable();
        seen.add(id);
        return {
          id,
          name: cleanText(row.name, 240),
          pointId: row.point_id == null ? null : idText(row.point_id),
          branchName: cleanText(row.branch_name || 'Точка не назначена', 240),
          city: cleanText(row.city || 'Не указан', 120),
          branchId: row.point_id == null ? null : branchMappings.get(idText(row.point_id)) || null,
          isActive: true,
        };
      });
    } catch {
      throw unavailable();
    }
  };
  return {
    listCashiers: read,
    async findCashier(id) {
      const employeeId = idText(id);
      // Eligibility is fresh for every lookup. A saved QR cannot authorize an
      // archived employee omitted by the canonical source RPC.
      return (await read()).find((row) => row.id === employeeId) || null;
    },
  };
}

const staffDirectory = createStaffDirectory();
module.exports = { createStaffDirectory, staffDirectory };

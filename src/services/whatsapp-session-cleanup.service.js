const { supabase } = require('../config/supabase');

const LEGACY_SESSION_PREFIXES = ['token_', 'otp_'];
const DEFAULT_BATCH_SIZE = 500;

const parseSessionData = (value) => {
  if (!value) return {};
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

const expiryTimestamp = (row) => {
  if (row?.expires_at) return Date.parse(row.expires_at);
  const data = parseSessionData(row?.data);
  const value = data.expires ?? data.expiresAt;
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return Date.parse(String(value || ''));
};

const expiredLegacySessionIds = (rows, now = new Date()) => {
  const nowMs = now.getTime();
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => LEGACY_SESSION_PREFIXES.some((prefix) => String(row?.id).startsWith(prefix)))
    .filter((row) => {
      const expiresAt = expiryTimestamp(row);
      return Number.isFinite(expiresAt) && expiresAt > 0 && expiresAt <= nowMs;
    })
    .map((row) => String(row.id));
};

const createRepository = (db = supabase) => ({
  async deleteExpiredColumn(expiresAt) {
    const { data, error } = await db
      .from('whatsapp_sessions')
      .delete()
      .not('expires_at', 'is', null)
      .lte('expires_at', expiresAt)
      .select('id');
    if (error) throw error;
    return Array.isArray(data) ? data.map((row) => String(row.id)) : [];
  },

  async listLegacyCandidates(batchSize = DEFAULT_BATCH_SIZE) {
    const rows = [];
    for (let offset = 0; ; offset += batchSize) {
      const { data, error } = await db
        .from('whatsapp_sessions')
        .select('id,data,expires_at')
        .or('id.like.token_%,id.like.otp_%')
        .is('expires_at', null)
        .range(offset, offset + batchSize - 1);
      if (error) throw error;
      const page = Array.isArray(data) ? data : [];
      rows.push(...page);
      if (page.length < batchSize) break;
    }
    return rows;
  },

  async deleteByIds(ids, batchSize = DEFAULT_BATCH_SIZE) {
    const deleted = [];
    for (let offset = 0; offset < ids.length; offset += batchSize) {
      const batch = ids.slice(offset, offset + batchSize);
      const { data, error } = await db
        .from('whatsapp_sessions')
        .delete()
        .in('id', batch)
        .select('id');
      if (error) throw error;
      deleted.push(...(Array.isArray(data) ? data.map((row) => String(row.id)) : []));
    }
    return deleted;
  },
});

async function cleanupExpiredWhatsAppSessions({
  repository,
  db = supabase,
  now = new Date(),
  batchSize = DEFAULT_BATCH_SIZE,
} = {}) {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) {
    throw new TypeError('A valid cleanup timestamp is required');
  }
  const sessions = repository || createRepository(db);
  const expiredColumnIds = await sessions.deleteExpiredColumn(now.toISOString());
  const legacyCandidates = await sessions.listLegacyCandidates(batchSize);
  const legacyIds = expiredLegacySessionIds(legacyCandidates, now).filter(
    (id) => !expiredColumnIds.includes(id),
  );
  const deletedLegacyIds = legacyIds.length ? await sessions.deleteByIds(legacyIds, batchSize) : [];
  if (deletedLegacyIds.length !== legacyIds.length) {
    const error = new Error('WhatsApp TTL cleanup deleted an unexpected number of rows');
    error.code = 'WHATSAPP_SESSION_CLEANUP_MISMATCH';
    throw error;
  }
  return {
    inspectedLegacy: legacyCandidates.length,
    deleted: expiredColumnIds.length + deletedLegacyIds.length,
    deletedByColumn: expiredColumnIds.length,
    deletedLegacy: deletedLegacyIds.length,
  };
}

module.exports = {
  cleanupExpiredWhatsAppSessions,
  createRepository,
  expiredLegacySessionIds,
};

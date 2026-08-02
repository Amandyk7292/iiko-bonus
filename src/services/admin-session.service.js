const crypto = require('node:crypto');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const localSessions = new Map();
const sessionHash = (jti) =>
  crypto
    .createHash('sha256')
    .update(String(jti || ''))
    .digest('hex');
const privacyHash = (value) =>
  crypto
    .createHmac('sha256', String(process.env.BULKA_SECRET || 'development-audit-secret'))
    .update(String(value || 'unknown'))
    .digest('hex');

const useLocalStore = () => process.env.NODE_ENV === 'test';

async function createAdminSession(
  { jti, subject, role, branchIds = [], expiresAt, ip, userAgent },
  { db = supabase } = {},
) {
  const record = {
    jti_hash: sessionHash(jti),
    admin_subject: String(subject || 'unknown').slice(0, 160),
    role: String(role || 'viewer').slice(0, 32),
    branch_ids: Array.isArray(branchIds) ? branchIds.map(String).slice(0, 50) : [],
    expires_at: new Date(expiresAt).toISOString(),
    ip_hash: privacyHash(ip),
    user_agent_hash: privacyHash(userAgent),
  };
  if (useLocalStore()) {
    localSessions.set(record.jti_hash, { ...record, revoked_at: null });
    return;
  }
  const { error } = await db.from('admin_sessions').insert(record);
  if (error) throw error;
}

async function validateAdminSession(payload, { db = supabase, now = () => new Date() } = {}) {
  if (!payload?.jti || !payload?.sub) return null;
  const jtiHash = sessionHash(payload.jti);
  let session;
  if (useLocalStore()) {
    session = localSessions.get(jtiHash) || null;
  } else {
    const { data, error } = await db
      .from('admin_sessions')
      .select('admin_subject,role,branch_ids,expires_at,revoked_at')
      .eq('jti_hash', jtiHash)
      .maybeSingle();
    if (error) throw error;
    session = data;
  }
  if (
    !session ||
    session.revoked_at ||
    session.admin_subject !== String(payload.sub) ||
    Date.parse(session.expires_at) <= now().getTime()
  ) {
    return null;
  }

  if (String(payload.role) === 'whatsapp_operator') {
    return {
      ...payload,
      role: 'whatsapp_operator',
      branchIds: [],
    };
  }

  if (useLocalStore()) {
    return {
      ...payload,
      role: session.role,
      branchIds: session.branch_ids || [],
    };
  }

  const { data: profile, error: profileError } = await db
    .from('admin_user_profiles')
    .select('role,branch_ids,active')
    .eq('username', session.admin_subject)
    .maybeSingle();
  if (profileError) throw profileError;
  if (profile?.active === false) return null;
  return {
    ...payload,
    role: String(profile?.role || session.role),
    branchIds: Array.isArray(profile?.branch_ids)
      ? profile.branch_ids.map(String)
      : session.branch_ids || [],
  };
}

async function revokeAdminSession(jti, { db = supabase, now = () => new Date() } = {}) {
  if (!jti) return;
  const jtiHash = sessionHash(jti);
  if (useLocalStore()) {
    const session = localSessions.get(jtiHash);
    if (session) session.revoked_at = now().toISOString();
    return;
  }
  const { error } = await db
    .from('admin_sessions')
    .update({ revoked_at: now().toISOString() })
    .eq('jti_hash', jtiHash)
    .is('revoked_at', null);
  if (error) {
    logger.error({ err: error, event: 'admin_session_revoke_failed' }, 'Session revoke failed');
    throw error;
  }
}

module.exports = {
  createAdminSession,
  revokeAdminSession,
  sessionHash,
  validateAdminSession,
};

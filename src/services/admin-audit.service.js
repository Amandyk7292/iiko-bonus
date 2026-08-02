const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { logger } = require('../config/logger');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const AUDIT_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const AUDIT_OUTCOMES = new Set(['success', 'rejected', 'server_error']);

const boundedText = (value, maximum) => {
  const text = String(value || '').trim();
  return text ? text.slice(0, maximum) : null;
};

const boundedContext = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const result = {};
  for (const [key, item] of Object.entries(value).slice(0, 20)) {
    const safeKey = String(key)
      .replace(/[^A-Za-z0-9_-]/g, '')
      .slice(0, 60);
    if (!safeKey) continue;
    if (typeof item === 'string') result[safeKey] = item.slice(0, 500);
    else if (typeof item === 'number' && Number.isFinite(item)) result[safeKey] = item;
    else if (typeof item === 'boolean' || item === null) result[safeKey] = item;
    else if (Array.isArray(item)) {
      result[safeKey] = item
        .slice(0, 20)
        .map((entry) =>
          ['string', 'number', 'boolean'].includes(typeof entry)
            ? String(entry).slice(0, 160)
            : null,
        )
        .filter((entry) => entry !== null);
    }
  }
  return result;
};

const setAdminAuditContext = (req, context = {}) => {
  req.adminAudit = {
    ...(req.adminAudit || {}),
    ...context,
  };
};

const auditQueryError = (message) =>
  Object.assign(new Error(message), { statusCode: 400, code: 'AUDIT_QUERY_INVALID' });

const parseAuditLogQuery = (input = {}) => {
  const pageText = String(input.page ?? '1');
  const pageSizeText = String(input.pageSize ?? '50');
  if (!/^\d{1,7}$/.test(pageText) || !/^\d{1,3}$/.test(pageSizeText)) {
    throw auditQueryError('Некорректная пагинация журнала');
  }
  const page = Number(pageText);
  const pageSize = Number(pageSizeText);
  if (page < 1 || pageSize < 10 || pageSize > 100) {
    throw auditQueryError('Некорректная пагинация журнала');
  }
  const method = String(input.method || '')
    .trim()
    .toUpperCase();
  const outcome = String(input.outcome || input.status || '')
    .trim()
    .toLowerCase();
  if (method && !AUDIT_METHODS.has(method)) throw auditQueryError('Некорректный HTTP-метод');
  if (outcome && !AUDIT_OUTCOMES.has(outcome)) throw auditQueryError('Некорректный результат');
  const search = String(input.search || '').trim();
  if (search.length > 100 || /[,\n\r()"'\\]/u.test(search)) {
    throw auditQueryError('Некорректная строка поиска');
  }
  return { page, pageSize, method, outcome, search };
};

const applyAuditLogFilters = (query, filters) => {
  let result = query;
  if (filters.method) result = result.eq('action', filters.method);
  if (filters.outcome) result = result.eq('outcome', filters.outcome);
  if (filters.search) {
    const pattern = `%${filters.search.replaceAll('%', '\\%').replaceAll('_', '\\_')}%`;
    result = result.or(
      [
        `action.ilike.${pattern}`,
        `action_code.ilike.${pattern}`,
        `path.ilike.${pattern}`,
        `request_id.ilike.${pattern}`,
        `admin_subject.ilike.${pattern}`,
        `target_id.ilike.${pattern}`,
      ].join(','),
    );
  }
  return result;
};

const inferredTarget = (req) => {
  for (const [key, value] of Object.entries({ ...req.params, ...req.body })) {
    if (!value || !/(?:^id$|Id$)/.test(key)) continue;
    return {
      targetType: key === 'id' ? 'resource' : key.replace(/Id$/, ''),
      targetId: String(value),
    };
  }
  return {};
};

const routePath = (req) => {
  const template = typeof req.route?.path === 'string' ? req.route.path : req.path;
  return `${req.baseUrl || ''}${template || ''}`.split('?')[0].slice(0, 500);
};

async function writeAdminAudit(req, statusCode, { db = supabase } = {}) {
  const secret = String(process.env.BULKA_SECRET || 'audit');
  const ipHash = crypto
    .createHmac('sha256', secret)
    .update(String(req.ip || 'unknown'))
    .digest('hex');
  const explicit = req.adminAudit || {};
  const target = { ...inferredTarget(req), ...explicit };
  const rawBranchId =
    explicit.branchId ||
    req.body?.branchId ||
    req.params?.branchId ||
    req.query?.branchId ||
    req.admin?.selectedBranchId;
  const rawAmount = explicit.amountChange ?? req.body?.amountChange ?? req.body?.amount;
  const amountChange = Number(rawAmount);
  const method = String(req.method || '')
    .toUpperCase()
    .slice(0, 16);
  const path = routePath(req);
  try {
    const { error } = await db.from('admin_audit_logs').insert({
      admin_subject: String(req.admin?.sub || 'unknown').slice(0, 160),
      admin_role: String(req.admin?.role || 'unknown').slice(0, 32),
      action: method,
      path,
      status_code: statusCode,
      ip_hash: ipHash,
      user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
      request_id: boundedText(req.id, 128),
      action_code: boundedText(explicit.actionCode || `${method} ${path}`, 160),
      target_type: boundedText(target.targetType, 80),
      target_id: boundedText(target.targetId, 200),
      branch_id: UUID_PATTERN.test(String(rawBranchId || '')) ? String(rawBranchId) : null,
      reason: boundedText(explicit.reason ?? req.body?.reason, 240),
      amount_change: Number.isFinite(amountChange) ? amountChange : null,
      outcome: statusCode >= 500 ? 'server_error' : statusCode >= 400 ? 'rejected' : 'success',
      context: boundedContext(explicit.context),
    });
    if (!error) return;
    logger.error(
      { err: error, event: 'admin_audit_write_failed', requestId: req.id },
      'Admin audit write failed',
    );
  } catch (error) {
    logger.error(
      { err: error, event: 'admin_audit_write_failed', requestId: req.id },
      'Admin audit write failed',
    );
  }
}

module.exports = {
  applyAuditLogFilters,
  boundedContext,
  parseAuditLogQuery,
  setAdminAuditContext,
  writeAdminAudit,
};

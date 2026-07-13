const crypto = require('crypto');
const { supabase } = require('../config/supabase');

async function writeAdminAudit(req, statusCode) {
  const secret = String(process.env.BULKA_SECRET || 'audit');
  const ipHash = crypto
    .createHmac('sha256', secret)
    .update(String(req.ip || 'unknown'))
    .digest('hex');
  const { error } = await supabase.from('admin_audit_logs').insert({
    admin_subject: String(req.admin?.sub || 'unknown').slice(0, 160),
    admin_role: String(req.admin?.role || 'unknown').slice(0, 32),
    action: String(req.method || '').slice(0, 16),
    path: String(req.originalUrl || '').slice(0, 500),
    status_code: statusCode,
    ip_hash: ipHash,
    user_agent: String(req.headers['user-agent'] || '').slice(0, 500),
  });
  if (error) console.error('Admin audit write failed:', error.message);
}

module.exports = { writeAdminAudit };

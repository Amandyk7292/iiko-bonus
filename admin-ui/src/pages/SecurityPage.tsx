import { useCallback, useEffect, useState } from 'react';
import { KeyRound, RefreshCw, ShieldAlert, ShieldCheck, UserRoundCog } from 'lucide-react';
import PageState from '../components/PageState';
import { api, type AuditLog, type SecurityStatus } from '../lib/api';
import { useI18n } from '../lib/i18n';

const securityRoleKeys: Record<string, string> = {
  owner: 'access.role.owner',
  branch_manager: 'access.role.branchManager',
  operator: 'access.role.operator',
  marketer: 'access.role.marketer',
  courier: 'access.role.courier',
  viewer: 'access.role.viewer',
};

export default function SecurityPage() {
  const { t, formatDate } = useI18n();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [security, audit] = await Promise.all([api.getSecurityStatus(), api.getAuditLogs({ pageSize: 100 })]);
      setStatus(security); setLogs(audit.logs ?? []); setTotal(audit.total ?? 0); setError('');
    } catch (caught) { setError(caught instanceof Error ? caught.message : t('common.loadError')); }
    finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void load(); }, [load]);

  if (loading && !status) return <PageState type="loading" />;
  if (!status) return <PageState type="error" description={error} onRetry={load} />;
  const protectedMode = status.multiAdmin && status.mfaRequired && !status.legacySingleAdmin;
  const roleLabel = (role?: string | null) => role ? t(securityRoleKeys[role] ?? 'common.unknown') : '—';

  return <div className="page-stack">
    <div className="page-actions-row"><div><h2 className="content-heading">{t('security.heading')}</h2><p className="page-help">{t('security.intro')}</p></div><button type="button" className="btn-outline px-5 inline-flex items-center gap-2" onClick={load} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={17} />{t('common.refresh')}</button></div>
    {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
    <section className="security-grid">
      <article className={`card security-card ${protectedMode ? 'security-ok' : 'security-warning'}`}><div className="security-icon">{protectedMode ? <ShieldCheck size={24} /> : <ShieldAlert size={24} />}</div><div><h3>{protectedMode ? t('security.protected') : t('security.actionRequired')}</h3><p>{protectedMode ? t('security.protectedHint') : t('security.mfaHint')}</p></div></article>
      <article className="card security-card"><div className="security-icon"><UserRoundCog size={24} /></div><div><h3>{t('security.currentUser')}</h3><p>{status.user.username} · {roleLabel(status.user.role)}</p></div></article>
      <article className="card security-card"><div className="security-icon"><KeyRound size={24} /></div><div><h3>{t('security.mfa')}</h3><p>{status.mfaRequired ? t('common.enabled') : t('common.disabled')} · {status.configuredUsers.filter(user => user.mfa).length}/{Math.max(1, status.configuredUsers.length)}</p></div></article>
    </section>
    <section className="card table-card"><div className="table-heading"><div><h2>{t('security.audit')}</h2><p>{t('security.auditCount', { count: total })}</p></div></div><div className="responsive-table-wrap"><table className="data-table audit-table"><thead><tr><th>{t('common.date')}</th><th>{t('security.admin')}</th><th>{t('security.action')}</th><th>{t('security.result')}</th><th>{t('security.ip')}</th></tr></thead><tbody>{logs.map(log => <tr key={log.id}><td data-label={t('common.date')} className="tabular">{formatDate(log.created_at)}</td><td data-label={t('security.admin')}><strong>{log.admin_username || '—'}</strong><small className="table-secondary">{roleLabel(log.admin_role)}</small></td><td data-label={t('security.action')}><code>{log.method}</code> {log.path}</td><td data-label={t('security.result')}><span className={`status-pill ${(log.status_code || 500) < 400 ? 'status-active' : 'status-inactive'}`}>{log.status_code || '—'}</span></td><td data-label={t('security.ip')} className="tabular">{log.ip || '—'}</td></tr>)}</tbody></table></div>{logs.length === 0 && <PageState type="empty" title={t('security.noAudit')} />}</section>
  </div>;
}

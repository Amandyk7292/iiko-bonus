import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Eye,
  KeyRound,
  RefreshCw,
  Search,
  ShieldAlert,
  ShieldCheck,
  UserRoundCog,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { api, type AuditLog, type SecurityStatus } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSearchParams } from '../lib/router';

const securityRoleKeys: Record<string, string> = {
  owner: 'access.role.owner',
  branch_manager: 'access.role.branchManager',
  operator: 'access.role.operator',
  marketer: 'access.role.marketer',
  courier: 'access.role.courier',
  viewer: 'access.role.viewer',
};

const auditMethod = (log: AuditLog) => String(log.method || log.action || '—').toUpperCase();
const auditAdmin = (log: AuditLog) => log.admin_username || log.admin_subject || '—';
const auditOutcome = (log: AuditLog) =>
  log.outcome ||
  (Number(log.status_code || 500) >= 500
    ? 'server_error'
    : Number(log.status_code || 500) >= 400
      ? 'rejected'
      : 'success');

export default function SecurityPage() {
  const { t, formatDate } = useI18n();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const method = params.get('method') || '';
  const outcome = params.get('outcome') || '';
  const selectedLogId = params.get('log') || '';
  const [search, setSearch] = useState(params.get('search') || '');
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const pageSize = 25;

  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = search.trim();
      if (next !== (params.get('search') || '')) {
        updateParams({ search: next || null, page: null, log: null });
      }
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, search, updateParams]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [security, audit] = await Promise.all([
        api.getSecurityStatus(),
        api.getAuditLogs({
          page,
          pageSize,
          search: params.get('search') || '',
          method,
          outcome,
        }),
      ]);
      setStatus(security);
      setLogs(audit.logs ?? []);
      setTotal(audit.total ?? 0);
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [method, outcome, page, params, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const visibleLogs = useMemo(() => {
    const needle = (params.get('search') || '').toLocaleLowerCase();
    return logs.filter((log) => {
      if (method && auditMethod(log) !== method) return false;
      if (outcome && auditOutcome(log) !== outcome) return false;
      if (!needle) return true;
      return [
        auditAdmin(log),
        log.path,
        log.action_code,
        log.request_id,
        log.target_type,
        log.target_id,
      ]
        .filter(Boolean)
        .join(' ')
        .toLocaleLowerCase()
        .includes(needle);
    });
  }, [logs, method, outcome, params]);
  const selectedLog = logs.find((log) => log.id === selectedLogId) || null;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && !status) return <PageState type="loading" />;
  if (!status) return <PageState type="error" description={error} onRetry={load} />;
  const protectedMode = status.multiAdmin && status.mfaRequired && !status.legacySingleAdmin;
  const roleLabel = (role?: string | null) =>
    role ? t(securityRoleKeys[role] ?? 'common.unknown') : '—';

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('security.heading')}</h2>
          <p className="page-help">{t('security.intro')}</p>
        </div>
        <button
          type="button"
          className="btn-outline px-5 inline-flex items-center gap-2"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} />
          {t('common.refresh')}
        </button>
      </div>
      {error && (
        <div className="inline-alert inline-alert-error" role="alert">
          {error}
        </div>
      )}
      <section className="security-grid">
        <article
          className={`card security-card ${protectedMode ? 'security-ok' : 'security-warning'}`}
        >
          <div className="security-icon">
            {protectedMode ? (
              <ShieldCheck aria-hidden="true" size={24} />
            ) : (
              <ShieldAlert aria-hidden="true" size={24} />
            )}
          </div>
          <div>
            <h3>{protectedMode ? t('security.protected') : t('security.actionRequired')}</h3>
            <p>{protectedMode ? t('security.protectedHint') : t('security.mfaHint')}</p>
          </div>
        </article>
        <article className="card security-card">
          <div className="security-icon">
            <UserRoundCog aria-hidden="true" size={24} />
          </div>
          <div>
            <h3>{t('security.currentUser')}</h3>
            <p>
              {status.user.username} · {roleLabel(status.user.role)}
            </p>
          </div>
        </article>
        <article className="card security-card">
          <div className="security-icon">
            <KeyRound aria-hidden="true" size={24} />
          </div>
          <div>
            <h3>{t('security.mfa')}</h3>
            <p>
              {status.mfaRequired ? t('common.enabled') : t('common.disabled')} ·{' '}
              {status.configuredUsers.filter((user) => user.mfa).length}/
              {Math.max(1, status.configuredUsers.length)}
            </p>
          </div>
        </article>
      </section>

      <section className="sagi-filter security-audit-filter" aria-label={t('security.filters')}>
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="security-audit-search">
            {t('common.search')}
          </label>
          <div className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input
              id="security-audit-search"
              name="securityAuditSearch"
              className="input-classic"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('security.searchPlaceholder')}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="security-audit-method">
            {t('security.method')}
          </label>
          <SelectControl
            id="security-audit-method"
            compact
            value={method}
            onChange={(value) => updateParams({ method: value, page: null, log: null })}
            options={[
              { value: '', label: t('security.allMethods') },
              ...['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({
                value,
                label: value,
              })),
            ]}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="security-audit-outcome">
            {t('security.result')}
          </label>
          <SelectControl
            id="security-audit-outcome"
            compact
            value={outcome}
            onChange={(value) => updateParams({ outcome: value, page: null, log: null })}
            options={[
              { value: '', label: t('security.allResults') },
              { value: 'success', label: t('security.success') },
              { value: 'rejected', label: t('security.rejected') },
              { value: 'server_error', label: t('security.serverError') },
            ]}
          />
        </div>
      </section>

      <section className="card table-card">
        <div className="table-heading">
          <div>
            <h2>{t('security.audit')}</h2>
            <p aria-live="polite">{t('security.auditCount', { count: total })}</p>
          </div>
        </div>
        <div className="responsive-table-wrap">
          <table className="data-table audit-table">
            <thead>
              <tr>
                <th>{t('common.date')}</th>
                <th>{t('security.admin')}</th>
                <th>{t('security.action')}</th>
                <th>{t('security.result')}</th>
                <th>{t('security.requestId')}</th>
                <th className="text-right">{t('common.actions')}</th>
              </tr>
            </thead>
            <tbody>
              {visibleLogs.map((log) => (
                <tr key={log.id}>
                  <td data-label={t('common.date')} className="tabular">
                    {formatDate(log.created_at)}
                  </td>
                  <td data-label={t('security.admin')}>
                    <strong>{auditAdmin(log)}</strong>
                    <small className="table-secondary">{roleLabel(log.admin_role)}</small>
                  </td>
                  <td data-label={t('security.action')}>
                    <code>{auditMethod(log)}</code> {log.path}
                  </td>
                  <td data-label={t('security.result')}>
                    <span
                      className={`status-pill ${auditOutcome(log) === 'success' ? 'status-active' : 'status-inactive'}`}
                    >
                      {log.status_code || '—'}
                    </span>
                  </td>
                  <td data-label={t('security.requestId')} className="tabular">
                    <code>{log.request_id || '—'}</code>
                  </td>
                  <td data-label={t('common.actions')}>
                    <div className="row-actions justify-end">
                      <button
                        type="button"
                        className="icon-button"
                        aria-label={t('security.openDetails')}
                        onClick={() => updateParams({ log: log.id })}
                      >
                        <Eye aria-hidden="true" size={17} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleLogs.length === 0 && <PageState type="empty" title={t('security.noAudit')} />}
        {totalPages > 1 && (
          <div className="table-pagination">
            <button
              type="button"
              className="btn-outline px-4"
              disabled={page <= 1 || loading}
              onClick={() => updateParams({ page: page - 1, log: null })}
            >
              {t('security.previousPage')}
            </button>
            <span aria-live="polite">
              {page} / {totalPages}
            </span>
            <button
              type="button"
              className="btn-outline px-4"
              disabled={page >= totalPages || loading}
              onClick={() => updateParams({ page: page + 1, log: null })}
            >
              {t('security.nextPage')}
            </button>
          </div>
        )}
      </section>

      <Modal
        open={Boolean(selectedLog)}
        onClose={() => updateParams({ log: null })}
        title={t('security.auditDetails')}
        description={selectedLog?.request_id ? `${t('security.requestId')}: ${selectedLog.request_id}` : undefined}
        size="lg"
      >
        {selectedLog && (
          <div className="modal-body audit-detail-grid">
            <dl>
              <div>
                <dt>{t('common.date')}</dt>
                <dd>{formatDate(selectedLog.created_at)}</dd>
              </div>
              <div>
                <dt>{t('security.admin')}</dt>
                <dd>
                  {auditAdmin(selectedLog)} · {roleLabel(selectedLog.admin_role)}
                </dd>
              </div>
              <div>
                <dt>{t('security.action')}</dt>
                <dd>
                  <code>{selectedLog.action_code || auditMethod(selectedLog)}</code>
                </dd>
              </div>
              <div>
                <dt>{t('security.path')}</dt>
                <dd className="break-words">{selectedLog.path}</dd>
              </div>
              <div>
                <dt>{t('security.result')}</dt>
                <dd>
                  {selectedLog.status_code || '—'} · {auditOutcome(selectedLog)}
                </dd>
              </div>
              <div>
                <dt>{t('security.target')}</dt>
                <dd>
                  {[selectedLog.target_type, selectedLog.target_id].filter(Boolean).join(' · ') ||
                    '—'}
                </dd>
              </div>
              <div>
                <dt>{t('security.reason')}</dt>
                <dd>{selectedLog.reason || '—'}</dd>
              </div>
              <div>
                <dt>{t('security.ip')}</dt>
                <dd className="tabular">
                  {selectedLog.ip || selectedLog.ip_hash?.slice(0, 16) || '—'}
                </dd>
              </div>
            </dl>
          </div>
        )}
      </Modal>
    </div>
  );
}

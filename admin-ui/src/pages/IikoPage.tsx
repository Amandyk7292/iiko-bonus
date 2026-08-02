import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, RefreshCw, Store } from 'lucide-react';
import PageState from '../components/PageState';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function IikoPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const [operations, setOperations] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchOperations = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getIikoOperations();
      setOperations(Array.isArray(data) ? data : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchOperations(); }, [fetchOperations]);

  if (loading && operations.length === 0) return <PageState type="loading" />;
  if (error && operations.length === 0) return <PageState type="error" description={error} onRetry={fetchOperations} />;

  return (
    <div className="page-stack">
      <div className="integration-row">
        <div className="card integration-card">
          <span className="integration-icon"><Store aria-hidden="true" size={23} /></span>
          <div><p>{t('iiko.integration')}</p><strong><CheckCircle2 aria-hidden="true" size={16} /> {t('iiko.connected')}</strong></div>
        </div>
        <button type="button" onClick={fetchOperations} disabled={loading} className="btn-outline px-4 inline-flex items-center gap-2">
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} /> {t('common.refresh')}
        </button>
      </div>
      {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}

      {operations.length === 0 ? <PageState type="empty" title={t('iiko.empty')} description={t('iiko.emptyHint')} /> : (
        <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table">
          <thead><tr><th>{t('common.date')}</th><th>{t('iiko.operationId')}</th><th>{t('common.status')}</th><th className="text-right">{t('iiko.orderAmount')}</th><th className="text-right">{t('iiko.paidBonus')}</th><th className="text-right">{t('iiko.earnedBonus')}</th><th>{t('iiko.customer')}</th><th>{t('iiko.status')}</th></tr></thead>
          <tbody>{operations.map(operation => {
            const spent = Number(operation.discount_amount) || 0;
            const earned = Number(operation.earned_bonus) || 0;
            return <tr key={operation.id}>
              <td data-label={t('common.date')}><time dateTime={operation.created_at}>{formatDate(operation.created_at)}</time></td>
              <td data-label={t('iiko.operationId')} className="mono">{operation.order_id || '—'}</td>
              <td data-label={t('common.status')}><span className={`status-pill ${spent > 0 ? 'status-info' : 'status-active'}`}>{spent > 0 ? t('iiko.writeoff') : t('iiko.accrual')}</span></td>
              <td data-label={t('iiko.orderAmount')} className="text-right tabular">{operation.order_total == null ? '—' : formatNumber(operation.order_total)}</td>
              <td data-label={t('iiko.paidBonus')} className="text-right tabular value-negative">{spent > 0 ? formatNumber(spent) : '—'}</td>
              <td data-label={t('iiko.earnedBonus')} className="text-right tabular value-positive">{earned > 0 ? `+${formatNumber(earned)}` : '—'}</td>
              <td data-label={t('iiko.customer')}>{operation.customers?.phone || operation.customers?.name || '—'}</td>
              <td data-label={t('iiko.status')}><span className="status-pill status-active">{t('common.success')}</span></td>
            </tr>;
          })}</tbody>
        </table></div></section>
      )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Trophy } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { dashboardApi } from './api';
import { errorKey, validRange, type Report } from './model';
import { topDishes } from './top-dishes';
import './top-dishes.css';

export default function TopDishes({
  serverId,
  from,
  to,
  department,
  configured,
  refresh,
}: {
  serverId: string;
  from: string;
  to: string;
  department: string;
  configured: boolean;
  refresh: number;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const periodValid = validRange(from, to);
  const query = useMemo(
    () => ({ view: 'products', serverId, from, to, department }),
    [serverId, from, to, department],
  );
  const [result, setResult] = useState<{
    key: string;
    query: typeof query;
    report?: Report;
    error?: string;
  }>();
  const requestKey = JSON.stringify([query, refresh, attempt, configured]);
  const current = result?.key === requestKey && result.query === query ? result : undefined;
  const report = configured && periodValid ? current?.report : undefined;
  const error = !configured ? 'id.notConfigured' : !periodValid ? 'id.range' : current?.error;
  const loading = configured && periodValid && !current;
  const rows = useMemo(() => topDishes(report?.rows || []), [report]);
  const maximum = rows[0]?.quantity || 1;

  useEffect(() => {
    if (!configured || !periodValid) {
      setResult(undefined);
      return;
    }
    const controller = new AbortController();
    void dashboardApi
      .analytics(query, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setResult({ key: requestKey, query, report: data });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setResult({ key: requestKey, query, error: errorKey(caught) });
      });
    return () => controller.abort();
  }, [query, configured, periodValid, requestKey]);

  return (
    <section
      className="card id-panel id-top-dishes"
      aria-label={t('id.topDishes')}
      aria-busy={loading}
    >
      <div className="id-top-dishes-heading">
        <div className="id-top-dishes-title">
          <span className="id-top-dishes-icon" aria-hidden="true">
            <Trophy size={20} />
          </span>
          <div>
            <h2>{t('id.topDishes')}</h2>
            <p>{t('id.topDishesHint')}</p>
          </div>
        </div>
        {report && (
          <time dateTime={report.fetchedAt} title={t('id.updated')}>
            {formatDate(report.fetchedAt, { hour: '2-digit', minute: '2-digit' })}
          </time>
        )}
      </div>
      {loading && (
        <p className="id-top-dishes-status" role="status">
          {t('id.loading')}
        </p>
      )}
      {error && (
        <div className="id-error id-top-dishes-error" role="alert">
          <span>{t(error)}</span>
          {configured && periodValid && (
            <button type="button" onClick={() => setAttempt((value) => value + 1)}>
              <RefreshCw size={16} aria-hidden="true" />
              {t('id.refresh')}
            </button>
          )}
        </div>
      )}
      {report && !rows.length && (
        <p className="id-top-dishes-status" role="status">
          {t('id.empty')}
        </p>
      )}
      {!!rows.length && (
        <>
          <div className="id-top-dishes-columns" aria-hidden="true">
            <span>{t('id.product')}</span>
            <span>{t('id.productSalesSold')}</span>
            <span>{t('id.revenue')}</span>
          </div>
          <ol className="id-top-dishes-list">
            {rows.map((row, index) => (
              <li key={row.key}>
                <span
                  className="id-top-dishes-rank"
                  aria-label={`${t('id.topDishesRank')} ${index + 1}`}
                >
                  {index + 1}
                </span>
                <div className="id-top-dishes-product">
                  <strong>{row.name}</strong>
                  <div className="id-top-dishes-track" aria-hidden="true">
                    <span style={{ width: `${(row.quantity / maximum) * 100}%` }} />
                  </div>
                </div>
                <div className="id-top-dishes-quantity">
                  <span className="id-top-dishes-mobile-label">{t('id.productSalesSold')}</span>
                  <span className="id-top-dishes-value">
                    <strong>{formatNumber(row.quantity, { maximumFractionDigits: 6 })}</strong>
                    {row.unit && <span className="id-top-dishes-unit"> {row.unit}</span>}
                  </span>
                </div>
                <div className="id-top-dishes-revenue">
                  <span className="id-top-dishes-mobile-label">{t('id.revenue')}</span>
                  <span className="id-top-dishes-value">
                    {row.revenue === null
                      ? '—'
                      : `${formatNumber(row.revenue, { maximumFractionDigits: 2 })} ₸`}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </>
      )}
    </section>
  );
}

import { useI18n } from '../../lib/i18n';
import { valueFor, type Report } from './model';
import './branch-revenue.css';

export default function BranchRevenue({ report }: { report?: Report | null }) {
  const { t, formatNumber } = useI18n();
  const rows = (report?.rows || [])
    .map((row) => ({
      name: String(row.Department ?? '—'),
      revenue: valueFor(row, 'DishDiscountSumInt'),
    }))
    .sort((a, b) => {
      if (a.revenue === null) return b.revenue === null ? a.name.localeCompare(b.name) : 1;
      if (b.revenue === null) return -1;
      return b.revenue - a.revenue || a.name.localeCompare(b.name);
    });
  const maximum = Math.max(1, ...rows.map((row) => row.revenue ?? 0));
  return (
    <section className="card id-panel" aria-label={t('id.branchRevenue')}>
      <h2>{t('id.branchRevenue')}</h2>
      <p className="id-branch-revenue-note">{t('id.revenueDescending')}</p>
      {report === undefined ? (
        <p role="status">{t('id.loading')}</p>
      ) : report === null ? (
        <p className="id-error" role="alert">{t('id.error')}</p>
      ) : !rows.length ? (
        <p className="id-empty">{t('id.empty')}</p>
      ) : (
        <ol className="id-branch-revenue-list">
          {rows.map((row, index) => (
            <li className="id-ranking-bar" key={row.name}>
              <div>
                <span>{index + 1}. {row.name}</span>
                <strong>
                  {row.revenue === null ? '—' : `${formatNumber(row.revenue, { maximumFractionDigits: 2 })} ₸`}
                </strong>
              </div>
              <div className="id-ranking-track" aria-hidden="true">
                <div style={{ width: `${Math.max(0, row.revenue ?? 0) / maximum * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

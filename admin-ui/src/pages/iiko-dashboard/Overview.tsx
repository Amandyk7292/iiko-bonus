import { useRef, useState } from 'react';
import {
  ArrowUpRight,
  ArrowDownRight,
  Activity,
  Receipt,
  Wallet,
  Tag,
  Users,
  Package,
  Coins,
} from '../../components/BulkaIcons';
import { useI18n } from '../../lib/i18n';
import { datedRows, metrics, valueFor, type Report } from './model';
import DataTable from './DataTable';
import BranchRevenue from './BranchRevenue';
import TrendChart from './TrendChart';

export interface OverviewData {
  summary: Report;
  trend?: Report;
  previous?: Report;
  previousTrend?: Report;
  branches?: Report | null;
}
export default function Overview({ data, cards }: { data: OverviewData; cards: string[] }) {
  const { t, formatNumber } = useI18n();
  const [selected, setSelected] = useState('revenue');
  const icons = [Wallet, Receipt, Activity, Tag, Coins, Users, Package];
  const metric = metrics.find((item) => item.id === selected) || metrics[0];
  const scope = JSON.stringify([data.summary.serverId, data.summary.period]);
  const lastTrend = useRef<{ scope: string; trend: Report; previous?: Report } | undefined>(
    undefined,
  );
  if (data.trend) {
    lastTrend.current = {
      scope,
      trend: data.trend,
      previous:
        data.previousTrend ??
        (lastTrend.current?.scope === scope ? lastTrend.current.previous : undefined),
    };
  }
  // Summary and branches may arrive before trend during a same-query refresh.
  const cached = lastTrend.current?.scope === scope ? lastTrend.current : undefined;
  const trend = data.trend ?? cached?.trend;
  const previousTrend = data.previousTrend ?? cached?.previous;
  const currentRows = trend ? datedRows(trend) : [];
  return (
    <>
      <div className="id-metric-grid">
        {cards
          .map((id) => metrics.find((item) => item.id === id))
          .filter((item) => !!item)
          .map((item) => {
            const current = valueFor(data.summary.rows[0], item.field);
            const previous = valueFor(data.previous?.rows[0], item.field);
            const change =
              current !== null && previous !== null && previous !== 0
                ? ((current - previous) / Math.abs(previous)) * 100
                : null;
            const Icon =
              icons[metrics.findIndex((candidate) => candidate.id === item.id)] || Activity;
            const values = currentRows.map((row) => valueFor(row, item.field));
            const finite = values.filter((value): value is number => value !== null);
            const low = Math.min(...finite),
              high = Math.max(...finite);
            const points = values.map((value, index) =>
              value === null
                ? null
                : [
                    (index / Math.max(1, values.length - 1)) * 180,
                    40 - ((value - low) / (high - low || 1)) * 34,
                  ],
            );
            return (
              <button
                type="button"
                className={`id-metric ${selected === item.id ? 'id-metric-selected' : ''}`}
                key={item.id}
                onClick={() => setSelected(item.id)}
                aria-pressed={selected === item.id}
              >
                <span className="id-metric-label">
                  <span>{t(`id.${item.id}`)}</span>
                  <Icon size={18} aria-hidden="true" />
                </span>
                <strong
                  title={
                    current === null
                      ? undefined
                      : `${formatNumber(current)}${item.money ? ' ₸' : ''}`
                  }
                >
                  {current === null
                    ? '—'
                    : formatNumber(current, {
                        maximumFractionDigits: 1,
                        notation: Math.abs(current) >= 1000000 ? 'compact' : 'standard',
                      })
                        .replace(/[\u00a0\u202f]/g, ' ')
                        .replace(/,(?=\d{3}(?:[,.]|$))/g, ',\u200b')}
                  {current !== null && item.money ? '\u00a0₸' : ''}
                </strong>
                {data.previous && (
                  <small className="id-metric-change">
                    {change !== null &&
                      (change >= 0 ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />)}
                    {change === null
                      ? '—'
                      : `${change >= 0 ? '+' : ''}${formatNumber(change, { maximumFractionDigits: 1 })}%`}{' '}
                    <span>
                      ·{' '}
                      {previous === null
                        ? '—'
                        : formatNumber(previous, { maximumFractionDigits: 2 })}
                    </span>
                  </small>
                )}
                {finite.length > 1 && (
                  <svg
                    className="id-sparkline"
                    viewBox="0 0 180 48"
                    preserveAspectRatio="none"
                    aria-hidden="true"
                  >
                    <path
                      d={points
                        .map((point, index) =>
                          point
                            ? `${index === 0 || !points[index - 1] ? 'M' : 'L'}${point[0]},${point[1]}`
                            : '',
                        )
                        .join(' ')}
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                )}
              </button>
            );
          })}
      </div>
      {!trend ? (
        <div className="id-skeleton" role="status">
          {t('id.loading')}
        </div>
      ) : (
        <section className="card id-chart-card">
          <h2>{t(`id.${metric.id}`)}</h2>
          <div
            className="id-chart"
            role="img"
            aria-label={`${t('id.trend')}: ${t(`id.${metric.id}`)}`}
          >
            <TrendChart report={trend} previous={previousTrend} metric={metric} />
          </div>
          <details className="id-daily-details">
            <summary>{t('id.dailyData')}</summary>
            <DataTable report={trend} />
          </details>
        </section>
      )}
      <BranchRevenue report={data.branches} />
    </>
  );
}

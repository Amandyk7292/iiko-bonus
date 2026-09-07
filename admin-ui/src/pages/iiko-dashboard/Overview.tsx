import { useState } from 'react';
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
} from 'lucide-react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useI18n } from '../../lib/i18n';
import { useReducedMotion } from '../../lib/motion';
import { datedRows, metrics, valueFor, type Report } from './model';
import DataTable from './DataTable';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export interface OverviewData {
  summary: Report;
  trend?: Report;
  previous?: Report;
  previousTrend?: Report;
}
export default function Overview({ data, cards }: { data: OverviewData; cards: string[] }) {
  const { t, formatNumber, formatDate } = useI18n();
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState('revenue');
  const icons = [Wallet, Receipt, Activity, Tag, Coins, Users, Package];
  const metric = metrics.find((item) => item.id === selected) || metrics[0];
  const currentRows = data.trend ? datedRows(data.trend) : [];
  const previousRows = data.previousTrend ? datedRows(data.previousTrend) : [];
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
                      })}
                  {current !== null && item.money ? ' ₸' : ''}
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
      {!data.trend ? (
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
            <Line
              options={{
                responsive: true,
                maintainAspectRatio: false,
                animation: reduced ? false : { duration: 180 },
                spanGaps: false,
                plugins: {
                  legend: {
                    position: 'bottom',
                    labels: {
                      usePointStyle: true,
                      boxWidth: 7,
                      padding: 24,
                      font: { family: 'Montserrat', size: 12 },
                    },
                  },
                },
                scales: {
                  x: {
                    grid: { display: false },
                    ticks: { maxTicksLimit: 8, color: '#74796f' },
                    border: { display: false },
                  },
                  y: {
                    grid: { color: '#f0f1ed' },
                    border: { display: false },
                    title: { display: metric.money, text: '₸' },
                    ticks: {
                      callback: (value) =>
                        formatNumber(Number(value), {
                          notation: 'compact',
                          maximumFractionDigits: 1,
                        }),
                    },
                  },
                },
              }}
              data={{
                labels: currentRows.map((row) =>
                  formatDate(String(row['OpenDate.Typed']).slice(0, 10), {
                    day: 'numeric',
                    month: 'short',
                  }),
                ),
                datasets: [
                  {
                    label: t('id.current'),
                    data: currentRows.map((row) => valueFor(row, metric.field)),
                    borderColor: '#9c7418',
                    backgroundColor: 'rgba(239, 193, 77, 0.12)',
                    fill: true,
                    tension: 0.35,
                    pointRadius: currentRows.length > 1 ? 0 : 4,
                    pointHoverRadius: 5,
                    borderWidth: 2,
                  },
                  ...(data.previousTrend
                    ? [
                        {
                          label: t('id.previousLine'),
                          data: previousRows.map((row) => valueFor(row, metric.field)),
                          borderColor: '#adb3a4',
                          borderDash: [5, 4],
                          tension: 0.2,
                          pointRadius: 1,
                        },
                      ]
                    : []),
                ],
              }}
            />
          </div>
          <details className="id-daily-details">
            <summary>{t('id.dailyData')}</summary>
            <DataTable report={data.trend} />
          </details>
        </section>
      )}
    </>
  );
}

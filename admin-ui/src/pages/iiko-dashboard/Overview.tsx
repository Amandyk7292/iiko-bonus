import { useState } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useI18n } from '../../lib/i18n';
import { useReducedMotion } from '../../lib/motion';
import { datedRows, metrics, valueFor, type Report } from './model';
import DataTable from './DataTable';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

export interface OverviewData {
  summary: Report;
  trend: Report;
  previous?: Report;
  previousTrend?: Report;
}
export default function Overview({ data, cards }: { data: OverviewData; cards: string[] }) {
  const { t, formatNumber } = useI18n();
  const reduced = useReducedMotion();
  const [selected, setSelected] = useState('revenue');
  const metric = metrics.find((item) => item.id === selected) || metrics[0];
  const currentRows = datedRows(data.trend);
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
            return (
              <button
                type="button"
                className={`id-metric ${selected === item.id ? 'id-metric-selected' : ''}`}
                key={item.id}
                onClick={() => setSelected(item.id)}
                aria-pressed={selected === item.id}
              >
                <span>{t(`id.${item.id}`)}</span>
                <strong>
                  {current === null ? '—' : formatNumber(current, { maximumFractionDigits: 0 })}
                  {current !== null && item.money ? ' ₸' : ''}
                </strong>
                {data.previous && (
                  <small>
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
              </button>
            );
          })}
      </div>
      <section className="card id-chart-card">
        <h2>
          {t('id.trend')} · {t(`id.${metric.id}`)}
        </h2>
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
              plugins: { legend: { position: 'bottom' } },
              scales: {
                y: {
                  title: { display: metric.money, text: '₸' },
                  ticks: { callback: (value) => formatNumber(Number(value)) },
                },
              },
            }}
            data={{
              labels: currentRows.map((row) => String(row['OpenDate.Typed']).slice(0, 10)),
              datasets: [
                {
                  label: t('id.current'),
                  data: currentRows.map((row) => valueFor(row, metric.field)),
                  borderColor: '#814522',
                  backgroundColor: '#814522',
                  tension: 0.2,
                  pointRadius: 2,
                },
                ...(data.previousTrend
                  ? [
                      {
                        label: t('id.previousLine'),
                        data: previousRows.map((row) => valueFor(row, metric.field)),
                        borderColor: '#9b8b6b',
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
        <DataTable report={data.trend} />
      </section>
    </>
  );
}

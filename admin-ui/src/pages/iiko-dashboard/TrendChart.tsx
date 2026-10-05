import { useMemo } from 'react';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
  Filler,
  type ChartData,
  type ChartOptions,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
import { useI18n } from '../../lib/i18n';
import { useReducedMotion } from '../../lib/motion';
import { datedRows, valueFor, type Report } from './model';
import { trendColors, trendFill, trendReveal } from './trend-chart-style';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend, Filler);

export default function TrendChart({
  report,
  previous,
  metric,
}: {
  report: Report;
  previous?: Report;
  metric: { id: string; field: string; money: boolean };
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const reduced = useReducedMotion();
  const currentRows = useMemo(() => datedRows(report), [report]);
  const previousRows = useMemo(() => (previous ? datedRows(previous) : []), [previous]);
  const chartKey = JSON.stringify([report.serverId, report.period, metric.field]);
  const reveal = useMemo(
    () => trendReveal(currentRows.length, reduced),
    [chartKey, currentRows.length, reduced],
  );
  const options = useMemo<ChartOptions<'line'>>(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      ...reveal,
      spanGaps: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            color: trendColors.text,
            usePointStyle: true,
            boxWidth: 8,
            padding: 22,
            font: { family: 'Montserrat', size: 12 },
          },
        },
        tooltip: {
          backgroundColor: trendColors.tooltip,
          titleColor: '#fff8ec',
          bodyColor: '#fff8ec',
          borderColor: '#a97739',
          borderWidth: 1,
          cornerRadius: 12,
          padding: 13,
          usePointStyle: true,
          callbacks: {
            label: (context) =>
              `${context.dataset.label}: ${context.parsed.y === null ? '—' : formatNumber(context.parsed.y, { maximumFractionDigits: 2 })}${metric.money ? ' ₸' : ''}`,
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxTicksLimit: 8, color: trendColors.text },
          border: { display: false },
        },
        y: {
          grid: { color: trendColors.grid },
          border: { display: false },
          title: { display: metric.money, text: '₸', color: trendColors.text },
          ticks: {
            color: trendColors.text,
            callback: (value) =>
              formatNumber(Number(value), { notation: 'compact', maximumFractionDigits: 1 }),
          },
        },
      },
    }),
    [reveal, metric.money, formatNumber],
  );
  const data = useMemo<ChartData<'line', (number | null)[]>>(
    () => ({
      labels: currentRows.map((row) =>
        formatDate(String(row['OpenDate.Typed']).slice(0, 10), { day: 'numeric', month: 'short' }),
      ),
      datasets: [
        {
          label: t('id.current'),
          data: currentRows.map((row) => valueFor(row, metric.field)),
          borderColor: trendColors.current,
          backgroundColor: trendFill,
          fill: true,
          cubicInterpolationMode: 'monotone',
          tension: 0.25,
          pointRadius: currentRows.length > 45 ? 0 : currentRows.length > 1 ? 2.5 : 4,
          pointBackgroundColor: '#fffaf1',
          pointBorderColor: trendColors.current,
          pointBorderWidth: 1.5,
          pointHoverRadius: 5,
          pointHoverBackgroundColor: trendColors.current,
          pointHoverBorderColor: '#ffffff',
          pointHoverBorderWidth: 2,
          pointHitRadius: 14,
          borderWidth: 3,
        },
        ...(previous
          ? [
              {
                label: t('id.previousLine'),
                data: previousRows.map((row) => valueFor(row, metric.field)),
                borderColor: trendColors.comparison,
                backgroundColor: trendColors.comparison,
                borderDash: [6, 5],
                borderWidth: 2,
                tension: 0.2,
                pointRadius: previousRows.length > 45 ? 0 : 1.5,
                pointHoverRadius: 4,
                pointHitRadius: 14,
                fill: false,
              },
            ]
          : []),
      ],
    }),
    [currentRows, previousRows, previous, metric.field, t, formatDate],
  );
  return <Line key={chartKey} options={options} data={data} updateMode="none" />;
}

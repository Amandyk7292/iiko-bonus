import { useEffect, useMemo, useState } from 'react';
import { Download, SlidersHorizontal } from 'lucide-react';
import { Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
} from 'chart.js';
import { useI18n } from '../../lib/i18n';
import { ApiError } from '../../lib/api';
import { loadControls } from './load-controls';
import { download } from './api';
import { errorKey, type Query, type Report } from './model';
import DataTable from './DataTable';
import { controlText } from './control-labels';
import './controls.css';
ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip);
export type ControlMode = 'writeoffs' | 'operations' | 'assortment';
type Result = {
  summary: Record<string, number | null>;
  tables: Record<string, Report>;
  fetchedAt: string;
  period: { from: string; to: string };
};
const modes = {
  writeoffs: ['branches', 'products', 'reasons', 'documents', 'trend'],
  operations: ['discounts', 'returns'],
  assortment: ['assortment'],
};
export default function Controls({
  mode,
  base,
  department,
  refresh,
}: {
  mode: ControlMode;
  base: Query;
  department: string;
  refresh: number;
}) {
  const { t, locale, formatNumber, formatDate } = useI18n();
  const text = (key: string) => controlText(locale, key);
  const [table, setTable] = useState(modes[mode][0]);
  const [criteria, setCriteria] = useState({ discountThreshold: 30, returnThreshold: 50000 });
  const [draft, setDraft] = useState(criteria);
  const [flagged, setFlagged] = useState(false);
  const [onlyAdvice, setOnlyAdvice] = useState(false);
  const [data, setData] = useState<Result>();
  const [loaded, setLoaded] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const query = useMemo(
    () => ({
      serverId: base.serverId,
      from: base.from,
      to: base.to,
      department,
      mode,
      ...criteria,
    }),
    [base.serverId, base.from, base.to, department, mode, criteria],
  );
  const queryKey = JSON.stringify(query);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadControls<Result>(query, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          setData(result);
          setLoaded(queryKey);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [queryKey, refresh]);
  const current = loaded === queryKey ? data : undefined;
  const raw = current?.tables[table];
  const report: Report | undefined = raw
    ? {
        ...raw,
        columns: Object.fromEntries(
          Object.entries(raw.columns).map(([key, column]) => [key, { ...column, name: text(key) }]),
        ),
        rows: raw.rows
          .filter(
            (row) =>
              (!flagged || mode !== 'operations' || row.Flags) &&
              (!onlyAdvice ||
                mode !== 'assortment' ||
                !['keep', 'short_period'].includes(String(row.Advice))),
          )
          .map((row) => ({
            ...row,
            ...(raw.columns.Flags
              ? {
                  Flags: String(row.Flags || '')
                    .split('|')
                    .filter(Boolean)
                    .map(text)
                    .join(' · '),
                }
              : {}),
            ...(raw.columns.Advice
              ? { Advice: text(String(row.Advice)), Pace: text(String(row.Pace)) }
              : {}),
            ...(raw.columns.Reason
              ? {
                  Reason: row.Reason || text('notSpecified'),
                  Comment: row.Comment || text('notSpecified'),
                }
              : {}),
            ...(row.CloseTime
              ? {
                  CloseTime: formatDate(String(row.CloseTime), {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  }),
                }
              : {}),
          })),
      }
    : undefined;
  const cards =
    mode === 'writeoffs'
      ? [
          ['cost', 'cost', '₸'],
          ['revenue', 'revenue', '₸'],
          ['share', 'share', '%'],
          ['change', 'change', '%'],
        ]
      : mode === 'operations'
        ? [
            ['discount', 'discount', '₸'],
            ['discountChecks', 'discountChecks', ''],
            ['returns', 'returns', '₸'],
            ['flagged', 'flagged', ''],
          ]
        : [
            ['products', 'productsCount', ''],
            ['increase', 'increase', ''],
            ['reduce', 'reduce', ''],
          ];
  const exportRows = async () => {
    setExporting(true);
    try {
      const response = await fetch('/admin/api/iiko-dashboard/controls/export', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          table,
          flaggedOnly: flagged && mode === 'operations',
          adviceOnly: onlyAdvice && mode === 'assortment',
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError('', response.status, body.code);
      }
      download(await response.blob(), `iiko-${table}-${base.from}-${base.to}.xlsx`);
    } catch (caught) {
      setError(errorKey(caught));
    } finally {
      setExporting(false);
    }
  };
  return (
    <div className="id-controls">
      {mode === 'operations' && (
        <details className="id-control-criteria">
          <summary>
            <SlidersHorizontal size={15} />
            {text('criteria')}
          </summary>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              setCriteria(draft);
            }}
          >
            <label>
              {text('discountThreshold')}
              <input
                type="number"
                min="1"
                max="100"
                value={draft.discountThreshold}
                onChange={(event) =>
                  setDraft({ ...draft, discountThreshold: Number(event.target.value) })
                }
              />
            </label>
            <label>
              {text('returnThreshold')}
              <input
                type="number"
                min="1"
                max="10000000"
                value={draft.returnThreshold}
                onChange={(event) =>
                  setDraft({ ...draft, returnThreshold: Number(event.target.value) })
                }
              />
            </label>
            <button type="submit">{t('id.apply')}</button>
          </form>
        </details>
      )}
      {error && (
        <p role="alert" className="id-error">
          {t(error)}
        </p>
      )}
      {loading && !current && (
        <div className="id-skeleton" role="status">
          {t('id.loading')}
        </div>
      )}
      {current && (
        <>
          <div className="id-control-cards">
            {cards.map(([key, label, unit]) => (
              <div key={key}>
                <span>{text(label)}</span>
                <strong>
                  {current.summary[key] === null
                    ? '—'
                    : formatNumber(current.summary[key] ?? 0, { maximumFractionDigits: 1 })}
                  {current.summary[key] !== null && unit ? ` ${unit}` : ''}
                </strong>
              </div>
            ))}
          </div>
          {mode === 'writeoffs' && current.tables.trend && (
            <section className="card id-control-chart">
              <h2>{text('trend')}</h2>
              <div role="img" aria-label={text('trend')}>
                <Line
                  options={{
                    responsive: true,
                    maintainAspectRatio: false,
                    animation: false,
                    plugins: { legend: { display: false } },
                    scales: {
                      x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } },
                      y: {
                        ticks: {
                          callback: (value) => formatNumber(Number(value), { notation: 'compact' }),
                        },
                      },
                    },
                  }}
                  data={{
                    labels: current.tables.trend.rows.map((row) =>
                      formatDate(String(row.Day), { day: 'numeric', month: 'short' }),
                    ),
                    datasets: [
                      {
                        label: text('cost'),
                        data: current.tables.trend.rows.map((row) => Number(row.WriteoffCost)),
                        borderColor: '#aa8133',
                        backgroundColor: '#f7d46733',
                        fill: true,
                        tension: 0.2,
                        pointRadius: 2,
                      },
                    ],
                  }}
                />
              </div>
            </section>
          )}
          <section className="card id-panel">
            <div className="id-actions">
              <div className="id-control-views" role="group" aria-label={t(`id.${mode}`)}>
                {modes[mode].map((value) => (
                  <button
                    type="button"
                    key={value}
                    aria-pressed={table === value}
                    onClick={() => setTable(value)}
                  >
                    {text(value)}
                  </button>
                ))}
              </div>
              {mode === 'operations' && (
                <label className="id-check">
                  <input
                    type="checkbox"
                    checked={flagged}
                    onChange={(event) => setFlagged(event.target.checked)}
                  />
                  {text('onlyFlags')}
                </label>
              )}
              {mode === 'assortment' && (
                <label className="id-check">
                  <input
                    type="checkbox"
                    checked={onlyAdvice}
                    onChange={(event) => setOnlyAdvice(event.target.checked)}
                  />
                  {text('onlyAdvice')}
                </label>
              )}
              <button
                type="button"
                disabled={loading || exporting || !report}
                onClick={() => void exportRows()}
              >
                <Download size={15} />
                {t('id.export')}
              </button>
            </div>
            <div className="id-report-meta">
              <details className="id-report-help">
                <summary>{t('id.calculation')}</summary>
                <p>
                  {text(
                    `${mode === 'operations' ? 'operations' : mode === 'assortment' ? 'assortment' : 'writeoff'}Note`,
                  )}
                </p>
              </details>
              <time dateTime={current.fetchedAt}>
                {formatDate(current.fetchedAt, { hour: '2-digit', minute: '2-digit' })}
                {loading ? ' · …' : ''}
              </time>
            </div>
            {report && (
              <DataTable
                key={table}
                report={report}
                defaultFields={
                  mode === 'assortment'
                    ? [
                        'Department',
                        'Product.Name',
                        'Product.MeasureUnit',
                        'Sold',
                        'Daily',
                        'WriteoffQuantity',
                        'Advice',
                        'SuggestedDaily',
                      ]
                    : mode === 'operations'
                      ? [
                          'Department',
                          'OrderNum',
                          'CloseTime',
                          'Cashier',
                          'AuthUser',
                          table === 'returns' ? 'ReturnSum' : 'DiscountSum',
                          'Flags',
                        ]
                      : undefined
                }
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}

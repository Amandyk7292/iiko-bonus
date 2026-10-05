import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Download, SlidersHorizontal } from '../../components/BulkaIcons';
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
import ReceiptDetails from './ReceiptDetails';
import WriteoffDocumentDetails from './WriteoffDocumentDetails';
import { controlReport } from './control-report';
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
  operations: ['discountCashiers', 'discounts', 'returns'],
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
  const [receipt, setReceipt] = useState<{ row: Record<string, unknown>; scope: string }>();
  const [selection, setSelection] = useState<{
    kind: 'branch' | 'cashier';
    key: string;
    label: string;
    scope: string;
  }>();
  const [document, setDocument] = useState<{ key: string; scope: string }>();
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
    setReceipt(undefined);
    setDocument(undefined);
  }, [queryKey, table, flagged]);
  useEffect(() => setSelection(undefined), [queryKey]);
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
  const activeSelection = selection?.scope === queryKey ? selection : undefined;
  const sourceTable = table === 'discountCashiers' && flagged ? 'discountCashiersFlagged' : table;
  const raw = current?.tables[sourceTable];
  const report = raw
    ? controlReport(
        raw,
        text,
        (value) => formatDate(value, { dateStyle: 'short', timeStyle: 'short' }),
        (row) =>
          Boolean(
            (!activeSelection ||
              (activeSelection.kind === 'branch'
                ? String(row.Department ?? '') === activeSelection.key
                : row.CashierKey === activeSelection.key)) &&
            (!flagged || mode !== 'operations' || table === 'discountCashiers' || row.Flags) &&
            (!onlyAdvice ||
              mode !== 'assortment' ||
              !['keep', 'short_period'].includes(String(row.Advice))),
          ),
      )
    : undefined;
  const selectedDocument =
    document?.scope === queryKey
      ? current?.tables.documents?.rows.find((row) => row.DocumentKey === document.key)
      : undefined;
  const selectRow =
    mode === 'writeoffs' && table === 'branches'
      ? (row: Record<string, unknown>) => {
          setSelection({
            kind: 'branch',
            key: String(row.Department ?? ''),
            label: String(row.Department || text('notSpecified')),
            scope: queryKey,
          });
          setTable('documents');
        }
      : mode === 'writeoffs' && table === 'documents'
        ? (row: Record<string, unknown>) =>
            setDocument({ key: String(row.DocumentKey), scope: queryKey })
        : mode === 'operations' && table === 'discountCashiers'
          ? (row: Record<string, unknown>) => {
              setSelection({
                kind: 'cashier',
                key: String(row.CashierKey),
                label: [row.Cashier, row.Department].filter(Boolean).join(' · '),
                scope: queryKey,
              });
              setTable('discounts');
            }
          : mode === 'operations' && table === 'discounts'
            ? (row: Record<string, unknown>) => setReceipt({ row, scope: `${queryKey}:${table}` })
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
          table: sourceTable,
          ...(activeSelection?.kind === 'branch'
            ? { documentDepartment: activeSelection.key }
            : {}),
          ...(activeSelection?.kind === 'cashier' ? { cashierKey: activeSelection.key } : {}),
          flaggedOnly: flagged && mode === 'operations',
          adviceOnly: onlyAdvice && mode === 'assortment',
        }),
        signal: AbortSignal.timeout(90000),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new ApiError('', response.status, body.code);
      }
      await download(await response.blob(), `iiko-${table}-${base.from}-${base.to}.xlsx`);
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
                    onClick={() => {
                      setSelection(undefined);
                      setTable(value);
                    }}
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
            {activeSelection && (
              <div className="id-drilldown-heading">
                <button
                  type="button"
                  onClick={() => {
                    setTable(activeSelection.kind === 'branch' ? 'branches' : 'discountCashiers');
                    setSelection(undefined);
                  }}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                  {text(activeSelection.kind === 'branch' ? 'allBranches' : 'allCashiers')}
                </button>
                <strong>{activeSelection.label}</strong>
              </div>
            )}
            {report && (
              <DataTable
                key={`${queryKey}:${table}:${activeSelection?.key ?? ''}:${flagged}`}
                report={report}
                onSelect={selectRow}
                selectLabel={text(
                  table === 'branches'
                    ? 'documents'
                    : table === 'discountCashiers'
                      ? 'checks'
                      : 'open',
                )}
                defaultSort={
                  mode === 'writeoffs' && ['branches', 'documents'].includes(table)
                    ? { field: 'WriteoffCost', direction: -1 }
                    : mode === 'operations' && ['discountCashiers', 'discounts'].includes(table)
                      ? { field: 'DiscountSum', direction: -1 }
                      : undefined
                }
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
                    : table === 'discountCashiers'
                      ? ['Rank', 'Cashier', 'Department', 'DiscountSum', 'CheckCount']
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
      {receipt && mode === 'operations' && receipt.scope === `${queryKey}:${table}` && (
        <ReceiptDetails
          serverId={base.serverId}
          row={receipt.row}
          onClose={() => setReceipt(undefined)}
        />
      )}
      {selectedDocument &&
        mode === 'writeoffs' &&
        table === 'documents' &&
        current?.tables.documentItems && (
          <WriteoffDocumentDetails
            document={selectedDocument}
            items={current.tables.documentItems}
            onClose={() => setDocument(undefined)}
          />
        )}
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { dashboardApi, exportReport } from './api';
import { comparisonRange, errorKey, validRange, type Query, type Report } from './model';
import DataTable from './DataTable';

export interface AnalyticsQuery {
  serverId: string;
  from: string;
  to: string;
  view: string;
  department: string;
  cashierId?: string;
  productId?: string;
}
const views = [
  'branches',
  'cashiers',
  'products',
  'discounts',
  'writeoffBranches',
  'writeoffProducts',
  'writeoffDocuments',
];
const salesMetrics = [
  'DishDiscountSumInt',
  'UniqOrderId',
  'AverageCheck',
  'DishAmountInt',
  'DiscountSum',
  'ItemSaleEventDiscountType.DiscountAmount',
  'DiscountRate',
  'ProductCostBase.ProductCost',
];
const labels: Record<string, string> = {
  Department: 'department',
  Cashier: 'cashier',
  DishName: 'product',
  DishGroup: 'group',
  DishMeasureUnit: 'unit',
  ItemSaleEventDiscountType: 'discountName',
  DishDiscountSumInt: 'revenue',
  DishSumInt: 'beforeDiscount',
  UniqOrderId: 'checks',
  DishAmountInt: 'salesQuantity',
  DiscountSum: 'discount',
  'ItemSaleEventDiscountType.DiscountAmount': 'discountQuantity',
  'ProductCostBase.ProductCost': 'cost',
  AverageCheck: 'average',
  'DateTime.DateTyped': 'writeoffDate',
  'Contr-Account.Name': 'writeoffAccount',
  Comment: 'comment',
  DiscountRate: 'discountRate',
  Store: 'store',
  'Product.Name': 'product',
  'Product.MeasureUnit': 'unit',
  Document: 'document',
  WriteoffQuantity: 'writeoffQuantity',
  WriteoffCost: 'writeoffCost',
  PreviousValue: 'previousLine',
  ChangePercent: 'changePercent',
};
const number = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;
const identity = (row: Record<string, unknown>, report: Report) =>
  JSON.stringify(
    Object.keys(report.columns)
      .filter(
        (field) =>
          !['MONEY', 'AMOUNT', 'INTEGER', 'NUMBER', 'PERCENT'].includes(
            report.columns[field].type,
          ) && field !== 'WriteoffQuantity',
      )
      .map((field) => row[field] ?? null),
  );

export default function Rankings({
  base,
  department,
  comparison,
  refresh,
}: {
  base: Query;
  department: string;
  comparison: string;
  refresh: number;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const [view, setView] = useState('branches');
  const [metric, setMetric] = useState('DishDiscountSumInt');
  const [focus, setFocus] = useState<{
    department?: string;
    cashierId?: string;
    productId?: string;
    label?: string;
  }>({});
  const [report, setReport] = useState<Report>();
  const [previous, setPrevious] = useState<Report>();
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState('');
  const [lastKey, setLastKey] = useState('');
  const query = useMemo<AnalyticsQuery>(
    () => ({
      serverId: base.serverId,
      from: base.from,
      to: base.to,
      view,
      department: focus.department ?? department,
      cashierId: focus.cashierId,
      productId: focus.productId,
    }),
    [base.serverId, base.from, base.to, view, department, focus],
  );
  const queryKey = JSON.stringify([query, comparison]);
  const writeoffs = view.startsWith('writeoff');
  const currentMetric = writeoffs ? 'WriteoffCost' : metric;
  useEffect(() => {
    setFocus({});
  }, [base.serverId, department]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    if (!validRange(query.from, query.to)) {
      setError('id.range');
      setLoading(false);
      return;
    }
    void (async () => {
      const current = await dashboardApi.analytics(query, controller.signal);
      const prior =
        comparison === 'none'
          ? undefined
          : await dashboardApi.analytics(
              { ...query, ...comparisonRange(query.from, query.to, comparison) },
              controller.signal,
            );
      if (!controller.signal.aborted) {
        setReport(current);
        setPrevious(prior);
        setLastKey(queryKey);
      }
    })()
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, comparison, refresh]);
  const display = useMemo<Report | undefined>(() => {
    if (!report || lastKey !== queryKey) return undefined;
    const priorRows = new Map(previous?.rows.map((row) => [identity(row, previous), row]));
    const columns = Object.fromEntries(
      Object.entries(report.columns)
        .filter(([key]) => !['Cashier.Id', 'DishId', 'Product.Id'].includes(key))
        .map(([key, value]) => [
          key,
          {
            ...value,
            name:
              key === 'AverageCheck' &&
              ['products', 'productBranches', 'cashierProducts', 'discounts'].includes(view)
                ? t('id.productCheck')
                : labels[key]
                  ? t(`id.${labels[key]}`)
                  : value.name,
          },
        ]),
    );
    if (previous) {
      columns.PreviousValue = {
        name: `${t('id.previousLine')} · ${columns[currentMetric]?.name}`,
        type: 'NUMBER',
      };
      columns.ChangePercent = { name: t('id.changePercent'), type: 'NUMBER' };
    }
    return {
      ...report,
      columns,
      rows: report.rows
        .map((row) => {
          const old = number(priorRows.get(identity(row, report))?.[currentMetric]);
          const value = number(row[currentMetric]);
          return {
            ...row,
            PreviousValue: old,
            ChangePercent:
              value !== null && old !== null && old !== 0
                ? ((value - old) / Math.abs(old)) * 100
                : null,
          };
        })
        .sort(
          (a, b) =>
            (number(b[currentMetric as keyof typeof b]) ?? -Infinity) -
            (number(a[currentMetric as keyof typeof a]) ?? -Infinity),
        ),
    };
  }, [report, previous, lastKey, queryKey, currentMetric, t]);
  const canDrill = ['branches', 'cashiers', 'products'].includes(view);
  const drill = (row: Record<string, unknown>) => {
    if (view === 'branches') {
      setView('cashiers');
      setFocus({ department: String(row.Department), label: String(row.Department) });
    }
    if (view === 'cashiers' && row['Cashier.Id']) {
      setView('cashierProducts');
      setFocus({
        department: String(row.Department),
        cashierId: String(row['Cashier.Id']),
        label: String(row.Cashier),
      });
    }
    if (view === 'products' && row.DishId) {
      setView('productBranches');
      setFocus({ productId: String(row.DishId), label: String(row.DishName) });
    }
  };
  const top = display?.rows.slice(0, 10) || [];
  const max = Math.max(
    1,
    ...top.map((row) => Math.abs(number(row[currentMetric as keyof typeof row]) ?? 0)),
  );
  return (
    <section className="card id-panel">
      <div className="id-actions">
        <label>
          <span>{t('id.dimension')}</span>
          <select
            aria-label={t('id.dimension')}
            value={view}
            onChange={(event) => {
              setView(event.target.value);
              setFocus({});
            }}
          >
            {[...views, ...(views.includes(view) ? [] : [view])].map((item) => (
              <option value={item} key={item}>
                {t(`id.${item}`)}
              </option>
            ))}
          </select>
        </label>
        {!writeoffs && (
          <label>
            <span>{t('id.metric')}</span>
            <select
              aria-label={t('id.metric')}
              value={metric}
              onChange={(event) => setMetric(event.target.value)}
            >
              {salesMetrics.map((field) => (
                <option value={field} key={field}>
                  {t(`id.${labels[field]}`)}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          type="button"
          disabled={!display || loading || exporting}
          onClick={() => {
            setExporting(true);
            void exportReport(query)
              .catch((caught) => setError(errorKey(caught)))
              .finally(() => setExporting(false));
          }}
        >
          <Download size={16} />
          {t('id.export')}
        </button>
      </div>
      {focus.label && (
        <div className="id-actions">
          <strong>{focus.label}</strong>
          <button
            type="button"
            onClick={() => {
              setFocus({});
              setView('branches');
            }}
          >
            {t('id.resetDrill')}
          </button>
        </div>
      )}
      <p className="id-muted">{t(writeoffs ? 'id.writeoffNote' : 'id.quantityNote')}</p>
      {view === 'discounts' && <p className="id-muted">{t('id.discountNote')}</p>}
      {loading && <p role="status">{t('id.loading')}</p>}
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {display && (
        <>
          <p className="id-muted">
            {t('id.updated')}:{' '}
            {formatDate(display.fetchedAt, {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            })}
          </p>
          {!!top.length && (
            <div className="id-ranking-chart" aria-label={t('id.top10')}>
              <h3>
                {t('id.top10')} · {display.columns[currentMetric]?.name}
              </h3>
              {top.map((row, index) => (
                <div className="id-ranking-bar" key={index}>
                  <div>
                    <span>
                      {index + 1}.{' '}
                      {String(
                        row.Cashier ||
                          row.DishName ||
                          row['Product.Name' as keyof typeof row] ||
                          row.Department ||
                          '—',
                      )}
                      {row.Cashier ? ` · ${row.Department}` : ''}
                    </span>
                    <strong>
                      {number(row[currentMetric as keyof typeof row]) === null
                        ? '—'
                        : formatNumber(row[currentMetric as keyof typeof row] as number, {
                            maximumFractionDigits: 2,
                          })}
                    </strong>
                  </div>
                  <div className="id-ranking-track">
                    <div
                      style={{
                        width: `${(Math.abs(number(row[currentMetric as keyof typeof row]) ?? 0) / max) * 100}%`,
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
          <DataTable
            key={`${view}-${currentMetric}`}
            report={display}
            onSelect={canDrill ? drill : undefined}
          />
        </>
      )}
    </section>
  );
}

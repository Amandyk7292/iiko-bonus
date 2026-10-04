import { useEffect, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import { useI18n } from '../../lib/i18n';
import { dashboardApi } from './api';
import { errorKey, validRange, type Report } from './model';
import { dishSalesDetails, dishSalesQuery, type DishSalesScope } from './top-dish-details';
import type { TopDish } from './top-dishes';
import './top-dish-details.css';

export default function TopDishDetails({
  product,
  serverId,
  from,
  to,
  department,
  refresh,
  onClose,
}: {
  product: TopDish;
  serverId: string;
  from: string;
  to: string;
  department: string;
  refresh: number;
  onClose: () => void;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const [attempt, setAttempt] = useState(0);
  const scope = useMemo<DishSalesScope>(
    () => ({ serverId, from, to, department, productId: product.productId, unit: product.unit }),
    [serverId, from, to, department, product.productId, product.unit],
  );
  const [result, setResult] = useState<{
    scope: DishSalesScope;
    key: string;
    report?: Report;
    error?: string;
  }>();
  const [point, setPoint] = useState({ scope, department });
  const key = JSON.stringify([scope, refresh, attempt]);
  const valid = Boolean(scope.productId) && validRange(from, to);
  const current = result?.scope === scope ? result : undefined;
  const report = valid ? current?.report : undefined;
  const error = !valid ? 'id.invalidQuery' : current?.key === key ? current.error : undefined;
  const loading = valid && current?.key !== key;
  const data = useMemo(
    () => (report ? dishSalesDetails(report.rows, scope) : undefined),
    [report, scope],
  );
  const requestedDepartment = point.scope === scope ? point.department : department;
  const selectedDepartment =
    department ||
    (data && !data.points.some((row) => row.department === requestedDepartment)
      ? ''
      : requestedDepartment);
  const selected = selectedDepartment
    ? data?.points.find((row) => row.department === selectedDepartment)
    : data;
  const date = (value: string, year = false) =>
    formatDate(`${value}T00:00:00Z`, {
      day: '2-digit',
      month: '2-digit',
      ...(year ? ({ year: 'numeric' } as const) : {}),
      timeZone: 'UTC',
    });
  const quantity = (value: number | null) =>
    value === null
      ? '—'
      : `${formatNumber(value, { maximumFractionDigits: 6 })}${product.unit ? ` ${product.unit}` : ''}`;
  const money = (value: number | null) =>
    value === null ? '—' : `${formatNumber(value, { maximumFractionDigits: 2 })} ₸`;

  useEffect(() => {
    if (
      !department &&
      point.scope === scope &&
      point.department &&
      data &&
      !data.points.some((row) => row.department === point.department)
    )
      setPoint({ scope, department: '' });
  }, [data, department, point, scope]);

  useEffect(() => {
    if (!valid) return;
    const controller = new AbortController();
    void dashboardApi
      .report(dishSalesQuery(scope), controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setResult({ scope, key, report: value });
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setResult((previous) => ({
            scope,
            key,
            error: errorKey(caught),
            report: previous?.scope === scope ? previous.report : undefined,
          }));
      });
    return () => controller.abort();
  }, [scope, key, valid]);

  return (
    <Modal
      open
      title={product.name}
      description={`${date(from, true)} — ${date(to, true)}`}
      onClose={onClose}
      size="xl"
    >
      <div className="id-dashboard id-top-dish-details" aria-busy={loading}>
        {loading && !report && (
          <p className="id-top-dish-status" role="status">
            {t('id.loading')}
          </p>
        )}
        {loading && report && (
          <span
            className="id-top-dish-refresh"
            role="status"
            aria-label={t('id.topDishesRefreshing')}
          >
            <RefreshCw size={16} className="spin" aria-hidden="true" />
          </span>
        )}
        {error && (
          <div className="id-error id-top-dishes-error" role="alert">
            <span>{t(error)}</span>
            {valid && (
              <button type="button" onClick={() => setAttempt((value) => value + 1)}>
                {t('id.refresh')}
              </button>
            )}
          </div>
        )}
        {data && !data.points.length && (
          <p className="id-top-dish-status" role="status">
            {t('id.empty')}
          </p>
        )}
        {data && !!data.points.length && (
          <div className="id-top-dish-layout">
            <section className="id-top-dish-points" aria-label={t('id.productSalesPoints')}>
              <h3>{t('id.productSalesPoints')}</h3>
              {!department && (
                <button
                  className="id-top-dish-all"
                  type="button"
                  aria-pressed={!selectedDepartment}
                  onClick={() => setPoint({ scope, department: '' })}
                >
                  {t('id.allPoints')}
                </button>
              )}
              <ul>
                {data.points.map((row) => (
                  <li key={row.department}>
                    <button
                      type="button"
                      aria-pressed={selectedDepartment === row.department}
                      onClick={() => setPoint({ scope, department: row.department })}
                    >
                      <span className="id-top-dish-point-name">{row.department || '—'}</span>
                      <span className="id-top-dish-point-values">
                        <strong>{quantity(row.quantity)}</strong>
                        <span>{money(row.revenue)}</span>
                      </span>
                      <ChevronRight size={16} aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </section>
            {selected && (
              <section className="id-top-dish-days" aria-label={t('id.productSalesDaily')}>
                <div className="id-top-dish-day-heading">
                  <h3>{t('id.productSalesDaily')}</h3>
                  <span>{selectedDepartment || t('id.allPoints')}</span>
                </div>
                <div className="id-top-dish-summary">
                  <div>
                    <span>{t('id.productSalesSold')}</span>
                    <strong>{quantity(selected.quantity)}</strong>
                  </div>
                  <div>
                    <span>{t('id.revenue')}</span>
                    <strong>{money(selected.revenue)}</strong>
                  </div>
                </div>
                <div
                  className="id-top-dish-daily-scroll"
                  tabIndex={0}
                  role="region"
                  aria-label={t('id.dailyData')}
                >
                  <table className="id-top-dish-daily">
                    <thead>
                      <tr>
                        <th scope="col">{t('id.topDishDate')}</th>
                        <th scope="col">{t('id.productSalesSold')}</th>
                        <th scope="col">{t('id.revenue')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.daily.map((row) => (
                        <tr key={row.date}>
                          <th scope="row">{date(row.date, from.slice(0, 4) !== to.slice(0, 4))}</th>
                          <td>{quantity(row.quantity)}</td>
                          <td>{money(row.revenue)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}

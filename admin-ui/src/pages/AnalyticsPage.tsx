import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, Users } from 'lucide-react';
import { Link } from '../lib/router';
import {
  ArcElement,
  BarElement,
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LinearScale,
  Tooltip,
} from 'chart.js';
import { Bar, Doughnut, Pie } from 'react-chartjs-2';
import PageState from '../components/PageState';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { chartMotion, useReducedMotion } from '../lib/motion';

ChartJS.register(ArcElement, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function AnalyticsPage() {
  const { t, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  const [stats, setStats] = useState<Record<string, any> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const fetchStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setStats(await api.getStats());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  if (loading && !stats) return <PageState type="loading" title={t('analytics.load')} />;
  if (!stats) return <PageState type="error" description={error} onRetry={fetchStats} />;

  const totalEarned = stats.totalEarned || 0;
  const totalBurned = stats.totalBurned || 0;
  const totalSales = stats.totalSales || 0;
  const branches = Array.isArray(stats.branchPerformance) ? stats.branchPerformance : [];
  const topProducts = Array.isArray(stats.topProducts) ? stats.topProducts : [];
  const funnel: Record<string, number> =
    stats.funnel && typeof stats.funnel === 'object' ? stats.funnel : {};
  const funnelConversions: Record<string, number> =
    stats.funnelConversions && typeof stats.funnelConversions === 'object'
      ? stats.funnelConversions
      : {};
  const funnelStartEvent = stats.funnelStartEvent === 'catalog_view' ? 'catalog_view' : 'app_open';
  const funnelSteps: Array<[string, string]> = [
    [
      funnelStartEvent,
      funnelStartEvent === 'catalog_view' ? 'analytics.funnelCatalog' : 'analytics.funnelOpen',
    ],
    ...(funnelStartEvent === 'app_open'
      ? ([['catalog_view', 'analytics.funnelCatalog']] as Array<[string, string]>)
      : []),
    ['add_to_cart', 'analytics.funnelCart'],
    ['checkout_start', 'analytics.funnelCheckout'],
    ['payment_created', 'analytics.funnelPayment'],
    ['payment_paid', 'analytics.funnelPaid'],
  ];
  const bonusData = {
    labels: [t('analytics.issued'), t('analytics.redeemed')],
    datasets: [
      {
        data: [totalEarned, totalBurned],
        backgroundColor: ['#b88c5a', '#7e5d40'],
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4,
      },
    ],
  };
  const revenueData = {
    labels: [t('analytics.cash'), t('analytics.bonusPaid')],
    datasets: [
      {
        data: [totalSales, totalBurned],
        backgroundColor: ['#2563eb', '#d97706'],
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 4,
      },
    ],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: chartMotion(reduceMotion),
    plugins: {
      legend: {
        position: 'bottom' as const,
        labels: { padding: 16, font: { family: 'Golos Text', size: 12 } },
      },
    },
  };
  const branchData = {
    labels: branches.map((item: any) => item.branch),
    datasets: [
      {
        label: t('analytics.branchRevenue'),
        data: branches.map((item: any) => Number(item.revenue || 0)),
        backgroundColor: '#b88c5a',
        borderRadius: 8,
      },
    ],
  };

  return (
    <div className="page-stack">
      <div className="page-actions-row justify-end">
        <button
          type="button"
          onClick={fetchStats}
          disabled={loading}
          className="btn-outline px-4 inline-flex items-center gap-2"
        >
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} />{' '}
          {t('common.refresh')}
        </button>
      </div>
      {error && (
        <div className="inline-alert inline-alert-error" role="alert">
          {error}
        </div>
      )}

      <section className="stats-grid stats-grid-primary" aria-label={t('page.analytics.title')}>
        <article className="card stat-card stat-card-featured">
          <div className="stat-icon">
            <Users aria-hidden="true" size={21} />
          </div>
          <div>
            <p>{t('analytics.totalCustomers')}</p>
            <strong>{formatNumber(stats.totalCustomers || 0)}</strong>
          </div>
          <span className="trend-pill">
            {t('analytics.new30', { count: formatNumber(stats.newCustomersLast30Days || 0) })}
          </span>
        </article>
        <article className="card stat-card">
          <p>{t('analytics.revenue')}</p>
          <strong>{formatNumber(totalSales)}</strong>
        </article>
        <article className="card stat-card">
          <p>{t('analytics.bonusPaid')}</p>
          <strong>
            {formatNumber(stats.bonusPaymentPercent || 0, { maximumFractionDigits: 2 })}%
          </strong>
        </article>
      </section>

      <section className="stats-grid stats-grid-secondary">
        <article className="card metric-card">
          <p>{t('analytics.earned')}</p>
          <strong>{formatNumber(totalEarned)}</strong>
          <small>
            {t('analytics.new30', { count: formatNumber(stats.earnedLast30Days || 0) })}
          </small>
        </article>
        <article className="card metric-card">
          <p>{t('analytics.spent')}</p>
          <strong>{formatNumber(totalBurned)}</strong>
          <small>
            {t('analytics.new30', { count: formatNumber(stats.burnedLast30Days || 0) })}
          </small>
        </article>
        <article className="card metric-card">
          <p>{t('analytics.liabilities')}</p>
          <strong>{formatNumber(stats.currentLiabilities || 0)}</strong>
          <small>{t('analytics.liabilitiesHint')}</small>
        </article>
        <article className="card metric-card metric-card-dark">
          <p>{t('analytics.iikoReport')}</p>
          <small>{t('analytics.iikoHint')}</small>
          <Link to="/iiko" className="metric-link">
            {t('analytics.openIiko')} <ArrowRight aria-hidden="true" size={15} />
          </Link>
        </article>
      </section>

      <section className="stats-grid stats-grid-secondary analytics-order-metrics">
        <article className="card metric-card">
          <p>{t('analytics.orders30')}</p>
          <strong>{formatNumber(stats.paidOrdersLast30Days || 0)}</strong>
          <small>
            {t('analytics.activeOrders', { count: formatNumber(stats.activeOrders || 0) })}
          </small>
        </article>
        <article className="card metric-card">
          <p>{t('analytics.sales30')}</p>
          <strong>{formatNumber(stats.salesLast30Days || 0)} ₸</strong>
          <small>
            {t('analytics.averageOrder', {
              amount: formatNumber(stats.averageOrderValueLast30Days || 0),
            })}
          </small>
        </article>
        <article className="card metric-card">
          <p>{t('analytics.refunds30')}</p>
          <strong>{formatNumber(stats.refundsLast30Days || 0)}</strong>
          <small>{formatNumber(stats.refundAmountLast30Days || 0)} ₸</small>
        </article>
        <article className="card metric-card">
          <p>{t('analytics.completionTime')}</p>
          <strong>
            {formatNumber(stats.averageCompletionMinutesLast30Days || 0)} {t('analytics.minutes')}
          </strong>
          <small>
            {t('analytics.cancelled30', {
              count: formatNumber(stats.cancelledOrdersLast30Days || 0),
            })}
          </small>
        </article>
      </section>

      <section className="charts-grid">
        <article className="card chart-card">
          <h2>{t('analytics.bonusTurnover')}</h2>
          <p className="sr-only">
            {t('analytics.chartSummary', {
              first: `${t('analytics.issued')}: ${formatNumber(totalEarned)}`,
              second: `${t('analytics.redeemed')}: ${formatNumber(totalBurned)}`,
            })}
          </p>
          <div className="chart-box" aria-hidden="true">
            <Doughnut data={bonusData} options={{ ...chartOptions, cutout: '65%' }} />
          </div>
        </article>
        <article className="card chart-card">
          <h2>{t('analytics.billPayments')}</h2>
          <p className="sr-only">
            {t('analytics.chartSummary', {
              first: `${t('analytics.cash')}: ${formatNumber(totalSales)}`,
              second: `${t('analytics.bonusPaid')}: ${formatNumber(totalBurned)}`,
            })}
          </p>
          <div className="chart-box" aria-hidden="true">
            <Pie data={revenueData} options={chartOptions} />
          </div>
        </article>
      </section>

      <section className="card chart-card chart-card-wide">
        <h2>{t('analytics.branchPerformance')}</h2>
        {branches.length === 0 ? (
          <PageState type="empty" title={t('analytics.noOrderData')} />
        ) : (
          <>
            <div className="chart-box chart-box-bar" aria-hidden="true">
              <Bar
                data={branchData}
                options={{
                  ...chartOptions,
                  indexAxis: 'y' as const,
                  scales: { x: { beginAtZero: true } },
                }}
              />
            </div>
            <div className="responsive-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('analytics.branch')}</th>
                    <th>{t('analytics.orders')}</th>
                    <th className="text-right">{t('analytics.revenueShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {branches.map((item: any) => (
                    <tr key={item.branch}>
                      <td data-label={t('analytics.branch')}>{item.branch}</td>
                      <td data-label={t('analytics.orders')}>{formatNumber(item.orders || 0)}</td>
                      <td data-label={t('analytics.revenueShort')} className="text-right">
                        {formatNumber(item.revenue || 0)} ₸
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      <section className="analytics-detail-grid">
        <article className="card table-card">
          <div className="table-heading">
            <div>
              <h2>{t('analytics.topProducts')}</h2>
              <p>{t('analytics.last30Days')}</p>
            </div>
          </div>
          {topProducts.length === 0 ? (
            <PageState type="empty" title={t('analytics.noOrderData')} />
          ) : (
            <div className="responsive-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>{t('analytics.product')}</th>
                    <th>{t('analytics.quantity')}</th>
                    <th className="text-right">{t('analytics.revenueShort')}</th>
                  </tr>
                </thead>
                <tbody>
                  {topProducts.map((item: any) => (
                    <tr key={item.id || item.name}>
                      <td data-label={t('analytics.product')}>{item.name || item.id}</td>
                      <td data-label={t('analytics.quantity')}>
                        {formatNumber(item.quantity || 0)}
                      </td>
                      <td data-label={t('analytics.revenueShort')} className="text-right">
                        {formatNumber(item.revenue || 0)} ₸
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </article>
        <article className="card funnel-card">
          <h2>{t('analytics.funnel')}</h2>
          <p>{t('analytics.uniqueSessions')}</p>
          <ol>
            {funnelSteps.map(([key, label]) => (
              <li key={key}>
                <span>{t(label)}</span>
                <div className="funnel-value">
                  <strong>{formatNumber(Number(funnel[key] || 0))}</strong>
                  <small>
                    {t('analytics.funnelConversion', {
                      percent: formatNumber(Number(funnelConversions[key] || 0), {
                        maximumFractionDigits: 1,
                      }),
                    })}
                  </small>
                </div>
              </li>
            ))}
          </ol>
          <dl className="funnel-payment-outcomes">
            <div>
              <dt>{t('analytics.paymentFailed')}</dt>
              <dd>{formatNumber(Number(funnel.payment_failed || 0))}</dd>
            </div>
            <div>
              <dt>{t('analytics.paymentCancelled')}</dt>
              <dd>{formatNumber(Number(funnel.payment_cancelled || 0))}</dd>
            </div>
          </dl>
        </article>
      </section>
    </div>
  );
}

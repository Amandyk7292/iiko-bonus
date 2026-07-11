import { useCallback, useEffect, useState } from 'react';
import { ArrowRight, RefreshCw, Users } from 'lucide-react';
import { Link } from 'react-router-dom';
import { ArcElement, Chart as ChartJS, Legend, Tooltip } from 'chart.js';
import { Doughnut, Pie } from 'react-chartjs-2';
import PageState from '../components/PageState';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useReducedMotion } from '../lib/motion';

ChartJS.register(ArcElement, Tooltip, Legend);

export default function AnalyticsPage() {
  const { t, formatNumber } = useI18n();
  const reduceMotion = useReducedMotion();
  const [stats, setStats] = useState<Record<string, number> | null>(null);
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

  useEffect(() => { void fetchStats(); }, [fetchStats]);

  if (loading && !stats) return <PageState type="loading" title={t('analytics.load')} />;
  if (!stats) return <PageState type="error" description={error} onRetry={fetchStats} />;

  const totalEarned = stats.totalEarned || 0;
  const totalBurned = stats.totalBurned || 0;
  const totalSales = stats.totalSales || 0;
  const bonusData = {
    labels: [t('analytics.issued'), t('analytics.redeemed')],
    datasets: [{ data: [totalEarned, totalBurned], backgroundColor: ['#b88c5a', '#7e5d40'], borderWidth: 2, borderColor: '#ffffff', hoverOffset: 4 }],
  };
  const revenueData = {
    labels: [t('analytics.cash'), t('analytics.bonusPaid')],
    datasets: [{ data: [totalSales, totalBurned], backgroundColor: ['#4ade80', '#f87171'], borderWidth: 2, borderColor: '#ffffff', hoverOffset: 4 }],
  };
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    animation: reduceMotion ? false as const : { duration: 260 },
    plugins: { legend: { position: 'bottom' as const, labels: { padding: 16, font: { family: 'Inter', size: 12 } } } },
  };

  return (
    <div className="page-stack">
      <div className="page-actions-row justify-end">
        <button type="button" onClick={fetchStats} disabled={loading} className="btn-outline px-4 inline-flex items-center gap-2">
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} /> {t('common.refresh')}
        </button>
      </div>
      {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}

      <section className="stats-grid stats-grid-primary" aria-label={t('page.analytics.title')}>
        <article className="card stat-card stat-card-featured">
          <div className="stat-icon"><Users aria-hidden="true" size={21} /></div>
          <div><p>{t('analytics.totalCustomers')}</p><strong>{formatNumber(stats.totalCustomers || 0)}</strong></div>
          <span className="trend-pill">{t('analytics.new30', { count: formatNumber(stats.newCustomersLast30Days || 0) })}</span>
        </article>
        <article className="card stat-card"><p>{t('analytics.revenue')}</p><strong>{formatNumber(totalSales)}</strong></article>
        <article className="card stat-card"><p>{t('analytics.bonusPaid')}</p><strong>{formatNumber(stats.bonusPaymentPercent || 0, { maximumFractionDigits: 2 })}%</strong></article>
      </section>

      <section className="stats-grid stats-grid-secondary">
        <article className="card metric-card"><p>{t('analytics.earned')}</p><strong>{formatNumber(totalEarned)}</strong><small>{t('analytics.new30', { count: formatNumber(stats.earnedLast30Days || 0) })}</small></article>
        <article className="card metric-card"><p>{t('analytics.spent')}</p><strong>{formatNumber(totalBurned)}</strong><small>{t('analytics.new30', { count: formatNumber(stats.burnedLast30Days || 0) })}</small></article>
        <article className="card metric-card"><p>{t('analytics.liabilities')}</p><strong>{formatNumber(stats.currentLiabilities || 0)}</strong><small>{t('analytics.liabilitiesHint')}</small></article>
        <article className="card metric-card metric-card-dark">
          <p>{t('analytics.iikoReport')}</p><small>{t('analytics.iikoHint')}</small>
          <Link to="/iiko" className="metric-link">{t('analytics.openIiko')} <ArrowRight aria-hidden="true" size={15} /></Link>
        </article>
      </section>

      <section className="charts-grid">
        <article className="card chart-card">
          <h2>{t('analytics.bonusTurnover')}</h2>
          <p className="sr-only">{t('analytics.chartSummary', { first: `${t('analytics.issued')}: ${formatNumber(totalEarned)}`, second: `${t('analytics.redeemed')}: ${formatNumber(totalBurned)}` })}</p>
          <div className="chart-box" aria-hidden="true"><Doughnut data={bonusData} options={{ ...chartOptions, cutout: '65%' }} /></div>
        </article>
        <article className="card chart-card">
          <h2>{t('analytics.billPayments')}</h2>
          <p className="sr-only">{t('analytics.chartSummary', { first: `${t('analytics.cash')}: ${formatNumber(totalSales)}`, second: `${t('analytics.bonusPaid')}: ${formatNumber(totalBurned)}` })}</p>
          <div className="chart-box" aria-hidden="true"><Pie data={revenueData} options={chartOptions} /></div>
        </article>
      </section>
    </div>
  );
}

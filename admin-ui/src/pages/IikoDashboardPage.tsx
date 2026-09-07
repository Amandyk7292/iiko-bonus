import { useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  ChartNoAxesCombined,
  Download,
  RefreshCw,
  Settings2,
  Table2,
  Warehouse,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { dashboardApi, exportReport } from './iiko-dashboard/api';
import {
  comparisonRange,
  defaultMetrics,
  errorKey,
  metrics,
  offsetDate,
  salesFilters,
  today,
  validRange,
  type Query,
  type Report,
  type Server,
} from './iiko-dashboard/model';
import Overview, { type OverviewData } from './iiko-dashboard/Overview';
import Rankings from './iiko-dashboard/Rankings';
import ReportBuilder from './iiko-dashboard/ReportBuilder';
import Balances from './iiko-dashboard/Balances';
import Settings, { parsePreferences, type Preferences } from './iiko-dashboard/Settings';
import './iiko-dashboard/dashboard.css';

const preferenceKey = 'bulka-iiko-dashboard-v1';
const tabs = [
  { id: 'overview', icon: ChartNoAxesCombined },
  { id: 'rankings', icon: BarChart3 },
  { id: 'reports', icon: Table2 },
  { id: 'balances', icon: Warehouse },
  { id: 'settings', icon: Settings2 },
];

export default function IikoDashboardPage() {
  const { t, formatDate, locale } = useI18n();
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState('aktau-chain');
  const [tab, setTab] = useState('overview');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [comparison, setComparison] = useState('previous');
  const [department, setDepartment] = useState('');
  const [departments, setDepartments] = useState<string[]>([]);
  const [overview, setOverview] = useState<OverviewData>();
  const [exportQuery, setExportQuery] = useState<Query>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      return parsePreferences(localStorage.getItem(preferenceKey) || '');
    } catch {
      return { cards: defaultMetrics, templates: [], auto: true };
    }
  });
  const selectedServer = servers.find((server) => server.id === serverId);
  const rangeValid = validRange(from, to);
  const base = useMemo<Query>(
    () => ({
      serverId,
      reportType: 'SALES',
      from,
      to,
      groupBy: [],
      aggregate: metrics.filter((item) => item.field !== 'average').map((item) => item.field),
      filters: [
        ...salesFilters,
        ...(department ? [{ field: 'Department', values: [department], exclude: false }] : []),
      ],
    }),
    [serverId, from, to, department],
  );

  useEffect(() => {
    let active = true;
    void dashboardApi
      .servers()
      .then((data) => {
        if (active) setServers(data.servers);
      })
      .catch((caught) => {
        if (active) {
          setError(errorKey(caught));
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(preferenceKey, JSON.stringify(preferences));
    } catch {
      /* Storage may be unavailable in private mode. */
    }
  }, [preferences]);
  useEffect(() => {
    if (!preferences.auto) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setRefresh((value) => value + 1);
    }, 60000);
    const foreground = () => {
      if (!document.hidden) setRefresh((value) => value + 1);
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', foreground);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', foreground);
    };
  }, [preferences.auto]);
  useEffect(() => {
    setDepartment('');
    setDepartments([]);
  }, [serverId]);
  useEffect(() => {
    if (!selectedServer?.configured || !rangeValid) return;
    const controller = new AbortController();
    void dashboardApi
      .report(
        {
          ...base,
          filters: salesFilters,
          groupBy: ['Department'],
          aggregate: ['DishDiscountSumInt'],
        },
        controller.signal,
      )
      .then((data) => {
        if (!controller.signal.aborted)
          setDepartments(
            data.rows
              .map((row) => String(row.Department))
              .filter(Boolean)
              .sort(),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [serverId, from, to, selectedServer?.configured, refresh]);
  useEffect(() => {
    setOverview(undefined);
    setExportQuery(undefined);
  }, [base, tab, comparison]);
  useEffect(() => {
    if (!selectedServer || tab !== 'overview') {
      setLoading(false);
      return;
    }
    if (!selectedServer.configured) {
      setLoading(false);
      setError('id.notConfigured');
      return;
    }
    if (!rangeValid) {
      setLoading(false);
      setError('id.range');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    const run = async () => {
      const summary = await dashboardApi.report(base, controller.signal);
      const trendQuery = { ...base, groupBy: ['OpenDate.Typed'] };
      const trend = await dashboardApi.report(trendQuery, controller.signal);
      let previous: Report | undefined;
      let previousTrend: Report | undefined;
      if (comparison !== 'none') {
        const previousQuery = { ...base, ...comparisonRange(from, to, comparison) };
        previous = await dashboardApi.report(previousQuery, controller.signal);
        previousTrend = await dashboardApi.report(
          { ...previousQuery, groupBy: ['OpenDate.Typed'] },
          controller.signal,
        );
      }
      if (!controller.signal.aborted) {
        setOverview({ summary, trend, previous, previousTrend });
        setExportQuery(trendQuery);
      }
    };
    void run()
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [base, tab, comparison, selectedServer?.configured, rangeValid, refresh]);

  const setPeriod = (period: string) => {
    const now = today();
    if (period === 'yesterday') {
      setFrom(offsetDate(now, -1));
      setTo(offsetDate(now, -1));
    } else {
      setTo(now);
      setFrom(
        period === 'week'
          ? offsetDate(now, -6)
          : period === 'month'
            ? `${now.slice(0, 7)}-01`
            : now,
      );
    }
  };
  const fetchedAt = overview?.summary.fetchedAt;
  return (
    <div className="id-dashboard page-stack">
      <section className="card id-toolbar">
        <div className="id-scope">
          <label>
            <span>{t('id.city')}</span>
            <select
              aria-label={t('id.city')}
              value={selectedServer?.city || 'aktau'}
              onChange={(event) => setServerId(`${event.target.value}-chain`)}
            >
              <option value="aktau">{locale === 'en' ? 'Aktau' : 'Актау'}</option>
              <option value="astana">{locale === 'en' ? 'Astana' : 'Астана'}</option>
            </select>
          </label>
          <label className="id-server-select">
            <span>{t('id.source')}</span>
            <select
              aria-label={t('id.source')}
              value={serverId}
              onChange={(event) => setServerId(event.target.value)}
            >
              {servers
                .filter(
                  (server) => server.active && server.city === (selectedServer?.city || 'aktau'),
                )
                .map((server) => (
                  <option value={server.id} key={server.id}>
                    {server.kind === 'chain' ? `${t('id.chain')} · ` : ''}
                    {server.host}
                    {server.configured ? '' : ` · ${t('id.missing')}`}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span>{t('id.department')}</span>
            <select
              aria-label={t('id.department')}
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
              disabled={tab === 'balances' || tab === 'settings'}
            >
              <option value="">{t('id.all')}</option>
              {departments.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="id-period">
          <div className="id-presets">
            {['today', 'yesterday', 'week', 'month'].map((period) => (
              <button type="button" key={period} onClick={() => setPeriod(period)}>
                {t(`id.${period}`)}
              </button>
            ))}
          </div>
          <label>
            <span>{t('id.from')}</span>
            <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
          </label>
          <label>
            <span>{t('id.to')}</span>
            <input type="date" value={to} onChange={(event) => setTo(event.target.value)} />
          </label>
          <label>
            <span>{t('id.compare')}</span>
            <select
              aria-label={t('id.compare')}
              value={comparison}
              onChange={(event) => setComparison(event.target.value)}
              disabled={!['overview', 'rankings'].includes(tab)}
            >
              {['previous', 'year', 'none'].map((value) => (
                <option value={value} key={value}>
                  {t(`id.${value}`)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="id-update-row">
          <label className="id-check">
            <input
              type="checkbox"
              checked={preferences.auto}
              onChange={(event) => setPreferences({ ...preferences, auto: event.target.checked })}
            />
            {t('id.auto')}
          </label>
          <span className="id-muted" role="status">
            {loading
              ? t('id.loading')
              : fetchedAt
                ? `${t('id.updated')}: ${formatDate(fetchedAt, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`
                : ''}
          </span>
          <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
            <RefreshCw size={16} className={loading ? 'spin' : ''} />
            {t('id.refresh')}
          </button>
        </div>
      </section>
      <nav className="id-tabs" aria-label="iiko Dashboard">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => {
              setTab(item.id);
              setError('');
            }}
          >
            <item.icon size={18} />
            {t(`id.${item.id}`)}
          </button>
        ))}
      </nav>
      {error && tab === 'overview' && (
        <div className="id-error" role="alert">
          {t(error)}
        </div>
      )}
      {loading && !overview && tab === 'overview' && (
        <div className="id-skeleton" role="status">
          {t('id.loading')}
        </div>
      )}
      {tab === 'overview' && overview && <Overview data={overview} cards={preferences.cards} />}
      {tab === 'rankings' && (
        <Rankings base={base} department={department} comparison={comparison} refresh={refresh} />
      )}
      {exportQuery && tab === 'overview' && (
        <div className="id-actions">
          <button
            type="button"
            disabled={exporting || loading}
            onClick={() => {
              setExporting(true);
              void exportReport(exportQuery)
                .catch((caught) => setError(errorKey(caught)))
                .finally(() => setExporting(false));
            }}
          >
            <Download size={17} />
            {t('id.export')}
          </button>
        </div>
      )}
      {tab === 'reports' && (
        <ReportBuilder
          base={base}
          refresh={refresh}
          templates={preferences.templates}
          setTemplates={(templates) => setPreferences({ ...preferences, templates })}
        />
      )}
      {tab === 'balances' && <Balances serverId={serverId} date={to} refresh={refresh} />}
      {tab === 'settings' && (
        <Settings servers={servers} preferences={preferences} onChange={setPreferences} />
      )}
    </div>
  );
}

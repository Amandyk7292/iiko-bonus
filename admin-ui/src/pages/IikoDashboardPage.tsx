import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BarChart3,
  ChartNoAxesCombined,
  Download,
  RefreshCw,
  Settings2,
  Table2,
  Warehouse,
  CalendarRange,
  ChevronDown,
  ClipboardMinus,
  ShieldCheck,
  PackageSearch,
  Handshake,
  PackagePlus,
  ClipboardCheck,
  ReceiptText,
} from 'lucide-react';
import { useI18n } from '../lib/i18n';
import { isIikoRequestPending } from '../lib/iiko-request-policy';
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
  type Server,
} from './iiko-dashboard/model';
import Overview, { type OverviewData } from './iiko-dashboard/Overview';
import { loadOverview } from './iiko-dashboard/load-overview';
import DateRangePicker from './iiko-dashboard/DateRangePicker';
import Rankings from './iiko-dashboard/Rankings';
import ReportBuilder from './iiko-dashboard/ReportBuilder';
import Balances from './iiko-dashboard/Balances';
import Settings, { parsePreferences, type Preferences } from './iiko-dashboard/Settings';
import Controls from './iiko-dashboard/Controls';
import Barters from './iiko-dashboard/Barters';
import Invoices from './iiko-dashboard/Invoices';
import Revision from './iiko-dashboard/Revision';
import CashReport from './iiko-dashboard/CashReport';
import './iiko-dashboard/dashboard.css';
import './iiko-dashboard/workspace.css';

const preferenceKey = 'bulka-iiko-dashboard-v1';
const tabs = [
  { id: 'overview', icon: ChartNoAxesCombined },
  { id: 'rankings', icon: BarChart3 },
  { id: 'reports', icon: Table2 },
  { id: 'writeoffs', icon: ClipboardMinus },
  { id: 'invoices', icon: PackagePlus },
  { id: 'revision', icon: ClipboardCheck },
  { id: 'cashReport', icon: ReceiptText },
  { id: 'operations', icon: ShieldCheck },
  { id: 'barters', icon: Handshake },
  { id: 'assortment', icon: PackageSearch },
  { id: 'balances', icon: Warehouse },
  { id: 'settings', icon: Settings2 },
];
const tabIds = new Set(tabs.map((item) => item.id));
const departmentTabs = new Set([
  'overview',
  'rankings',
  'reports',
  'writeoffs',
  'invoices',
  'revision',
  'cashReport',
  'operations',
  'barters',
  'assortment',
]);

export function dashboardUrlState() {
  const params = new URLSearchParams(window.location.search);
  const defaultFrom = offsetDate(today(), -6);
  const defaultTo = today();
  const from = params.get('from') || defaultFrom;
  const to = params.get('to') || defaultTo;
  return {
    tab: tabIds.has(params.get('tab') || '') ? String(params.get('tab')) : 'overview',
    serverId: params.get('server') || 'aktau-chain',
    from: validRange(from, to) ? from : defaultFrom,
    to: validRange(from, to) ? to : defaultTo,
    department: params.get('department') || '',
    supplier: params.get('supplier') || '',
    comparison: ['previous', 'year', 'none'].includes(params.get('comparison') || '')
      ? String(params.get('comparison'))
      : 'previous',
  };
}

export function preferredServer(servers: Server[], city: Server['city'], current = '') {
  const active = servers.filter((server) => server.active && server.city === city);
  return (
    active.find((server) => server.id === current)?.id ||
    active.find((server) => server.kind === 'chain')?.id ||
    active[0]?.id ||
    servers.find((server) => server.active)?.id ||
    ''
  );
}

export default function IikoDashboardPage() {
  const { t, formatDate, locale } = useI18n();
  const initialUrlState = useRef(dashboardUrlState()).current;
  const [servers, setServers] = useState<Server[]>([]);
  const [serverId, setServerId] = useState(initialUrlState.serverId);
  const [tab, setTab] = useState(initialUrlState.tab);
  const [{ from, to }, setRange] = useState(() => ({
    from: initialUrlState.from,
    to: initialUrlState.to,
  }));
  const periodDisclosure = useRef<HTMLDetailsElement>(null);
  const [comparison, setComparison] = useState(initialUrlState.comparison);
  const [department, setDepartment] = useState(initialUrlState.department);
  const [supplier, setSupplier] = useState(initialUrlState.supplier);
  const [departments, setDepartments] = useState<string[]>([]);
  const usesDepartments = departmentTabs.has(tab);
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
        if (active) {
          setServers(data.servers);
          setServerId((current) => {
            const requested = data.servers.find((server) => server.id === current);
            return preferredServer(data.servers, requested?.city || 'aktau', current);
          });
        }
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
  const restoringHistory = useRef(false);
  const historyInitialized = useRef(false);
  useEffect(() => {
    const restore = () => {
      const state = dashboardUrlState();
      restoringHistory.current = true;
      setTab(state.tab);
      setServerId(state.serverId);
      setRange({ from: state.from, to: state.to });
      setDepartment(state.department);
      setSupplier(state.supplier);
      setComparison(state.comparison);
    };
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);
  useEffect(() => {
    if (restoringHistory.current) {
      restoringHistory.current = false;
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const values = { tab, server: serverId, from, to, department, supplier, comparison };
    Object.entries(values).forEach(([key, value]) => {
      if (value) params.set(key, value);
      else params.delete(key);
    });
    const query = params.toString();
    const url = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
      if (historyInitialized.current) window.history.pushState(window.history.state, '', url);
      else window.history.replaceState(window.history.state, '', url);
    }
    historyInitialized.current = true;
  }, [tab, serverId, from, to, department, supplier, comparison]);
  useEffect(() => {
    if (!preferences.auto || tab === 'settings') return;
    const timer = window.setInterval(() => {
      if (!document.hidden && !isIikoRequestPending()) setRefresh((value) => value + 1);
    }, 60000);
    const foreground = () => {
      if (!document.hidden && !isIikoRequestPending()) setRefresh((value) => value + 1);
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('online', foreground);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('online', foreground);
    };
  }, [preferences.auto, tab]);
  useEffect(() => {
    if (!selectedServer?.configured || !usesDepartments) return;
    const controller = new AbortController();
    setDepartments([]);
    void dashboardApi
      .departments(serverId, controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setDepartments(
            [...new Set(data.departments.map((row) => row.name).filter(Boolean))].sort(),
          );
      })
      .catch(() => {});
    return () => controller.abort();
  }, [serverId, selectedServer?.configured, usesDepartments]);
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
    void loadOverview(
      dashboardApi.report,
      base,
      comparison === 'none' ? undefined : { ...base, ...comparisonRange(from, to, comparison) },
      controller.signal,
      (data) => {
        setOverview(data);
        if (data.trend) setExportQuery({ ...base, groupBy: ['OpenDate.Typed'] });
      },
    )
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
    setSupplier('');
    if (period === 'yesterday') {
      setRange({ from: offsetDate(now, -1), to: offsetDate(now, -1) });
    } else {
      setRange({
        to: now,
        from:
          period === 'week'
            ? offsetDate(now, -6)
            : period === 'month'
              ? `${now.slice(0, 7)}-01`
              : now,
      });
    }
  };
  const fetchedAt = overview?.summary.fetchedAt;
  return (
    <div className="id-dashboard page-stack">
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

      <section className="card id-toolbar id-toolbar-compact">
        <div className="id-primary-filters">
          <label>
            <span>{t('id.city')}</span>
            <select
              aria-label={t('id.city')}
              value={selectedServer?.city || 'aktau'}
              onChange={(event) => {
                const city = event.target.value as Server['city'];
                setDepartment('');
                setDepartments([]);
                setSupplier('');
                setServerId(preferredServer(servers, city));
              }}
            >
              <option value="aktau">{locale === 'en' ? 'Aktau' : 'Актау'}</option>
              <option value="astana">{locale === 'en' ? 'Astana' : 'Астана'}</option>
            </select>
          </label>
          <label>
            <span>{t('id.department')}</span>
            <select
              aria-label={t('id.department')}
              value={department}
              onChange={(event) => {
                setDepartment(event.target.value);
                setSupplier('');
              }}
              disabled={tab === 'balances' || tab === 'settings'}
            >
              <option value="">{t('id.all')}</option>
              {department && !departments.includes(department) && (
                <option value={department}>
                  {department} — {t('id.departmentUnavailable')}
                </option>
              )}
              {departments.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
          <div className="id-refresh-tools">
            <label className="id-auto-switch" title={t('id.auto')}>
              <input
                type="checkbox"
                checked={preferences.auto}
                onChange={(event) => setPreferences({ ...preferences, auto: event.target.checked })}
              />
              <span>{t('id.autoShort')}</span>
            </label>
            {fetchedAt && (
              <time className="id-update-time" dateTime={fetchedAt}>
                {formatDate(fetchedAt, { hour: '2-digit', minute: '2-digit' })}
              </time>
            )}
            <button
              className="id-refresh-icon"
              type="button"
              aria-label={t('id.refresh')}
              title={t('id.refresh')}
              disabled={loading}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw size={17} className={loading ? 'spin' : ''} />
            </button>
          </div>
        </div>
        <details className="id-period-disclosure" ref={periodDisclosure}>
          <summary>
            <CalendarRange size={17} />
            <span>
              {formatDate(from, { day: 'numeric', month: 'short' })} —{' '}
              {formatDate(to, { day: 'numeric', month: 'short' })}
            </span>
            <ChevronDown size={15} />
          </summary>
          <div className="id-expanded-filters">
            <div className="id-presets">
              {['today', 'yesterday', 'week', 'month'].map((period) => (
                <button type="button" key={period} onClick={() => setPeriod(period)}>
                  {t(`id.${period}`)}
                </button>
              ))}
            </div>
            <div className="id-period">
              <DateRangePicker
                from={from}
                to={to}
                onChange={(start, end) => {
                  setRange({ from: start, to: end });
                  setSupplier('');
                  setRefresh((value) => value + 1);
                  if (periodDisclosure.current) periodDisclosure.current.open = false;
                  requestAnimationFrame(() =>
                    periodDisclosure.current?.querySelector('summary')?.focus(),
                  );
                }}
              />
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
              <label className="id-server-select">
                <span>{t('id.source')}</span>
                <select
                  aria-label={t('id.source')}
                  value={serverId}
                  onChange={(event) => {
                    setDepartment('');
                    setDepartments([]);
                    setSupplier('');
                    setServerId(event.target.value);
                  }}
                >
                  {servers
                    .filter(
                      (server) =>
                        server.active && server.city === (selectedServer?.city || 'aktau'),
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
            </div>
          </div>
        </details>
      </section>
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
        <Rankings
          key="sales"
          base={base}
          department={department}
          comparison={comparison}
          refresh={refresh}
        />
      )}
      {tab === 'writeoffs' && (
        <Controls
          key="writeoffs"
          mode="writeoffs"
          base={base}
          department={department}
          refresh={refresh}
        />
      )}
      {tab === 'invoices' && (
        <Invoices
          base={base}
          department={department}
          refresh={refresh}
          supplier={supplier}
          onSupplierChange={setSupplier}
        />
      )}
      {tab === 'revision' && <Revision base={base} department={department} refresh={refresh} />}
      {tab === 'cashReport' && (
        <CashReport
          base={base}
          department={department}
          refresh={refresh}
          onDepartmentChange={setDepartment}
        />
      )}
      {tab === 'operations' && (
        <Controls
          key="operations"
          mode="operations"
          base={base}
          department={department}
          refresh={refresh}
        />
      )}
      {tab === 'assortment' && (
        <Controls
          key="assortment"
          mode="assortment"
          base={base}
          department={department}
          refresh={refresh}
        />
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
      {tab === 'barters' && (
        <Barters key={serverId} base={base} department={department} refresh={refresh} />
      )}
      {tab === 'settings' && (
        <Settings
          servers={servers}
          preferences={preferences}
          onChange={setPreferences}
          onServersChange={(updated) => {
            setServers(updated);
            if (!updated.some((server) => server.id === serverId && server.active)) {
              setServerId(preferredServer(updated, selectedServer?.city || 'aktau'));
            }
          }}
        />
      )}
    </div>
  );
}

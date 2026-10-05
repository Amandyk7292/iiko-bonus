import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCheck, Download, History, RefreshCw, Search, Wallet } from '../components/BulkaIcons';
import Modal from '../components/Modal';
import { ApiError, getAdminBranchScope, request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { exportCashierPayroll } from './cashier-payroll-api';
import { payrollCopy } from './cashier-payroll-copy';
import { filterPayroll, payrollMonthLabel, payrollPoints, payrollTime, validPayrollMonth } from './cashier-payroll-model';
import type { CashierPayrollResponse, CashierPayrollRow } from './cashier-payroll-model';
import '../styles/cashier-payroll.css';

type PaymentIntent = {
  row: CashierPayrollRow;
  month: string;
  key: string;
  scope: string;
  idempotencyKey: string;
  error?: string;
  conflict?: boolean;
};

function currentMonth() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty', year: 'numeric', month: '2-digit',
  }).format(new Date());
}

export default function CashierPayroll({ active = true, scope = getAdminBranchScope() }: { active?: boolean; scope?: string }) {
  const { locale, formatNumber } = useI18n();
  const text = payrollCopy[locale === 'kk' ? 'kk' : 'ru'];
  const [month, setMonth] = useState(currentMonth);
  const [city, setCity] = useState('');
  const [point, setPoint] = useState<{ id: string; label: string } | null>(null);
  const [search, setSearch] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; response?: CashierPayrollResponse; error?: string }>();
  const [pendingKey, setPendingKey] = useState<string>();
  const [intent, setIntent] = useState<PaymentIntent | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState('');
  const [historyKey, setHistoryKey] = useState<string>();
  const [exportState, setExportState] = useState<{ key: string; busy?: boolean; error?: string }>();
  const pending = useRef(false);
  const paymentPending = useRef(false);
  const pendingKeys = useRef(new Map<string, string>());
  const exportController = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const valid = validPayrollMonth(month);
  const key = `${month}|${scope}`;
  const latest = useRef({ key, active });
  latest.current = { key, active };
  const current = valid && result?.key === key ? result : undefined;
  const rows = current?.response?.items || [];
  const loading = valid && !current;
  const refreshing = pendingKey === key;
  const filters = { month, city, pointId: point?.id || '', search: search.trim() };
  const exportKey = `${key}|${city}|${point?.id || ''}|${search.trim()}`;
  const exporting = exportState?.key === exportKey && exportState.busy;
  const cities = useMemo(() => [...new Set(rows.map((row) => row.city).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b)), [rows]);
  const points = useMemo(() => payrollPoints(rows, city, text.unassignedPoint), [rows, city, text.unassignedPoint]);
  const filtered = useMemo(() => filterPayroll(rows, { month, city, pointId: point?.id || '', search }),
    [rows, month, city, point, search]);
  const totals = filtered.reduce((sum, row) => ({
    completed: sum.completed + row.completed,
    rewardAmount: sum.rewardAmount + row.rewardAmount,
    paidAmount: sum.paidAmount + row.paidAmount,
    outstandingAmount: sum.outstandingAmount + row.outstandingAmount,
  }), { completed: 0, rewardAmount: 0, paidAmount: 0, outstandingAmount: 0 });
  const currentIntentRow = intent ? rows.find((row) => row.rowKey === intent.row.rowKey) : undefined;
  const intentChanged = Boolean(intent && (intent.conflict || intent.key !== key ||
    (current?.response && (!current.response.canMarkPaid || !currentIntentRow ||
      currentIntentRow.snapshot !== intent.row.snapshot ||
      currentIntentRow.outstandingAmount !== intent.row.outstandingAmount ||
      currentIntentRow.outstandingCount !== intent.row.outstandingCount))));
  const history = rows.find((row) => row.rowKey === historyKey);
  const money = (value: number) => `${formatNumber(value)} ₸`;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; exportController.current?.abort(); };
  }, []);

  useEffect(() => {
    if (!active || !valid) return;
    const controller = new AbortController();
    pending.current = true;
    setPendingKey(key);
    void request<CashierPayrollResponse>(`/bonus/cashier-payroll?month=${month}`,
      { signal: controller.signal }, { branchScope: scope })
      .then((response) => {
        if (response.month !== month) throw new Error(text.loadError);
        if (!controller.signal.aborted) setResult({ key, response });
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setResult((previous) => ({
          key, response: previous?.key === key ? previous.response : undefined,
          error: caught instanceof Error && caught.message ? caught.message : text.loadError,
        }));
      })
      .finally(() => {
        if (!controller.signal.aborted) { pending.current = false; setPendingKey(undefined); }
      });
    return () => { controller.abort(); pending.current = false; };
  }, [active, valid, month, key, scope, attempt, text.loadError]);

  useEffect(() => {
    if (!active || !valid) return;
    const refresh = () => {
      if (document.visibilityState === 'visible' && !pending.current) setAttempt((value) => value + 1);
    };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
    };
  }, [active, valid]);

  useEffect(() => {
    setIntent(null);
    setHistoryKey(undefined);
    setNotice('');
  }, [key, active]);

  useEffect(() => {
    exportController.current?.abort();
    setExportState(undefined);
    return () => { exportController.current?.abort(); };
  }, [exportKey, active]);

  const openPayment = (row: CashierPayrollRow) => {
    if (paymentPending.current || !current?.response?.canMarkPaid || row.outstandingAmount <= 0) return;
    const fingerprint = `${key}|${row.rowKey}|${row.snapshot}`;
    const idempotencyKey = pendingKeys.current.get(fingerprint) || crypto.randomUUID();
    pendingKeys.current.set(fingerprint, idempotencyKey);
    setNotice('');
    setIntent({ row, month, key, scope, idempotencyKey });
  };

  const markPaid = async () => {
    if (!intent || paymentPending.current || intentChanged || !active || refreshing) return;
    const submitted = intent;
    paymentPending.current = true;
    setPaying(true);
    setIntent((value) => value && { ...value, error: undefined });
    try {
      await request('/bonus/cashier-payroll/payments', {
        method: 'POST', body: JSON.stringify({
          month: submitted.month, rowKey: submitted.row.rowKey,
          snapshot: submitted.row.snapshot, idempotencyKey: submitted.idempotencyKey,
        }),
      }, { branchScope: submitted.scope });
      pendingKeys.current.delete(`${submitted.key}|${submitted.row.rowKey}|${submitted.row.snapshot}`);
      if (mounted.current && latest.current.key === submitted.key && latest.current.active) {
        setIntent((value) => value?.idempotencyKey === submitted.idempotencyKey ? null : value);
        setNotice(text.recorded);
        setAttempt((value) => value + 1);
      }
    } catch (caught) {
      if (mounted.current && latest.current.key === submitted.key && latest.current.active) {
        const conflict = caught instanceof ApiError && [401, 403, 409].includes(caught.status);
        const error = conflict ? text.changed : caught instanceof Error && caught.message ? caught.message : text.paymentError;
        setIntent((value) => value?.idempotencyKey === submitted.idempotencyKey ? { ...value, error, conflict } : value);
        setNotice(error);
      }
    } finally {
      paymentPending.current = false;
      if (mounted.current) setPaying(false);
    }
  };

  const exportRows = async () => {
    if (!current?.response || exporting) return;
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExportState({ key: exportKey, busy: true });
    try {
      await exportCashierPayroll(filters, scope, controller.signal);
    } catch (caught) {
      if (!controller.signal.aborted) setExportState({ key: exportKey,
        error: caught instanceof ApiError && caught.message ? caught.message : text.exportError });
    } finally {
      if (!controller.signal.aborted) setExportState((value) => value?.key === exportKey ? { ...value, busy: false } : value);
    }
  };

  return (
    <section className="card cashier-payroll" aria-label={text.heading} aria-busy={loading || refreshing}>
      <header className="cashier-payroll-heading">
        <span className="cashier-payroll-heading-icon" aria-hidden="true"><Wallet size={22} /></span>
        <h2>{text.heading}</h2>
        <button type="button" className="icon-button" aria-label={text.refresh} title={text.refresh}
          disabled={loading || refreshing || !valid} onClick={() => setAttempt((value) => value + 1)}>
          <RefreshCw size={19} aria-hidden="true" className={loading || refreshing ? 'spin' : undefined} />
        </button>
      </header>
      <div className="cashier-payroll-filters">
        <label className="field-group" htmlFor="cashier-payroll-month"><span>{text.month}</span>
          <input id="cashier-payroll-month" className="input-classic" type="month" value={month}
            onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label className="field-group" htmlFor="cashier-payroll-city"><span>{text.city}</span>
          <select id="cashier-payroll-city" className="input-classic" value={city}
            onChange={(event) => { setCity(event.target.value); setPoint(null); }}>
            <option value="">{text.allCities}</option>
            {city && !cities.includes(city) && <option value={city}>{city}</option>}
            {cities.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="field-group" htmlFor="cashier-payroll-point"><span>{text.point}</span>
          <select id="cashier-payroll-point" className="input-classic" value={point?.id || ''} disabled={!city}
            onChange={(event) => setPoint(points.find((value) => value.id === event.target.value) || null)}>
            <option value="">{city ? text.allPoints : text.chooseCity}</option>
            {point && !points.some((value) => value.id === point.id) && <option value={point.id}>{point.label}</option>}
            {points.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}
          </select>
        </label>
        <label className="field-group cashier-payroll-search" htmlFor="cashier-payroll-search"><span>{text.search}</span>
          <div><Search size={18} aria-hidden="true" />
            <input id="cashier-payroll-search" className="input-classic" type="search" value={search}
              onChange={(event) => setSearch(event.target.value)} />
          </div>
        </label>
      </div>
      {!valid && <p className="inline-alert inline-alert-error" role="alert">{text.invalidMonth}</p>}
      {current?.error && <div className="inline-alert inline-alert-error" role="alert">
        <span>{current.error}</span><button type="button" className="btn-outline" onClick={() => setAttempt((value) => value + 1)}>{text.retry}</button>
      </div>}
      {loading && <p className="cashier-payroll-loading" role="status"><RefreshCw className="spin" size={20} aria-hidden="true" />{text.loading}</p>}
      {notice && !intent?.error && <p className="cashier-payroll-notice" role="status">{notice}</p>}
      {current?.response && <>
        <dl className="cashier-payroll-stats">
          {[[text.registrations, formatNumber(totals.completed)], [text.accrued, money(totals.rewardAmount)],
            [text.paid, money(totals.paidAmount)], [text.outstanding, money(totals.outstandingAmount)]].map(([label, value]) =>
            <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        </dl>
        <div className="cashier-payroll-export">
          <button type="button" className="btn-outline" disabled={Boolean(exporting) || refreshing}
            onClick={() => void exportRows()}>
            {exporting ? <RefreshCw className="spin" aria-hidden="true" size={18} /> : <Download aria-hidden="true" size={18} />}
            {exporting ? text.exporting : text.export}
          </button>
          {exportState?.key === exportKey && exportState.error && <span role="alert">{exportState.error}</span>}
        </div>
        {filtered.length ? <table className="cashier-payroll-table">
          <thead><tr><th>{text.cashier}</th><th>{text.registrations}</th><th>{text.accrued}</th><th>{text.paid}</th><th>{text.outstanding}</th><th><span className="sr-only">{text.markPaid}</span></th></tr></thead>
          <tbody>{filtered.map((row) => <tr key={row.rowKey}>
            <th scope="row" className="cashier-payroll-person"><strong>{row.name}</strong>
              {row.isArchived && <span className="cashier-payroll-archive">{text.archive}</span>}
              <span>{[row.branchName, row.city].filter(Boolean).join(' · ')}</span>
            </th>
            <td data-label={text.registrations}>{formatNumber(row.completed)}</td>
            <td data-label={text.accrued}>{money(row.rewardAmount)}</td>
            <td data-label={text.paid}>{money(row.paidAmount)}</td>
            <td data-label={text.outstanding}><strong>{money(row.outstandingAmount)}</strong>
              {row.outstandingAmount === 0 && row.paidAmount > 0 && <span className="cashier-payroll-paid"><CheckCheck size={14} aria-hidden="true" />{text.paid}</span>}
            </td>
            <td className="cashier-payroll-actions">
              {current.response!.canMarkPaid && row.outstandingAmount > 0 && <button type="button" className="btn-classic"
                aria-label={`${text.markPaid}: ${row.name}`} disabled={paying || refreshing} onClick={() => openPayment(row)}>{text.markPaid}</button>}
              {row.payments.length > 0 && <button type="button" className="btn-outline"
                aria-label={`${text.history}: ${row.name}`} onClick={() => setHistoryKey(row.rowKey)}>
                <History size={16} aria-hidden="true" />{text.history}
              </button>}
            </td>
          </tr>)}</tbody>
        </table> : <p className="cashier-payroll-empty">{text.empty}</p>}
      </>}
      {intent && <Modal open title={text.markPaid} description={intent.row.name} size="sm" onClose={() => setIntent(null)}
        footer={<div className="cashier-payroll-modal-actions">
          <button type="button" className="btn-outline" onClick={() => setIntent(null)}>{text.cancel}</button>
          {intentChanged ? <button type="button" className="btn-classic" disabled={paying}
            onClick={() => { setIntent(null); setAttempt((value) => value + 1); }}>{text.refreshData}</button>
            : <button type="button" className="btn-classic" disabled={paying || refreshing}
              onClick={() => void markPaid()}>{paying ? <RefreshCw className="spin" size={17} aria-hidden="true" /> : null}{intent.error ? text.retry : text.confirm}</button>}
        </div>}>
        <div className="modal-body cashier-payroll-confirm">
          <p>{[intent.row.branchName, intent.row.city].filter(Boolean).join(' · ')}</p>
          <dl><div><dt>{text.month}</dt><dd>{payrollMonthLabel(intent.month, locale)}</dd></div>
            <div><dt>{text.registrations}</dt><dd>{formatNumber(intent.row.outstandingCount)}</dd></div>
            <div><dt>{text.outstanding}</dt><dd>{money(intent.row.outstandingAmount)}</dd></div></dl>
          <p>{text.paymentNote}</p>
          {(intentChanged || intent.error) && <p className="inline-alert inline-alert-error" role="alert">{intentChanged ? text.changed : intent.error}</p>}
        </div>
      </Modal>}
      {history && <Modal open title={text.history} description={history.name} size="sm" onClose={() => setHistoryKey(undefined)}>
        <div className="modal-body cashier-payroll-history"><p>{[history.branchName, history.city].filter(Boolean).join(' · ')}</p>
          <ul>{history.payments.map((payment) => <li key={payment.id}>
            <strong>{money(payment.amount)}</strong>
            <span>{text.registrations}: {formatNumber(payment.registrations)}</span>
            <time dateTime={payment.paidAt}>{payrollTime(payment.paidAt, locale)}</time>
            <span>{text.actor}: {payment.paidBy || text.unknownActor}</span>
          </li>)}</ul>
        </div>
      </Modal>}
    </section>
  );
}

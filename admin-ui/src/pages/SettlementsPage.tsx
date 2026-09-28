import SettlementDetails, { type Drill } from './SettlementDetails';
import SettlementMonths from './SettlementMonths';
import SettlementPortal from './SettlementPortal';
import BranchOrderCards from './BranchOrderCards';
import { useSettlementFilters } from './use-settlement-filters';
import { ExportBranches, ExportPayout } from './SettlementExports';
import { useCallback, useEffect, useRef, useState } from 'react';
import DateInput from '../components/DateInput';
import SelectControl from '../components/SelectControl';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import SettlementTerms from './SettlementTerms';
import { ReconcileOrder, RecordPayout } from './SettlementActions';
import type { Config, Report, Balance, OrderFinance } from './settlements-model';
import './settlements.css';
export default function SettlementsPage() {
  const { formatNumber, formatDate, t } = useI18n();
  const status = (value: string) =>
    t(
      'settlements.status.' +
        ([
          'paid',
          'refunded',
          'pending',
          'created',
          'failed',
          'expired',
          'cancelled',
          'new',
          'accepted',
          'preparing',
          'ready',
          'completed',
        ].includes(value)
          ? value
          : 'unknown'),
    );
  const money = (n: number) => `${formatNumber(Number(n))} ₸`;
  const { from, to, branch, offset, setFrom, setTo, setBranch, setOffset } = useSettlementFilters();
  const [config, setConfig] = useState<Config>({ locations: [], partners: [], terms: [] }),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<OrderFinance | null>(null),
    [balance, setBalance] = useState<Balance | null>(null);
  const [drill, setDrill] = useState<Drill | null>(null);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const seq = ++sequence.current;
    setBusy(true);
    setError('');
    try {
      const params = new URLSearchParams({ from, to, offset: String(offset) });
      if (branch) params.set('branch', branch);
      const [c, r] = await Promise.all([
        request<Config>('/transactions/settlements/config'),
        request<Report>(`/transactions/settlements?${params}`),
      ]);
      if (seq === sequence.current) {
        setConfig(c);
        setReport(r);
      }
    } catch (e) {
      if (seq === sequence.current) {
        setReport(null);
        setError(e instanceof Error ? e.message : t('settlements.copy58'));
      }
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }, [from, to, branch, offset, t]);
  useEffect(() => {
    void load();
    return () => {
      sequence.current++;
    };
  }, [load]);
  return (
    <div className="page settlements-page">
      <div className="page-header">
        <div>
          <h1>{t('settlements.copy0')}</h1>
          <p>{t('settlements.copy1')}</p>
        </div>
        {report?.canManage && <SettlementTerms config={config} onSaved={load} />}
      </div>
      <div className="card settlement-filters">
        <label className="field-group">
          <span>{t('settlements.copy2')}</span>
          <DateInput
            required
            value={from}
            max={to}
            min={new Date(Date.parse(to) - 366 * 86400000).toISOString().slice(0, 10)}
            onChange={(e) => {
              setFrom(e.target.value);
            }}
          />
        </label>
        <label className="field-group">
          <span>{t('settlements.copy3')}</span>
          <DateInput
            required
            value={to}
            min={from}
            max={new Date(Date.parse(from) + 366 * 86400000).toISOString().slice(0, 10)}
            onChange={(e) => {
              setTo(e.target.value);
            }}
          />
        </label>
        <div className="field-group">
          <label htmlFor="report-branch">{t('settlements.copy4')}</label>
          <SelectControl
            id="report-branch"
            value={branch}
            onChange={(v) => {
              setBranch(v);
            }}
            options={[
              { value: '', label: t('settlements.copy5') },
              ...config.locations.map((l) => ({ value: l.id, label: `${l.city} · ${l.name}` })),
            ]}
          />
        </div>
        <button className="btn-outline" disabled={busy} onClick={() => void load()}>
          {busy ? t('settlements.copy6') : t('settlements.copy7')}
        </button>
      </div>
      <p className="field-hint">{t('settlements.copy78')}</p>
      {error && (
        <p role="alert" className="inline-alert inline-alert-error">
          {error}
        </p>
      )}
      {report && (
        <div aria-busy={busy} className="form-stack">
          <section className="card">
            <h2>{t('settlements.copy8')}</h2>
            <ExportBranches rows={report.branches} />
            <p className="field-hint">{t('settlements.simple.note')}</p>
            <BranchOrderCards branches={report.branches} onDrill={setDrill} />
            {report.branches.length === 0 && <p>{t('settlements.copy23')}</p>}
          </section>
          <section className="card">
            <h2>{t('settlements.bank.title')}</h2>
            <p>{t('settlements.bank.note')}</p>
            <button
              className="btn-outline"
              onClick={() => setDrill({ branch: branch || undefined, metric: 'issues' })}
            >
              {t('settlements.bank.open')}
            </button>
          </section>
          <SettlementMonths config={config} canManage={report.canManage} />
          {report.canManage && <SettlementPortal config={config} />}
          <section className="card">
            <h2>{t('settlements.copy24')}</h2>
            <p>{t('settlements.copy80')}</p>
            <div
              className="responsive-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t('settlements.copy10')}
            >
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    {[
                      t('settlements.copy25'),
                      t('settlements.copy26'),
                      t('settlements.copy27'),
                      t('settlements.copy28'),
                      t('settlements.copy29'),
                      t('settlements.copy30'),
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.balances.map((b) => (
                    <tr key={`${b.branch_id}:${b.partner_id}`}>
                      <td>
                        {b.branch}
                        <small>{b.partner}</small>
                      </td>
                      <td>{money(b.accrued)}</td>
                      <td>{money(b.paid_out)}</td>
                      <td>{money(b.balance)}</td>
                      <td>
                        {b.blocked > 0
                          ? `${t('settlements.copy22')} ${b.blocked}`
                          : t('settlements.copy31')}
                      </td>
                      <td>
                        {report.canManage && (
                          <button
                            className="btn-outline"
                            disabled={busy || b.blocked > 0 || Number(b.balance) <= 0}
                            onClick={() => setBalance(b)}
                          >
                            {t('settlements.copy32')}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.balances.length === 0 && <p>{t('settlements.copy81')}</p>}
          </section>
          <section className="card">
            <h2>{t('settlements.copy33')}</h2>
            <div
              className="responsive-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t('settlements.copy10')}
            >
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    {[
                      t('settlements.copy34'),
                      t('settlements.copy35'),
                      t('settlements.copy36'),
                      t('settlements.copy37'),
                      t('settlements.copy21'),
                      t('settlements.copy38'),
                      t('settlements.copy39'),
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.orders.map((o) => (
                    <tr key={o.order_id}>
                      <td>
                        #{o.order_number}
                        <small>
                          {o.branch || t('settlements.copy40')} · {o.partner || 'Bulka'}
                        </small>
                        <small>
                          {formatDate(o.ordered_at, {
                            timeZone: 'Asia/Almaty',
                          })}
                        </small>
                      </td>
                      <td>
                        {status(o.status)} / {status(o.fulfillment_status)}
                      </td>
                      <td>
                        {money(o.cash_amount)}
                        <small>
                          {t('settlements.copy41')} {money(o.cash_refunded)}
                        </small>
                      </td>
                      <td>
                        {o.payment_recipient === 'platform' ? 'Bulka' : t('settlements.copy42')}
                        <small>
                          {t(
                            o.payment_confirmed
                              ? 'settlements.auto.paymentConfirmed'
                              : o.payment_statement_confirmed
                                ? 'settlements.auto.statement'
                                : o.payment_review
                                  ? 'settlements.auto.review'
                                  : 'settlements.auto.wait',
                          )}
                        </small>
                      </td>
                      <td>
                        {o.acquiring_fee === null
                          ? t(
                              o.settlement_model === 2
                                ? o.partner
                                  ? 'settlements.auto.bankIncluded'
                                  : 'settlements.auto.bankCompany'
                                : 'settlements.copy44',
                            )
                          : money(o.acquiring_fee)}
                      </td>
                      <td>
                        {o.partner ? money(o.entitlement) : t('settlements.copy45')}
                        {o.partner && o.settlement_model === 2 && (
                          <small>
                            {t('settlements.auto.deliveryCost')}:{' '}
                            {o.delivery_actual_cost == null
                              ? t('settlements.auto.deliveryPending')
                              : money(o.delivery_actual_cost)}{' '}
                            · {t('settlements.auto.customerDelivery')}: {money(o.delivery_net)}
                          </small>
                        )}
                      </td>
                      <td>
                        {o.branch_changed
                          ? t('settlements.copy46')
                          : o.delivery_cost_pending
                            ? t('settlements.auto.deliveryPending')
                            : o.payment_review
                              ? t('settlements.auto.review')
                              : o.payment_confirmed
                                ? t('settlements.auto.paymentConfirmed')
                                : o.payment_statement_confirmed
                                  ? t('settlements.auto.statement')
                                  : t('settlements.auto.wait')}
                        {report.canManage &&
                          ['paid', 'refunded'].includes(o.status) &&
                          (o.payment_review === undefined ? !o.reconciled : o.payment_review) && (
                            <button
                              className="btn-outline"
                              disabled={busy || o.branch_changed}
                              onClick={() => setOrder(o)}
                            >
                              {t('settlements.copy48')}
                            </button>
                          )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.orders.length === 0 && <p>{t('settlements.copy49')}</p>}
            <div className="settlement-pagination">
              <button
                className="btn-outline"
                disabled={busy || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                {t('settlements.copy50')}
              </button>
              <span>
                {report.totalOrders
                  ? `${offset + 1}–${Math.min(offset + 50, report.totalOrders)}`
                  : '0'}{' '}
                {t('settlements.copy52')} {report.totalOrders}
              </span>
              <button
                className="btn-outline"
                disabled={busy || offset + 50 >= report.totalOrders}
                onClick={() => setOffset(offset + 50)}
              >
                {t('settlements.copy51')}
              </button>
            </div>
          </section>
          <section className="card">
            <h2>{t('settlements.copy53')}</h2>
            <p className="field-hint">{t('settlements.copy82')}</p>
            <div
              className="responsive-table-wrap"
              tabIndex={0}
              role="region"
              aria-label={t('settlements.copy10')}
            >
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    <th>{t('settlements.copy54')}</th>
                    <th>{t('settlements.copy25')}</th>
                    <th>{t('settlements.copy55')}</th>
                    <th>{t('settlements.copy56')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.payouts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {formatDate(p.paid_at, {
                          timeZone: 'Asia/Almaty',
                        })}
                      </td>
                      <td>
                        {p.branch}
                        <small>{p.partner}</small>
                      </td>
                      <td>{money(p.amount)}</td>
                      <td>
                        {p.bank_reference}
                        <ExportPayout payout={p} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!report.payouts.length && <p>{t('settlements.copy57')}</p>}
          </section>
        </div>
      )}
      {drill && (
        <SettlementDetails
          drill={drill}
          from={from}
          to={to}
          canManage={!!report?.canManage}
          onClose={() => setDrill(null)}
        />
      )}
      {order && <ReconcileOrder order={order} onClose={() => setOrder(null)} onSaved={load} />}
      {balance && (
        <RecordPayout balance={balance} onClose={() => setBalance(null)} onSaved={load} />
      )}
    </div>
  );
}

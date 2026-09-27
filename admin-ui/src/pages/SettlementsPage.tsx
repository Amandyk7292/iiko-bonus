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
const today = () => new Date(Date.now() + 5 * 3600000).toISOString().slice(0, 10);
export default function SettlementsPage() {
  const { formatNumber } = useI18n();
  const money = (n: number) => `${formatNumber(Number(n))} ₸`;
  const [from, setFrom] = useState(() => `${today().slice(0, 7)}-01`),
    [to, setTo] = useState(today),
    [branch, setBranch] = useState(''),
    [offset, setOffset] = useState(0);
  const [config, setConfig] = useState<Config>({ locations: [], partners: [], terms: [] }),
    [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [order, setOrder] = useState<OrderFinance | null>(null),
    [balance, setBalance] = useState<Balance | null>(null);
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
        setError(e instanceof Error ? e.message : 'Не удалось загрузить отчёт');
      }
    } finally {
      if (seq === sequence.current) setBusy(false);
    }
  }, [from, to, branch, offset]);
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
          <h1>Отчёт по точкам и партнёрам</h1>
          <p>Заказы приложения, оплата и взаиморасчёты</p>
        </div>
        {report?.canManage && <SettlementTerms config={config} onSaved={load} />}
      </div>
      <div className="card settlement-filters">
        <label className="field-group">
          <span>С даты</span>
          <DateInput
            value={from}
            max={to}
            onChange={(e) => {
              setFrom(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <label className="field-group">
          <span>По дату</span>
          <DateInput
            value={to}
            min={from}
            onChange={(e) => {
              setTo(e.target.value);
              setOffset(0);
            }}
          />
        </label>
        <div className="field-group">
          <label htmlFor="report-branch">Точка</label>
          <SelectControl
            id="report-branch"
            value={branch}
            onChange={(v) => {
              setBranch(v);
              setOffset(0);
            }}
            options={[
              { value: '', label: 'Все доступные точки' },
              ...config.locations.map((l) => ({ value: l.id, label: `${l.city} · ${l.name}` })),
            ]}
          />
        </div>
        <button className="btn-outline" disabled={busy} onClick={() => void load()}>
          {busy ? 'Загрузка…' : 'Обновить'}
        </button>
      </div>
      <p className="field-hint">
        Заказы отобраны по дате создания, время Казахстана. Статусы и возвраты — на текущий момент.
        Эквайринг и получатель денег сверяются вручную с банковской выпиской.
      </p>
      {error && (
        <p role="alert" className="inline-alert inline-alert-error">
          {error}
        </p>
      )}
      {report && (
        <div aria-busy={busy} className="form-stack">
          <section className="card">
            <h2>Заказы по точкам</h2>
            <div className="responsive-table-wrap">
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    {[
                      'Точка',
                      'Заказы / покупатели',
                      'Оплачено / выполнено',
                      'Отменено / с возвратом',
                      'Оплачено деньгами',
                      'Возвращено',
                      'Деньги после возвратов',
                      'Бонусы',
                      'Доставка',
                      'Скидки при заказе',
                      'Комиссия Bulka',
                      'Эквайринг',
                    ].map((x) => (
                      <th key={x}>{x}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {report.branches.map((b) => (
                    <tr key={b.branch_id || 'none'}>
                      <td>
                        {b.name}
                        <small>{b.city}</small>
                      </td>
                      <td>
                        {b.orders} / {b.customers}
                      </td>
                      <td>
                        {b.paid_orders} / {b.completed_orders}
                      </td>
                      <td>
                        {b.cancelled_orders} / {b.refunded_orders}
                      </td>
                      <td>{money(b.cash)}</td>
                      <td>{money(b.refunds)}</td>
                      <td>{money(b.net_cash)}</td>
                      <td>{money(b.bonuses)}</td>
                      <td>{money(b.delivery)}</td>
                      <td>{money(b.discounts)}</td>
                      <td>{money(b.commission)}</td>
                      <td>
                        {money(b.acquiring_fee)}
                        {b.unverified > 0 && <small>Без сверки: {b.unverified}</small>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.branches.length === 0 && <p>За выбранный период заказов нет.</p>}
            <p className="field-hint">
              Доставка входит в денежную оплату. Бонусы и доставка — после возвратов. Покупатели
              считаются отдельно по точкам. Несверенные комиссии могут измениться.
            </p>
          </section>
          <section className="card">
            <h2>Остатки партнёров за всё время</h2>
            <p>
              Остатки не ограничены выбранными датами. Отрицательная сумма — долг партнёра,
              уменьшающий следующие выплаты. До сверки сумма предварительная.
            </p>
            <div className="responsive-table-wrap">
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    {[
                      'Точка / партнёр',
                      'Причитается',
                      'Перечислено',
                      'Остаток',
                      'Проверка',
                      'Действие',
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
                      <td>{b.blocked > 0 ? `Требуют сверки: ${b.blocked}` : 'Сверено'}</td>
                      <td>
                        {report.canManage && (
                          <button
                            className="btn-outline"
                            disabled={busy || b.blocked > 0 || Number(b.balance) <= 0}
                            onClick={() => setBalance(b)}
                          >
                            Учесть перевод
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.balances.length === 0 && (
              <p>
                Заказов франчайзи пока нет. Собственные точки — в отчёте выше. Настройте партнёра до
                приёма его первых заказов.
              </p>
            )}
          </section>
          <section className="card">
            <h2>Заказы и сверка</h2>
            <div className="responsive-table-wrap">
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    {[
                      'Заказ / точка',
                      'Статус оплаты / заказа',
                      'Деньги / возврат',
                      'Получатель',
                      'Эквайринг',
                      'Причитается партнёру',
                      'Сверка',
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
                          {o.branch || 'Без точки'} · {o.partner || 'Bulka'}
                        </small>
                        <small>
                          {new Date(o.ordered_at).toLocaleString('ru-RU', {
                            timeZone: 'Asia/Almaty',
                          })}
                        </small>
                      </td>
                      <td>
                        {o.status} / {o.fulfillment_status}
                      </td>
                      <td>
                        {money(o.cash_amount)}
                        <small>Возврат: {money(o.cash_refunded)}</small>
                      </td>
                      <td>
                        {o.payment_recipient === 'platform' ? 'Bulka' : 'Партнёр'}
                        {!o.reconciled && <small>Не подтверждено</small>}
                      </td>
                      <td>{o.acquiring_fee === null ? 'Не указана' : money(o.acquiring_fee)}</td>
                      <td>{o.partner ? money(o.entitlement) : 'Собственная точка'}</td>
                      <td>
                        {o.branch_changed
                          ? 'Точка изменена'
                          : o.reconciled
                            ? 'Сверено'
                            : 'Не сверено'}
                        {report.canManage && ['paid', 'refunded'].includes(o.status) && (
                          <button
                            className="btn-outline"
                            disabled={busy || o.branch_changed}
                            onClick={() => setOrder(o)}
                          >
                            Сверить
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {report.orders.length === 0 && <p>Заказов нет.</p>}
            <div className="settlement-pagination">
              <button
                className="btn-outline"
                disabled={busy || offset === 0}
                onClick={() => setOffset(Math.max(0, offset - 50))}
              >
                Назад
              </button>
              <span>
                {report.totalOrders
                  ? `${offset + 1}–${Math.min(offset + 50, report.totalOrders)}`
                  : '0'}{' '}
                из {report.totalOrders}
              </span>
              <button
                className="btn-outline"
                disabled={busy || offset + 50 >= report.totalOrders}
                onClick={() => setOffset(offset + 50)}
              >
                Далее
              </button>
            </div>
          </section>
          <section className="card">
            <h2>Зафиксированные переводы за период</h2>
            <p className="field-hint">
              Последние 100 записей по дате перевода. Это учёт выполненных переводов, не команда
              банку.
            </p>
            <div className="responsive-table-wrap">
              <table className="data-table data-table-compact">
                <thead>
                  <tr>
                    <th>Дата</th>
                    <th>Точка / партнёр</th>
                    <th>Сумма</th>
                    <th>Банковский документ</th>
                  </tr>
                </thead>
                <tbody>
                  {report.payouts.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {new Date(p.paid_at).toLocaleDateString('ru-RU', {
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
            {!report.payouts.length && <p>Переводы не зарегистрированы.</p>}
          </section>
        </div>
      )}
      {order && <ReconcileOrder order={order} onClose={() => setOrder(null)} onSaved={load} />}
      {balance && (
        <RecordPayout balance={balance} onClose={() => setBalance(null)} onSaved={load} />
      )}
    </div>
  );
}

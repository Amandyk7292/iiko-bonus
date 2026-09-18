import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { loadControls } from './load-controls';
import { errorKey, type Query } from './model';

type Item = { id: string; name: string; unit: string; quantity: number; total: number };
type Check = {
  id: string;
  shift: string;
  number: number;
  date: string;
  time: string;
  department: string;
  cashier: string;
  total: number;
  items: Item[];
};
type Result = {
  shifts: { id: string; checks: number; revenue: number }[];
  checks: Check[];
  summary: { checks: number; quantity: number; revenue: number };
};

export default function CashReport({
  base,
  department,
  refresh,
}: {
  base: Query;
  department: string;
  refresh: number;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const [shift, setShift] = useState('');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [data, setData] = useState<Result>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const query = useMemo(
    () => ({
      serverId: base.serverId,
      from: base.from,
      to: base.to,
      department,
      shift,
      search: submitted,
    }),
    [base.serverId, base.from, base.to, department, shift, submitted],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadControls<Result>(query, controller.signal, '/iiko-dashboard/cash-report')
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [query, refresh]);
  return (
    <section className="card id-panel id-cash-report">
      <div className="id-report-intro">
        <div>
          <h2>Отчёт по кассе</h2>
          <p>
            Сначала выберите кассовую смену, затем найдите товар. Ниже появятся все чеки и товары,
            купленные вместе с ним.
          </p>
        </div>
        {data && (
          <div className="id-revision-totals">
            <span>
              Чеков <strong>{data.summary.checks}</strong>
            </span>
            <span>
              Продано <strong>{formatNumber(data.summary.quantity)}</strong>
            </span>
            <span>
              На сумму <strong>{formatNumber(data.summary.revenue)} ₸</strong>
            </span>
          </div>
        )}
      </div>
      <form
        className="id-report-filters"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(search.trim());
        }}
      >
        <label>
          <span>Кассовая смена</span>
          <select value={shift} onChange={(e) => setShift(e.target.value)}>
            <option value="">Выберите смену</option>
            {data?.shifts.map((item) => (
              <option key={item.id} value={item.id}>
                Смена {item.id} · {item.checks} чеков
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Товар</span>
          <div className="id-search-input">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Например, Синнабон"
            />
          </div>
        </label>
        <button type="submit" disabled={loading || !shift || !search.trim()}>
          Найти
        </button>
      </form>
      {loading && <p role="status">{t('id.loading')}</p>}
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {data && !loading && !data.checks.length && (
        <div className="id-empty">Чеки с таким товаром не найдены</div>
      )}
      <div className="id-check-list">
        {data?.checks.map((check) => (
          <details key={check.id} className="id-check-card">
            <summary>
              <div>
                <strong>Чек № {check.number || '—'}</strong>
                <span>
                  {formatDate(check.date)} · {check.time || '—'} · {check.department}
                </span>
              </div>
              <div>
                <strong>{formatNumber(check.total)} ₸</strong>
                <span>{check.items.length} позиций</span>
              </div>
              <ChevronDown size={18} />
            </summary>
            <div className="table-wrap">
              <table className="id-table">
                <thead>
                  <tr>
                    <th>Товар</th>
                    <th>Количество</th>
                    <th>Сумма</th>
                  </tr>
                </thead>
                <tbody>
                  {check.items.map((item, index) => (
                    <tr
                      className={
                        submitted &&
                        item.name
                          .toLocaleLowerCase('ru')
                          .includes(submitted.toLocaleLowerCase('ru'))
                          ? 'id-found-item'
                          : ''
                      }
                      key={`${item.id}-${index}`}
                    >
                      <td>{item.name}</td>
                      <td>
                        {formatNumber(item.quantity)} {item.unit}
                      </td>
                      <td>{formatNumber(item.total)} ₸</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        ))}
      </div>
    </section>
  );
}

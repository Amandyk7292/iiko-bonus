import { useEffect, useMemo, useState } from 'react';
import { Search, ChevronDown } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { loadControls } from './load-controls';
import { errorKey, type Query } from './model';
import './cash-report.css';

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
type Shift = {
  id: string;
  number: string;
  dateFrom: string;
  dateTo: string;
  department: string;
  register: string;
  checks: number;
  revenue: number;
};
type Result = {
  shifts: Shift[];
  checks: Check[];
  summary: { checks: number; quantity: number; revenue: number };
};

export const cashItemMatches = (name: string, search: string) =>
  Boolean(
    search.trim() && name.toLocaleLowerCase('ru').includes(search.trim().toLocaleLowerCase('ru')),
  );

type Props = {
  base: Query;
  department: string;
  refresh: number;
};

export default function CashReport(props: Props) {
  const { base, department } = props;
  // Changing scope must discard old selections before either request starts.
  return (
    <CashReportContent
      key={JSON.stringify([base.serverId, base.from, base.to, department])}
      {...props}
    />
  );
}

function CashReportContent({ base, department, refresh }: Props) {
  const { t, formatNumber, formatDate } = useI18n();
  const [shift, setShift] = useState('');
  const [search, setSearch] = useState('');
  const [submitted, setSubmitted] = useState({ text: '', attempt: 0 });
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [data, setData] = useState<Result>();
  const [loadingShifts, setLoadingShifts] = useState(true);
  const [loading, setLoading] = useState(false);
  const [shiftError, setShiftError] = useState('');
  const [error, setError] = useState('');
  const scope = useMemo(
    () => ({
      serverId: base.serverId,
      from: base.from,
      to: base.to,
      department,
    }),
    [base.serverId, base.from, base.to, department],
  );
  useEffect(() => {
    const controller = new AbortController();
    setLoadingShifts(true);
    setShiftError('');
    void loadControls<Result>(
      { ...scope, shift: '', search: '' },
      controller.signal,
      '/iiko-dashboard/cash-report',
    )
      .then((value) => {
        if (controller.signal.aborted) return;
        setShifts(value.shifts);
        setShift((current) => (value.shifts.some((item) => item.id === current) ? current : ''));
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setShiftError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingShifts(false);
      });
    return () => controller.abort();
  }, [scope, refresh]);
  useEffect(() => {
    if (!shift || !submitted.text) {
      setData(undefined);
      setLoading(false);
      setError('');
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadControls<Result>(
      { ...scope, shift, search: submitted.text },
      controller.signal,
      '/iiko-dashboard/cash-report',
    )
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
  }, [scope, shift, submitted, refresh]);
  const selectedShift = shifts.find((item) => item.id === shift);
  const shiftDate = (item: Shift) => {
    const date = (value: string) =>
      value
        ? formatDate(`${value}T00:00:00Z`, {
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            timeZone: 'UTC',
          })
        : 'Дата не указана';
    return item.dateFrom && item.dateTo && item.dateFrom !== item.dateTo
      ? `${date(item.dateFrom)} — ${date(item.dateTo)}`
      : date(item.dateFrom || item.dateTo);
  };
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
          if (!shift || !search.trim()) return;
          setData(undefined);
          setSubmitted((current) => ({ text: search.trim(), attempt: current.attempt + 1 }));
        }}
      >
        <label>
          <span>Кассовая смена</span>
          <select
            value={shift}
            disabled={loadingShifts && !shifts.length}
            onChange={(e) => {
              setShift(e.target.value);
              setData(undefined);
              setSubmitted({ text: '', attempt: 0 });
            }}
          >
            <option value="">
              {loadingShifts && !shifts.length ? 'Загружаем смены…' : 'Выберите смену'}
            </option>
            {shifts.map((item) => (
              <option key={item.id} value={item.id}>
                {shiftDate(item)} · Смена {item.number || item.id}
                {item.register ? ` · ${item.register}` : ''}
                {!department && item.department ? ` · ${item.department}` : ''}
                {` · ${item.checks} чеков`}
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
      {selectedShift && (
        <p className="id-cash-shift-meta">
          <strong>
            {shiftDate(selectedShift)} · Смена {selectedShift.number || selectedShift.id}
          </strong>
          <span>
            {[selectedShift.department, selectedShift.register].filter(Boolean).join(' · ')}
          </span>
          <span>Чеков в смене: {selectedShift.checks}</span>
        </p>
      )}
      {(loading || (loadingShifts && !shifts.length)) && <p role="status">{t('id.loading')}</p>}
      {(error || shiftError) && (
        <p className="id-error" role="alert">
          {t(error || shiftError)}
        </p>
      )}
      {!error && !shiftError && !loading && !loadingShifts && !data && (
        <div className="id-empty">
          {!shifts.length
            ? 'За выбранный период смены не найдены'
            : !shift
              ? 'Выберите смену по дате и кассе'
              : 'Введите название товара и нажмите «Найти»'}
        </div>
      )}
      {data && !error && !loading && !data.checks.length && (
        <div className="id-empty">Чеки с таким товаром в выбранной смене не найдены</div>
      )}
      <div className="id-check-list">
        {data?.checks.map((check) => (
          <details key={check.id} className="id-check-card">
            <summary>
              <div>
                <strong>Чек № {check.number || '—'}</strong>
                <span>
                  {formatDate(check.date, {
                    day: '2-digit',
                    month: '2-digit',
                    year: 'numeric',
                    timeZone: 'UTC',
                  })}{' '}
                  · {check.time?.match(/(?:T|^)(\d{2}:\d{2})/)?.[1] || check.time || '—'} ·{' '}
                  {check.department}
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
                      className={cashItemMatches(item.name, submitted.text) ? 'id-found-item' : ''}
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

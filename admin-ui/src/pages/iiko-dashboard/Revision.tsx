import { useEffect, useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { loadControls } from './load-controls';
import { errorKey, type Query } from './model';

type Row = {
  key: string;
  name: string;
  unit: string;
  opening: number;
  incoming: number;
  sold: number;
  writtenOff: number;
  expected: number;
  systemBalance: number;
};
type Result = { rows: Row[]; fetchedAt: string };

export default function Revision({
  base,
  department,
  refresh,
}: {
  base: Query;
  department: string;
  refresh: number;
}) {
  const { t, formatNumber } = useI18n();
  const [data, setData] = useState<Result>();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [onlyDifferences, setOnlyDifferences] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const storageKey = `bulka-revision:${base.serverId}:${department}:${base.to}`;
  useEffect(() => {
    try {
      setCounts(JSON.parse(localStorage.getItem(storageKey) || '{}'));
    } catch {
      setCounts({});
    }
  }, [storageKey]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadControls<Result>(
      { serverId: base.serverId, from: base.from, to: base.to, department },
      controller.signal,
      '/iiko-dashboard/revision',
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
  }, [base.serverId, base.from, base.to, department, refresh]);
  const saveCount = (key: string, value: string) => {
    const next = { ...counts, [key]: value };
    if (value === '') delete next[key];
    setCounts(next);
    localStorage.setItem(storageKey, JSON.stringify(next));
  };
  const rows = useMemo(
    () =>
      (data?.rows || [])
        .map((row) => {
          const actual = counts[row.key] === undefined ? null : Number(counts[row.key]);
          const shortage =
            actual === null || !Number.isFinite(actual) ? null : Math.max(0, row.expected - actual);
          const surplus =
            actual === null || !Number.isFinite(actual) ? null : Math.max(0, actual - row.expected);
          return { ...row, actual, shortage, surplus };
        })
        .filter(
          (row) =>
            row.name.toLocaleLowerCase('ru').includes(search.toLocaleLowerCase('ru')) &&
            (!onlyDifferences || Number(row.shortage) > 0 || Number(row.surplus) > 0),
        ),
    [data, counts, search, onlyDifferences],
  );
  const totals = rows.reduce(
    (sum, row) => ({
      shortage: sum.shortage + Number(row.shortage || 0),
      surplus: sum.surplus + Number(row.surplus || 0),
    }),
    { shortage: 0, surplus: 0 },
  );
  return (
    <section className="card id-panel id-revision">
      <div className="id-report-intro">
        <div>
          <h2>Автоматизированная ревизия</h2>
          <p>
            Расчётный остаток = начальный остаток + приход − продажи − списания. Введите фактическое
            количество после пересчёта.
          </p>
        </div>
        <div className="id-revision-totals">
          <span>
            Недостача <strong>{formatNumber(totals.shortage)}</strong>
          </span>
          <span>
            Излишек <strong>{formatNumber(totals.surplus)}</strong>
          </span>
        </div>
      </div>
      <div className="id-report-filters">
        <label>
          <span>Найти товар</span>
          <div className="id-search-input">
            <Search size={16} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Название товара"
            />
          </div>
        </label>
        <label className="id-check">
          <input
            type="checkbox"
            checked={onlyDifferences}
            onChange={(e) => setOnlyDifferences(e.target.checked)}
          />
          Только расхождения
        </label>
      </div>
      {loading && <p role="status">{t('id.loading')}</p>}
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {data && (
        <div className="table-wrap">
          <table className="id-table">
            <thead>
              <tr>
                <th>Товар</th>
                <th>Ед.</th>
                <th>Было</th>
                <th>Пришло</th>
                <th>Продано</th>
                <th>Списано</th>
                <th>По расчёту</th>
                <th>В iiko</th>
                <th>Фактически</th>
                <th>Недостача</th>
                <th>Излишек</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr className={Number(row.shortage) > 0 ? 'id-row-shortage' : ''} key={row.key}>
                  <td>
                    <strong>{row.name}</strong>
                  </td>
                  <td>{row.unit || '—'}</td>
                  {(
                    [
                      'opening',
                      'incoming',
                      'sold',
                      'writtenOff',
                      'expected',
                      'systemBalance',
                    ] as const
                  ).map((field) => (
                    <td key={field}>{formatNumber(row[field])}</td>
                  ))}
                  <td>
                    <input
                      className="id-count-input"
                      type="number"
                      step="0.001"
                      min="0"
                      aria-label={`Фактический остаток ${row.name}`}
                      value={counts[row.key] ?? ''}
                      onChange={(e) => saveCount(row.key, e.target.value)}
                      placeholder="—"
                    />
                  </td>
                  <td>{row.shortage === null ? '—' : formatNumber(row.shortage)}</td>
                  <td>{row.surplus === null ? '—' : formatNumber(row.surplus)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

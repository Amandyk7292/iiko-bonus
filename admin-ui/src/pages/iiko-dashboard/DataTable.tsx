import { useEffect, useMemo, useState } from 'react';
import { ArrowDownUp, Columns3, Search } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import type { Report } from './model';

export default function DataTable({
  report,
  onSelect,
  defaultFields,
}: {
  report: Report;
  defaultFields?: string[];
  onSelect?: (row: Record<string, unknown>) => void;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [sort, setSort] = useState({ field: '', direction: -1 });
  const [visible, setVisible] = useState<string[]>(
    () => defaultFields || Object.keys(report.columns),
  );
  const schemaKey = Object.keys(report.columns).join('|');
  useEffect(() => {
    setVisible(defaultFields || Object.keys(report.columns));
  }, [schemaKey]);
  const fields = Object.keys(report.columns).filter((field) => visible.includes(field));
  const rows = useMemo(() => {
    const result = report.rows.filter((row) =>
      Object.keys(report.columns).some((field) =>
        String(row[field] ?? '')
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
      ),
    );
    if (sort.field)
      result.sort((a, b) => {
        const av = a[sort.field];
        const bv = b[sort.field];
        return (
          (typeof av === 'number' && typeof bv === 'number'
            ? av - bv
            : String(av ?? '').localeCompare(String(bv ?? ''), undefined, { numeric: true })) *
          sort.direction
        );
      });
    return result;
  }, [report, search, sort]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(rows.length / 50) - 1));
  return (
    <section className="id-table-section">
      <div className="id-table-tools">
        <label>
          <span className="sr-only">{t('id.search')}</span>
          <Search className="id-search-icon" size={16} aria-hidden="true" />
          <input
            type="search"
            placeholder={t('id.search')}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
          />
        </label>
        <details className="id-columns">
          <summary>
            <Columns3 size={16} />
            {t('id.columns')}
          </summary>
          <div>
            {Object.entries(report.columns).map(([field, column]) => (
              <label key={field}>
                <input
                  type="checkbox"
                  checked={visible.includes(field)}
                  disabled={visible.length === 1 && visible.includes(field)}
                  onChange={(event) =>
                    setVisible(
                      event.target.checked
                        ? [...visible, field]
                        : visible.filter((key) => key !== field),
                    )
                  }
                />
                {column.name}
              </label>
            ))}
          </div>
        </details>
        <span>
          {t('id.totalRows')}: {formatNumber(rows.length)}
        </span>
      </div>
      {!rows.length ? (
        <p className="id-empty">{t('id.empty')}</p>
      ) : (
        <div className="responsive-table-wrap">
          <table className="data-table id-table">
            <thead>
              <tr>
                {fields.map((field) => (
                  <th
                    key={field}
                    aria-sort={
                      sort.field !== field
                        ? 'none'
                        : sort.direction === 1
                          ? 'ascending'
                          : 'descending'
                    }
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort({ field, direction: sort.field === field ? -sort.direction : -1 })
                      }
                    >
                      {report.columns[field].name}
                      <ArrowDownUp size={13} />
                    </button>
                  </th>
                ))}
                {onSelect && <th>{t('id.details')}</th>}
              </tr>
            </thead>
            <tbody>
              {rows.slice(currentPage * 50, (currentPage + 1) * 50).map((row, index) => (
                <tr
                  key={`${currentPage}-${index}`}
                  onClick={onSelect ? () => onSelect(row) : undefined}
                  style={onSelect ? { cursor: 'pointer' } : undefined}
                >
                  {fields.map((field) => (
                    <td key={field} data-label={report.columns[field].name} data-field={field}>
                      <span className={typeof row[field] === 'number' ? 'id-number' : undefined}>
                        {typeof row[field] === 'number'
                          ? formatNumber(row[field] as number, {
                              maximumFractionDigits: field === 'Quantity' ? 3 : 2,
                            })
                          : report.columns[field].type === 'DATE_TIME' && row[field]
                            ? formatDate(String(row[field]), {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : String(row[field] ?? '—')}
                      </span>
                    </td>
                  ))}
                  {onSelect && (
                    <td data-label={t('id.details')}>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onSelect(row);
                        }}
                      >
                        {t('id.details')}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows.length > 50 && (
        <div className="id-pagination">
          <button
            type="button"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            {t('id.back')}
          </button>
          <span>
            {currentPage + 1} / {Math.ceil(rows.length / 50)}
          </span>
          <button
            type="button"
            disabled={(currentPage + 1) * 50 >= rows.length}
            onClick={() => setPage(currentPage + 1)}
          >
            {t('id.next')}
          </button>
        </div>
      )}
    </section>
  );
}

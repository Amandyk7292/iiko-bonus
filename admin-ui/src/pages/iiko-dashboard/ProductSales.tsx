import { useEffect, useId, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { useI18n } from '../../lib/i18n';
import { dashboardApi, exportProductSales } from './api';
import { loadControls } from './load-controls';
import {
  errorKey,
  validRange,
  type ProductChoice,
  type ProductSalesQuery,
  type ProductSalesResult,
} from './model';
import './product-sales.css';

export default function ProductSales({
  serverId,
  from,
  to,
  department,
  configured,
  refresh,
}: {
  serverId: string;
  from: string;
  to: string;
  department: string;
  configured: boolean;
  refresh: number;
}) {
  const { t, formatDate, formatNumber } = useI18n();
  const inputId = useId();
  const listId = `${inputId}-suggestions`;
  const [search, setSearch] = useState('');
  const [product, setProduct] = useState<ProductChoice>();
  const [suggestions, setSuggestions] = useState<ProductChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [submitted, setSubmitted] = useState<ProductSalesQuery>();
  const [attempt, setAttempt] = useState(0);
  const [report, setReport] = useState<ProductSalesResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const periodValid = validRange(from, to);
  const current = product ? { serverId, from, to, department, productId: product.id } : undefined;
  const isCurrent = submitted && current && JSON.stringify(submitted) === JSON.stringify(current);
  const visibleReport = isCurrent ? report : undefined;
  const visibleOptions = suggestions.slice(0, 40);

  useEffect(() => {
    setProduct(undefined);
    setSearch('');
    setSuggestions([]);
    setSearchError(false);
    setOpen(false);
    setSubmitted(undefined);
    setReport(undefined);
  }, [serverId]);

  useEffect(() => {
    if (!configured || product || search.trim().length < 2) {
      setSearching(false);
      setSuggestions([]);
      return;
    }
    const controller = new AbortController();
    setSearching(true);
    const timer = window.setTimeout(() => {
      setSearchError(false);
      void dashboardApi
        .productSearch(serverId, search.trim(), controller.signal)
        .then((result) => {
          if (!controller.signal.aborted) {
            setSuggestions(result.products);
            setActive(-1);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setSearchError(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [serverId, configured, search, product, searchAttempt]);

  useEffect(() => {
    if (!submitted || !isCurrent || !configured || !periodValid) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void loadControls<ProductSalesResult>(
      submitted,
      controller.signal,
      '/iiko-dashboard/product-sales',
    )
      .then((result) => {
        if (!controller.signal.aborted) setReport(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [
    submitted,
    attempt,
    refresh,
    serverId,
    from,
    to,
    department,
    product?.id,
    configured,
    periodValid,
  ]);

  const selectProduct = (value: ProductChoice) => {
    setProduct(value);
    setSearch(value.name);
    setOpen(false);
    setActive(-1);
    setReport(undefined);
    setSubmitted(undefined);
  };
  const dateLabel = (value: string) =>
    formatDate(`${value}T00:00:00Z`, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const money = (value: number) => formatNumber(value);
  const show = () => {
    if (!current || !configured || !periodValid) return;
    setReport(undefined);
    setSubmitted(current);
    setAttempt((value) => value + 1);
  };

  return (
    <section className="card id-panel id-product-sales">
      <div className="id-product-sales-heading">
        <div>
          <h2>{t('id.productSales')}</h2>
          <p className="id-muted">{t('id.productSalesHint')}</p>
        </div>
        <button
          type="button"
          disabled={!visibleReport || loading || exporting}
          onClick={() => {
            if (!submitted) return;
            setExporting(true);
            void exportProductSales(submitted)
              .catch((caught) => setError(errorKey(caught)))
              .finally(() => setExporting(false));
          }}
        >
          <Download size={17} />
          {t('id.productSalesExport')}
        </button>
      </div>
      <div className="id-product-sales-form">
        <div
          className="id-product-sales-lookup"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <label htmlFor={inputId}>{t('id.productSalesSearch')}</label>
          <div className="id-product-sales-input">
            <Search size={17} aria-hidden="true" />
            <input
              id={inputId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={open && search.trim().length >= 2}
              aria-controls={open ? listId : undefined}
              aria-activedescendant={
                open && active >= 0 ? `${inputId}-option-${active}` : undefined
              }
              autoComplete="off"
              disabled={!configured}
              maxLength={160}
              value={search}
              placeholder={t('id.productSalesPlaceholder')}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setSearch(event.target.value);
                setProduct(undefined);
                setSuggestions([]);
                setSubmitted(undefined);
                setReport(undefined);
                setOpen(true);
                setActive(-1);
              }}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing) return;
                if (event.key === 'Escape') {
                  setOpen(false);
                  setActive(-1);
                } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault();
                  setOpen(true);
                  if (visibleOptions.length) {
                    setActive((currentIndex) =>
                      currentIndex < 0
                        ? event.key === 'ArrowDown'
                          ? 0
                          : visibleOptions.length - 1
                        : (currentIndex +
                            (event.key === 'ArrowDown' ? 1 : -1) +
                            visibleOptions.length) %
                          visibleOptions.length,
                    );
                  }
                } else if (event.key === 'Enter' && open && active >= 0) {
                  event.preventDefault();
                  selectProduct(visibleOptions[active]);
                }
              }}
            />
          </div>
          {open && search.trim().length >= 2 && !product && (
            <div className="id-product-sales-suggestions">
              {searching && <p role="status">{t('id.loading')}</p>}
              {searchError && (
                <p role="alert">
                  {t('id.productSalesSearchError')}{' '}
                  <button type="button" onClick={() => setSearchAttempt((value) => value + 1)}>
                    {t('id.refresh')}
                  </button>
                </p>
              )}
              {!searching && !searchError && visibleOptions.length === 0 && (
                <p role="status">{t('id.productSalesNotFound')}</p>
              )}
              <ul role="listbox" id={listId} aria-label={t('id.productSalesSearch')}>
                {visibleOptions.map((option, index) => (
                  <li key={option.id} role="presentation">
                    <button
                      id={`${inputId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === active}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => selectProduct(option)}
                    >
                      {option.name}
                      {option.archived && <small>{t('id.productSalesArchived')}</small>}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={!current || !configured || !periodValid || loading}
          onClick={show}
        >
          {t('id.productSalesShow')}
        </button>
      </div>
      {!configured && (
        <p className="id-error" role="alert">
          {t('id.notConfigured')}
        </p>
      )}
      {configured && !periodValid && (
        <p className="id-error" role="alert">
          {t('id.range')}
        </p>
      )}
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {loading && (
        <p className="id-muted" role="status">
          {t('id.productSalesLoading')}
        </p>
      )}
      {!loading && !visibleReport && !error && (
        <p className="id-product-sales-start">{t('id.productSalesEmpty')}</p>
      )}
      {visibleReport && (
        <>
          <div className="id-product-sales-metrics">
            <div>
              <span>{t('id.productSalesSold')}</span>
              <strong>
                {formatNumber(visibleReport.summary.quantity)}
                {visibleReport.unit ? ` ${visibleReport.unit}` : ''}
              </strong>
            </div>
            <div>
              <span>{t('id.productSalesRevenue')}</span>
              <strong>{money(visibleReport.summary.net)} ₸</strong>
            </div>
            <div>
              <span>{t('id.beforeDiscount')}</span>
              <strong>{money(visibleReport.summary.gross)} ₸</strong>
            </div>
          </div>
          {visibleReport.summary.quantity === 0 && (
            <p className="id-muted">{t('id.productSalesNoSales')}</p>
          )}
          <div
            className={`id-product-sales-tables${visibleReport.selectedDepartment ? ' single' : ''}`}
          >
            <div>
              <h3>{t('id.productSalesDaily')}</h3>
              <div className="id-product-sales-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>{t('id.period')}</th>
                      <th>{t('id.productSalesSold')}</th>
                      <th>{t('id.productSalesRevenue')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleReport.daily.map((row) => (
                      <tr key={row.date}>
                        <td>{dateLabel(row.date)}</td>
                        <td>{formatNumber(row.quantity)}</td>
                        <td>{money(row.net)} ₸</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            {!visibleReport.selectedDepartment && (
              <div>
                <h3>{t('id.productSalesPoints')}</h3>
                <div className="id-product-sales-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>{t('id.point')}</th>
                        <th>{t('id.productSalesSold')}</th>
                        <th>{t('id.productSalesRevenue')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleReport.byDepartment.map((row) => (
                        <tr key={row.department}>
                          <td>{row.department}</td>
                          <td>{formatNumber(row.quantity)}</td>
                          <td>{money(row.net)} ₸</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
          <p className="id-muted id-product-sales-note">
            {t('id.productSalesDateNote')} {t('id.updated')}:{' '}
            {formatDate(visibleReport.fetchedAt, {
              day: '2-digit',
              month: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </>
      )}
    </section>
  );
}

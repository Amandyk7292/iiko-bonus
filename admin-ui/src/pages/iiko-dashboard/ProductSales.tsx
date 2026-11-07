import { useEffect, useId, useState } from 'react';
import { Check, ChevronDown, Download, Search, X } from '../../components/BulkaIcons';
import { useI18n } from '../../lib/i18n';
import { dashboardApi, exportProductSales } from './api';
import { loadControls } from './load-controls';
import {
  errorKey,
  validRange,
  type CombinedSalesTotals,
  type ProductChoice,
  type ProductSalesExportView,
  type ProductSalesQuery,
  type ProductSalesResult,
} from './model';
import { productSalesCopy } from './product-sales-copy';
import './product-sales.css';

const maxProducts = 40;

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
  const { t, locale, formatDate, formatNumber } = useI18n();
  const copy = productSalesCopy[locale];
  const inputId = useId();
  const listId = `${inputId}-suggestions`;
  const exportOptionsId = `${inputId}-export-options`;
  const [search, setSearch] = useState('');
  const [products, setProducts] = useState<ProductChoice[]>([]);
  const [suggestions, setSuggestions] = useState<ProductChoice[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const [searchAttempt, setSearchAttempt] = useState(0);
  const [submitted, setSubmitted] = useState<ProductSalesQuery>();
  const [report, setReport] = useState<ProductSalesResult>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const periodValid = validRange(from, to);
  const scope = { serverId, from, to, department };
  const current: ProductSalesQuery | undefined =
    products.length === 1
      ? { ...scope, productId: products[0].id }
      : products.length > 1
        ? { ...scope, productIds: products.map(({ id }) => id).sort() }
        : undefined;
  const isCurrent = Boolean(
    submitted && current && JSON.stringify(submitted) === JSON.stringify(current),
  );
  const visibleReport = isCurrent ? report : undefined;
  const selectedIds = new Set(products.map(({ id }) => id));
  const visibleOptions =
    products.length >= maxProducts
      ? suggestions.filter(({ id }) => selectedIds.has(id))
      : suggestions;
  const suggestionsOpen = open && search.trim().length >= 2;

  useEffect(() => {
    if (!visibleReport) setExportOpen(false);
  }, [visibleReport]);

  useEffect(() => {
    setProducts([]);
    setSearch('');
    setSuggestions([]);
    setSearchError(false);
    setOpen(false);
    setSubmitted(undefined);
    setReport(undefined);
    setError('');
  }, [serverId]);

  useEffect(() => {
    if (!configured || search.trim().length < 2) {
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
  }, [serverId, configured, search, searchAttempt]);

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
  }, [submitted, isCurrent, refresh, configured, periodValid]);

  const toggleProduct = (value: ProductChoice) => {
    setProducts((selected) => {
      if (selected.some(({ id }) => id === value.id))
        return selected.filter(({ id }) => id !== value.id);
      return selected.length < maxProducts ? [...selected, value] : selected;
    });
    setActive(-1);
    setReport(undefined);
    setSubmitted(undefined);
    setError('');
  };
  const dateLabel = (value: string) =>
    formatDate(`${value}T00:00:00Z`, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      timeZone: 'UTC',
    });
  const money = (value: number) => formatNumber(value);
  const quantity = (row: CombinedSalesTotals | { quantity: number }, unit = '') => {
    if ('quantity' in row) return `${formatNumber(row.quantity)}${unit ? ` ${unit}` : ''}`;
    return (
      row.quantities
        .map((entry) => `${formatNumber(entry.quantity)} ${entry.unit || copy.unknownUnit}`)
        .join(' · ') || formatNumber(0)
    );
  };
  const show = () => {
    if (!current || !configured || !periodValid) return;
    setOpen(false);
    setReport(undefined);
    setSubmitted(current);
  };
  const exportView = (view: ProductSalesExportView) => {
    if (!submitted || !visibleReport) return;
    setExportOpen(false);
    setExporting(true);
    void exportProductSales(submitted, view)
      .catch((caught) => setError(errorKey(caught)))
      .finally(() => setExporting(false));
  };
  const combined = visibleReport && 'products' in visibleReport ? visibleReport : undefined;
  function salesTable(
    title: string,
    label: string,
    rows: { key: string; name: string; sold: string; net: number }[],
  ) {
    return (
      <div>
        <h3>{title}</h3>
        <div className="id-product-sales-table-wrap">
          <table>
            <thead>
              <tr>
                <th>{label}</th>
                <th>{t('id.productSalesSold')}</th>
                <th>{t('id.productSalesRevenue')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ key, name, sold, net }) => (
                <tr key={key}>
                  <td>{name}</td>
                  <td>{sold}</td>
                  <td>{money(net)} ₸</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <section className="card id-panel id-product-sales">
      <div className="id-product-sales-heading">
        <div>
          <h2>{t('id.productSales')}</h2>
          <p className="id-muted">{copy.hint}</p>
        </div>
        <div
          className="id-product-sales-export"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null))
              setExportOpen(false);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setExportOpen(false);
          }}
        >
          <button
            type="button"
            aria-expanded={exportOpen}
            aria-controls={exportOpen ? exportOptionsId : undefined}
            disabled={!visibleReport || loading || exporting}
            onClick={() => setExportOpen((open) => !open)}
          >
            <Download size={17} />
            {copy.export}
            <ChevronDown size={15} aria-hidden="true" />
          </button>
          {exportOpen && (
            <div
              className="id-product-sales-export-options"
              id={exportOptionsId}
              role="group"
              aria-label={copy.exportOptions}
            >
              {combined ? (
                <button type="button" onClick={() => exportView('full')}>
                  {copy.full}
                </button>
              ) : (
                <>
                  <button type="button" onClick={() => exportView('daily')}>
                    {copy.exportByDay}
                  </button>
                  <button type="button" onClick={() => exportView('points')}>
                    {copy.exportByPoint}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      <div className="id-product-sales-form">
        <div
          className="id-product-sales-lookup"
          onBlur={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
          }}
        >
          <div className="id-product-sales-lookup-label">
            <label htmlFor={inputId}>{copy.search}</label>
            {products.length > 0 && (
              <span className="id-muted" role="status">
                {copy.selected} {products.length}
                {products.length === maxProducts && ` / ${maxProducts}`}
              </span>
            )}
          </div>
          <div className="id-product-sales-input">
            <Search size={17} aria-hidden="true" />
            <input
              id={inputId}
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={suggestionsOpen}
              aria-controls={suggestionsOpen ? listId : undefined}
              aria-activedescendant={
                suggestionsOpen && active >= 0 ? `${inputId}-option-${active}` : undefined
              }
              autoComplete="off"
              disabled={!configured}
              maxLength={160}
              value={search}
              placeholder={copy.placeholder}
              onFocus={() => setOpen(true)}
              onChange={(event) => {
                setSearch(event.target.value);
                setSuggestions([]);
                setSearchError(false);
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
                } else if (event.key === 'Enter' && suggestionsOpen && visibleOptions[active]) {
                  event.preventDefault();
                  toggleProduct(visibleOptions[active]);
                }
              }}
            />
          </div>
          {suggestionsOpen && (
            <div className="id-product-sales-suggestions">
              {searching && <p role="status">{t('id.loading')}</p>}
              {searchError && (
                <p role="alert">
                  {copy.searchError}{' '}
                  <button type="button" onClick={() => setSearchAttempt((value) => value + 1)}>
                    {t('id.refresh')}
                  </button>
                </p>
              )}
              {!searching && !searchError && suggestions.length === 0 && (
                <p role="status">{copy.notFound}</p>
              )}
              <ul role="listbox" id={listId} aria-label={copy.search} aria-multiselectable="true">
                {visibleOptions.map((option, index) => (
                  <li key={option.id} role="presentation">
                    <button
                      id={`${inputId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={selectedIds.has(option.id)}
                      data-active={index === active || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => toggleProduct(option)}
                    >
                      {option.name}
                      {option.archived && <small>{copy.archived}</small>}
                      {selectedIds.has(option.id) && <Check size={16} aria-hidden="true" />}
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
          {copy.show}
        </button>
      </div>
      {products.length > 0 && (
        <div className="id-product-sales-selection">
          <ul>
            {products.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => toggleProduct(item)}
                  aria-label={`${copy.remove} ${item.name}`}
                >
                  <span>{item.name}</span>
                  <X size={14} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
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
          {copy.loading}
        </p>
      )}
      {!loading && !visibleReport && !error && (
        <p className="id-product-sales-start">{copy.empty}</p>
      )}
      {visibleReport && (
        <>
          <div className="id-product-sales-metrics">
            <div>
              <span>{t('id.productSalesSold')}</span>
              <strong>
                {quantity(visibleReport.summary, 'unit' in visibleReport ? visibleReport.unit : '')}
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
          {!visibleReport.rows.some((row) => row.quantity || row.net || row.gross) && (
            <p className="id-muted">{copy.noSales}</p>
          )}
          {combined && (
            <div className="id-product-sales-tables single id-product-sales-by-product">
              {salesTable(
                copy.byProduct,
                copy.search,
                combined.byProduct.map((row) => ({
                  key: row.product.id,
                  name: row.product.name,
                  sold: quantity(row),
                  net: row.net,
                })),
              )}
            </div>
          )}
          <div
            className={`id-product-sales-tables${visibleReport.selectedDepartment ? ' single' : ''}`}
          >
            {salesTable(
              t('id.productSalesDaily'),
              t('id.period'),
              visibleReport.daily.map((row) => ({
                key: row.date,
                name: dateLabel(row.date),
                sold: quantity(row),
                net: row.net,
              })),
            )}
            {!visibleReport.selectedDepartment &&
              salesTable(
                t('id.productSalesPoints'),
                t('id.point'),
                visibleReport.byDepartment.map((row) => ({
                  key: row.department,
                  name: row.department,
                  sold: quantity(row),
                  net: row.net,
                })),
              )}
          </div>
          <p className="id-muted id-product-sales-note">
            {copy.dateNote} {t('id.updated')}:{' '}
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

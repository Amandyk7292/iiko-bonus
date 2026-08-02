import {
  ArrowLeft,
  ArrowRight,
  Clock3,
  CreditCard,
  Headphones,
  History,
  PackageSearch,
  ReceiptText,
  Search,
  ShieldCheck,
  UserRound,
} from 'lucide-react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { api, type AdminGlobalDetail, type AdminGlobalEntityType } from '../lib/api';
import { Link, useSearchParams } from '../lib/router';
import { useI18n } from '../lib/i18n';
import Modal from './Modal';
import PageState from './PageState';

const SEARCH_PARAM = 'globalSearch';
const ENTITY_PARAM = 'globalEntity';
const SUPPORTED_TYPES = new Set<AdminGlobalEntityType>(['order', 'customer', 'support']);

const typeIcons = {
  order: PackageSearch,
  customer: UserRound,
  support: Headphones,
} satisfies Record<AdminGlobalEntityType, typeof Search>;

const timelineIcons: Record<string, typeof Search> = {
  order: PackageSearch,
  payment: CreditCard,
  refund: ReceiptText,
  support: Headphones,
  audit: ShieldCheck,
  customer: UserRound,
};

export function parseAdminGlobalEntity(value: string | null) {
  if (!value) return null;
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const type = value.slice(0, separator) as AdminGlobalEntityType;
  const id = value.slice(separator + 1).trim();
  return SUPPORTED_TYPES.has(type) && id ? { type, id } : null;
}

const humanizeStatus = (value?: string | null) =>
  value ? value.replaceAll('_', ' ').replace(/^./, (character) => character.toUpperCase()) : '—';

const valueOrDash = (value?: string | number | null) =>
  value === null || value === undefined || value === '' ? '—' : String(value);

function workspacePath(detail: AdminGlobalDetail) {
  if (detail.type === 'order') {
    return `/orders?search=${encodeURIComponent(String(detail.order?.number || detail.id))}`;
  }
  if (detail.type === 'customer') {
    return `/customers?search=${encodeURIComponent(
      String(detail.customerProfile?.phone || detail.customer?.phone || detail.id),
    )}`;
  }
  return `/support?request=${encodeURIComponent(detail.id)}`;
}

export default function AdminGlobalSearch() {
  const { t, formatDate, formatNumber } = useI18n();
  const [params, setParams] = useSearchParams();
  const entity = parseAdminGlobalEntity(params.get(ENTITY_PARAM));
  const searchOpen = params.has(SEARCH_PARAM) && !entity;
  const modalOpen = searchOpen || Boolean(entity);
  const urlQuery = params.get(SEARCH_PARAM) || '';
  const [query, setQuery] = useState(urlQuery);
  const [results, setResults] = useState<Awaited<ReturnType<typeof api.globalSearch>>['results']>(
    [],
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchRetry, setSearchRetry] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);
  const [detail, setDetail] = useState<AdminGlobalDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [detailRetry, setDetailRetry] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const previousSearchOpen = useRef(false);

  const setGlobalParams = useCallback(
    (
      update: (next: URLSearchParams) => void,
      options: { replace?: boolean } = { replace: true },
    ) => {
      const next = new URLSearchParams(params);
      update(next);
      setParams(next, options);
    },
    [params, setParams],
  );

  const openSearch = useCallback(() => {
    if (searchOpen) {
      inputRef.current?.focus();
      return;
    }
    if (!params.has(SEARCH_PARAM)) setQuery('');
    setGlobalParams(
      (next) => {
        next.delete(ENTITY_PARAM);
        if (!next.has(SEARCH_PARAM)) next.set(SEARCH_PARAM, '');
      },
      { replace: false },
    );
  }, [params, searchOpen, setGlobalParams]);

  const closeAll = useCallback(() => {
    setGlobalParams((next) => {
      next.delete(SEARCH_PARAM);
      next.delete(ENTITY_PARAM);
    });
  }, [setGlobalParams]);

  const backToResults = useCallback(() => {
    setGlobalParams((next) => next.delete(ENTITY_PARAM));
  }, [setGlobalParams]);

  const openDetail = useCallback(
    (type: AdminGlobalEntityType, id: string) => {
      setGlobalParams(
        (next) => next.set(ENTITY_PARAM, `${type}:${id}`),
        { replace: false },
      );
    },
    [setGlobalParams],
  );

  useEffect(() => {
    const onShortcut = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.repeat ||
        event.altKey ||
        !(event.ctrlKey || event.metaKey) ||
        event.key.toLocaleLowerCase() !== 'k'
      ) {
        return;
      }
      event.preventDefault();
      openSearch();
    };
    document.addEventListener('keydown', onShortcut);
    return () => document.removeEventListener('keydown', onShortcut);
  }, [openSearch]);

  useEffect(() => {
    if (searchOpen && !previousSearchOpen.current) {
      setQuery(urlQuery);
      const focusTimer = window.setTimeout(() => inputRef.current?.focus(), 20);
      previousSearchOpen.current = searchOpen;
      return () => window.clearTimeout(focusTimer);
    }
    previousSearchOpen.current = searchOpen;
    return undefined;
  }, [searchOpen, urlQuery]);

  useEffect(() => {
    if (!searchOpen || query === urlQuery) return;
    const timer = window.setTimeout(() => {
      setGlobalParams((next) => next.set(SEARCH_PARAM, query));
    }, 120);
    return () => window.clearTimeout(timer);
  }, [query, searchOpen, setGlobalParams, urlQuery]);

  useEffect(() => {
    if (!searchOpen) return;
    const normalized = query.trim();
    setSearchError('');
    if (normalized.length < 2) {
      setSearchLoading(false);
      setResults([]);
      return;
    }

    const controller = new AbortController();
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await api.globalSearch(normalized, 20, controller.signal);
        if (controller.signal.aborted) return;
        setResults(
          (response.results || []).filter((result) =>
            SUPPORTED_TYPES.has(result.type as AdminGlobalEntityType),
          ),
        );
      } catch (caught) {
        if (controller.signal.aborted) return;
        setResults([]);
        setSearchError(caught instanceof Error ? caught.message : t('common.loadError'));
      } finally {
        if (!controller.signal.aborted) setSearchLoading(false);
      }
    }, 240);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchOpen, searchRetry, t]);

  useEffect(() => {
    setActiveIndex((current) => Math.max(0, Math.min(current, results.length - 1)));
  }, [results]);

  useEffect(() => {
    if (!entity) {
      setDetail(null);
      setDetailError('');
      setDetailLoading(false);
      return;
    }
    const controller = new AbortController();
    setDetail(null);
    setDetailError('');
    setDetailLoading(true);
    api
      .getGlobalSearchDetail(entity.type, entity.id, controller.signal)
      .then((response) => {
        if (!controller.signal.aborted) setDetail(response.detail);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) {
          setDetailError(caught instanceof Error ? caught.message : t('common.loadError'));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setDetailLoading(false);
      });
    return () => controller.abort();
  }, [detailRetry, entity?.id, entity?.type, t]);

  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!results.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[activeIndex];
      if (result && SUPPORTED_TYPES.has(result.type)) openDetail(result.type, result.id);
    }
  };

  const detailFields = useMemo(() => {
    if (!detail) return [];
    if (detail.order) {
      return [
        [t('orders.number'), `№${detail.order.number}`],
        [t('common.status'), humanizeStatus(detail.order.orderStatus)],
        [t('orders.payment'), humanizeStatus(detail.order.paymentStatus)],
        [t('orders.total'), `${formatNumber(detail.order.amount)} ₸`],
        [t('analytics.branch'), detail.order.branch || detail.branch],
        [t('orders.customer'), detail.order.customer?.name || detail.customer?.name],
        [t('transactions.phone'), detail.order.customer?.phone || detail.customer?.phone],
        [t('common.date'), formatDate(detail.order.createdAt)],
      ];
    }
    if (detail.customerProfile) {
      return [
        [t('common.name'), detail.customerProfile.name || detail.customer?.name],
        [t('transactions.phone'), detail.customerProfile.phone || detail.customer?.phone],
        [
          t('customers.balance'),
          `${formatNumber(Number(detail.customerProfile.balance || 0))}`,
        ],
        [
          t('customers.purchases'),
          `${formatNumber(Number(detail.customerProfile.totalSpent || 0))} ₸`,
        ],
        [t('analytics.branch'), detail.branch],
      ];
    }
    if (detail.support) {
      return [
        [t('common.status'), humanizeStatus(detail.support.status)],
        [t('globalSearch.priority'), humanizeStatus(detail.support.priority)],
        [t('globalSearch.category'), humanizeStatus(detail.support.category)],
        [t('globalSearch.assigned'), detail.support.assignedTo],
        [
          t('globalSearch.dueAt'),
          detail.support.dueAt ? formatDate(detail.support.dueAt) : null,
        ],
        [
          t('orders.number'),
          detail.support.orderNumber ? `№${detail.support.orderNumber}` : null,
        ],
        [t('analytics.branch'), detail.support.branch || detail.branch],
      ];
    }
    return [
      [t('common.status'), humanizeStatus(detail.status)],
      [t('analytics.branch'), detail.branch],
      [t('orders.customer'), detail.customer?.name],
      [t('transactions.phone'), detail.customer?.phone],
    ];
  }, [detail, formatDate, formatNumber, t]);

  const timeline = useMemo(
    () =>
      [...(detail?.timeline || [])].sort(
        (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt),
      ),
    [detail?.timeline],
  );

  const title = entity ? detail?.title || t('globalSearch.details') : t('globalSearch.title');
  const description = entity
    ? detail?.subtitle || t(`globalSearch.type.${entity.type}`)
    : t('globalSearch.description');

  return (
    <>
      <button
        type="button"
        className="global-search-trigger"
        onClick={openSearch}
        aria-label={`${t('globalSearch.trigger')} (${t('globalSearch.shortcut')})`}
        aria-haspopup="dialog"
        aria-expanded={modalOpen}
      >
        <Search aria-hidden="true" size={18} />
        <span>{t('globalSearch.trigger')}</span>
        <kbd>{t('globalSearch.shortcut')}</kbd>
      </button>

      <Modal open={modalOpen} onClose={closeAll} title={title} description={description} size="lg">
        {entity ? (
          <div className="modal-body global-detail-body">
            {params.has(SEARCH_PARAM) && (
              <button
                type="button"
                className="global-detail-back"
                onClick={backToResults}
              >
                <ArrowLeft aria-hidden="true" size={17} />
                {t('globalSearch.back')}
              </button>
            )}

            {detailLoading ? (
              <PageState compact type="loading" title={t('globalSearch.loading')} />
            ) : detailError ? (
              <PageState
                compact
                type="error"
                description={detailError}
                onRetry={() => setDetailRetry((value) => value + 1)}
              />
            ) : detail ? (
              <>
                <section className="global-detail-summary" aria-labelledby="global-detail-summary">
                  <div className="global-detail-section-heading">
                    <h3 id="global-detail-summary">{t('globalSearch.summary')}</h3>
                    <Link className="text-button" to={workspacePath(detail)}>
                      {t('globalSearch.openWorkspace')}
                      <ArrowRight aria-hidden="true" size={16} />
                    </Link>
                  </div>
                  <dl>
                    {detailFields
                      .filter(([, value]) => value !== null && value !== undefined && value !== '')
                      .map(([label, value]) => (
                        <div key={String(label)}>
                          <dt>{label}</dt>
                          <dd>{valueOrDash(value)}</dd>
                        </div>
                      ))}
                  </dl>
                </section>

                <section className="global-detail-timeline" aria-labelledby="global-detail-timeline">
                  <div className="global-detail-section-heading">
                    <h3 id="global-detail-timeline">
                      <History aria-hidden="true" size={19} />
                      {t('globalSearch.timeline')}
                    </h3>
                  </div>
                  {timeline.length ? (
                    <ol>
                      {timeline.map((event) => {
                        const TimelineIcon = timelineIcons[event.kind] || Clock3;
                        return (
                          <li key={event.id}>
                            <span className={`global-timeline-icon kind-${event.kind}`}>
                              <TimelineIcon aria-hidden="true" size={17} />
                            </span>
                            <div className="global-timeline-copy">
                              <div>
                                <strong>{event.title}</strong>
                                <time dateTime={event.occurredAt}>
                                  {formatDate(event.occurredAt)}
                                </time>
                              </div>
                              {event.description && <p>{event.description}</p>}
                              <footer>
                                {event.status && (
                                  <span className="status-pill status-info">
                                    {humanizeStatus(event.status)}
                                  </span>
                                )}
                                {event.actor && <span>{event.actor}</span>}
                                {event.requestId && (
                                  <code>
                                    {t('security.requestId')}: {event.requestId}
                                  </code>
                                )}
                              </footer>
                            </div>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <p className="global-timeline-empty">{t('globalSearch.timelineEmpty')}</p>
                  )}
                </section>
              </>
            ) : (
              <PageState compact type="empty" title={t('common.noData')} />
            )}
          </div>
        ) : (
          <div className="modal-body global-search-body">
            <div className="global-search-field">
              <label htmlFor="admin-global-search">{t('globalSearch.inputLabel')}</label>
              <div className="input-with-icon">
                <Search aria-hidden="true" size={19} />
                <input
                  ref={inputRef}
                  id="admin-global-search"
                  name="adminGlobalSearch"
                  className="input-classic"
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder={t('globalSearch.placeholder')}
                  autoComplete="off"
                  spellCheck={false}
                  autoFocus
                  aria-controls="admin-global-search-results"
                  aria-activedescendant={
                    results[activeIndex] ? `admin-global-search-result-${activeIndex}` : undefined
                  }
                />
              </div>
              <p>{t('globalSearch.hint')}</p>
            </div>

            <div
              id="admin-global-search-results"
              className="global-search-results"
              aria-live="polite"
              aria-busy={searchLoading}
            >
              {query.trim().length < 2 ? (
                <p className="global-search-minimum">
                  <Search aria-hidden="true" size={22} />
                  {query.trim() ? t('globalSearch.minimum') : t('globalSearch.inputLabel')}
                </p>
              ) : searchLoading ? (
                <PageState compact type="loading" title={t('globalSearch.loading')} />
              ) : searchError ? (
                <PageState
                  compact
                  type="error"
                  description={searchError}
                  onRetry={() => setSearchRetry((value) => value + 1)}
                />
              ) : results.length ? (
                <ul aria-label={t('globalSearch.title')}>
                  {results.map((result, index) => {
                    const ResultIcon = typeIcons[result.type];
                    return (
                      <li key={`${result.type}:${result.id}`}>
                        <button
                          id={`admin-global-search-result-${index}`}
                          type="button"
                          className={`global-search-result ${index === activeIndex ? 'is-active' : ''}`}
                          onMouseEnter={() => setActiveIndex(index)}
                          onFocus={() => setActiveIndex(index)}
                          onClick={() => openDetail(result.type, result.id)}
                        >
                          <span className={`global-search-result-icon type-${result.type}`}>
                            <ResultIcon aria-hidden="true" size={19} />
                          </span>
                          <span className="global-search-result-copy">
                            <span>
                              <strong>{result.title}</strong>
                              <small>{t(`globalSearch.type.${result.type}`)}</small>
                            </span>
                            {result.subtitle && <p>{result.subtitle}</p>}
                            <span className="global-search-result-meta">
                              {result.status && <span>{humanizeStatus(result.status)}</span>}
                              {result.branch && <span>{result.branch}</span>}
                              {result.updatedAt && <time>{formatDate(result.updatedAt)}</time>}
                            </span>
                          </span>
                          <ArrowRight aria-hidden="true" size={17} />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <PageState
                  compact
                  type="empty"
                  title={t('globalSearch.empty')}
                  description={t('globalSearch.emptyHint')}
                />
              )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}

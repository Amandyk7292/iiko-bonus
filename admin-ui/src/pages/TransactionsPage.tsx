import { Fragment, useCallback, useEffect, useState } from 'react';
import { ChevronDown, Download, Gift, RefreshCw, Search } from 'lucide-react';
import { Link, useSearchParams } from '../lib/router';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { api } from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';

const transactionTypeKeys: Record<string, string> = {
  deposit: 'transaction.deposit',
  pending_deposit: 'transaction.pending_deposit',
  withdrawal: 'transaction.withdrawal',
  manual_deposit: 'transaction.manual_deposit',
  manual_withdrawal: 'transaction.manual_withdrawal',
  manual: 'transaction.manual',
  expiration: 'transaction.expiration',
  refund_reversal: 'transaction.refund_reversal',
  refund_bonus_restore: 'transaction.refund_bonus_restore',
  cancelled_deposit: 'transaction.cancelled_deposit',
  order: 'transaction.order',
};

const csvCell = (value: unknown) => `"${String(value ?? '').replace(/"/g, '""')}"`;

export default function TransactionsPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get('page')) || 1);
  const dateFrom = params.get('from') || '';
  const dateTo = params.get('to') || '';
  const type = params.get('type') || '';
  const [search, setSearch] = useState(params.get('search') || '');
  const [transactions, setTransactions] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const pageSize = 50;

  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, String(value));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = search.trim();
      const next = new URLSearchParams(window.location.search);
      if (value) next.set('search', value);
      else next.delete('search');
      next.delete('page');
      setParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, setParams]);

  const fetchTransactions = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      setError('');
      try {
        const response = await api.getTransactions({
          page,
          pageSize,
          search: params.get('search') || '',
          dateFrom,
          dateTo,
          type,
        });
        if (Array.isArray(response)) {
          setTransactions(response);
          setTotal(response.length);
        } else {
          setTransactions(response.transactions ?? []);
          setTotal(response.total ?? 0);
        }
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : t('common.loadError'));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [dateFrom, dateTo, page, params, t, type],
  );

  useEffect(() => {
    void fetchTransactions();
  }, [fetchTransactions]);

  useAdminRealtimeEvents(
    ['transaction.created', 'loyalty.balance.updated', 'order.created'],
    () => document.visibilityState === 'visible' && void fetchTransactions(true),
    [fetchTransactions],
  );

  const exportPage = () => {
    const rows = [
      ['Дата', 'Операция', 'Клиент', 'Телефон', 'Тип', 'Сумма', 'Сумма заказа'],
      ...transactions.map((transaction) => [
        transaction.timestamp ?? transaction.created_at,
        transaction.order_id,
        transaction.customers?.name,
        transaction.customers?.phone,
        transaction.type,
        transaction.amount,
        transaction.order_total,
      ]),
    ];
    const csv = `\uFEFF${rows.map((row) => row.map(csvCell).join(';')).join('\r\n')}`;
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `bulka-transactions-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  if (loading && transactions.length === 0) {
    return <PageState type="loading" title={t('transactions.load')} />;
  }
  if (error && transactions.length === 0) {
    return <PageState type="error" description={error} onRetry={fetchTransactions} />;
  }

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <Link className="btn-outline px-4 inline-flex items-center gap-2" to="/customers">
          <Gift aria-hidden="true" size={17} /> {t('transactions.manualBonus')}
        </Link>
        <button
          type="button"
          className="btn-outline px-4 inline-flex items-center gap-2"
          onClick={exportPage}
          disabled={!transactions.length}
        >
          <Download aria-hidden="true" size={17} /> Экспорт страницы
        </button>
        <button
          type="button"
          className="btn-outline px-4 inline-flex items-center gap-2"
          onClick={() => void fetchTransactions()}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} />{' '}
          {t('common.refresh')}
        </button>
      </div>
      {error && <div className="inline-alert inline-alert-error">{error}</div>}

      <section className="sagi-filter" aria-label={t('common.search')}>
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="transactions-search">
            {t('common.search')}
          </label>
          <div className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input
              id="transactions-search"
              name="transactionSearch"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('transactions.searchPlaceholder')}
              autoComplete="off"
              className="input-classic"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="transactions-type">
            Тип
          </label>
          <SelectControl
            compact
            id="transactions-type"
            value={type}
            onChange={(value) => updateParams({ type: value, page: null })}
            options={[
              { value: '', label: 'Все операции' },
              ...Object.keys(transactionTypeKeys).map((value) => ({
                value,
                label: t(transactionTypeKeys[value]),
              })),
            ]}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="transactions-from">
            {t('common.from')}
          </label>
          <input
            id="transactions-from"
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(event) => updateParams({ from: event.target.value, page: null })}
            className="input-classic"
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="transactions-to">
            {t('common.to')}
          </label>
          <input
            id="transactions-to"
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(event) => updateParams({ to: event.target.value, page: null })}
            className="input-classic"
          />
        </div>
      </section>

      {transactions.length === 0 ? (
        <PageState
          type="empty"
          title={t('transactions.empty')}
          description={t('transactions.emptyHint')}
        />
      ) : (
        <section className="card table-card">
          <div className="responsive-table-wrap">
            <table className="data-table transactions-table">
              <thead>
                <tr>
                  <th scope="col">{t('common.date')}</th>
                  <th scope="col">{t('transactions.number')}</th>
                  <th scope="col">{t('transactions.customer')}</th>
                  <th scope="col">{t('transactions.phone')}</th>
                  <th scope="col" className="text-right">
                    {t('transactions.amount')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('transactions.used')}
                  </th>
                  <th scope="col" className="text-right">
                    {t('transactions.bonus')}
                  </th>
                  <th scope="col">{t('common.status')}</th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((transaction) => {
                  const transactionType = String(transaction.type ?? '');
                  const isDeposit = ['deposit', 'manual_deposit'].includes(transactionType);
                  const isWithdrawal =
                    transactionType.includes('withdrawal') || transactionType === 'refund_reversal';
                  const items = Array.isArray(transaction.items) ? transaction.items : [];
                  const expanded = expandedId === transaction.id;
                  const typeLabel = t(transactionTypeKeys[transactionType] ?? 'transaction.other');
                  const orderLabel =
                    transaction.order_id === 'MANUAL' || transactionType.includes('manual')
                      ? t('transactions.manual')
                      : transactionType === 'expiration' ||
                          transaction.order_id === 'EXPIRED_90_DAYS'
                        ? t('transactions.expiration')
                        : t('transactions.receipt', { id: transaction.order_id || '—' });
                  return (
                    <Fragment key={transaction.id}>
                      <tr>
                        <td data-label={t('common.date')}>
                          <time dateTime={transaction.timestamp ?? transaction.created_at}>
                            {formatDate(transaction.timestamp ?? transaction.created_at)}
                          </time>
                        </td>
                        <td data-label={t('transactions.number')}>
                          <div className="receipt-cell">
                            <span className="receipt-pill">{orderLabel}</span>
                            {items.length > 0 && (
                              <button
                                type="button"
                                className="icon-button icon-button-sm"
                                onClick={() => setExpandedId(expanded ? null : transaction.id)}
                                aria-expanded={expanded}
                                aria-label={t('transactions.items')}
                              >
                                <ChevronDown
                                  aria-hidden="true"
                                  className={expanded ? 'rotate-180' : ''}
                                  size={17}
                                />
                              </button>
                            )}
                          </div>
                        </td>
                        <td data-label={t('transactions.customer')}>
                          <strong>
                            {transaction.customers?.name || t('transactions.unknownCustomer')}
                          </strong>
                        </td>
                        <td data-label={t('transactions.phone')}>
                          {transaction.customers?.phone || '—'}
                        </td>
                        <td data-label={t('transactions.amount')} className="text-right tabular">
                          {transaction.order_total == null
                            ? '—'
                            : formatNumber(transaction.order_total)}
                        </td>
                        <td
                          data-label={t('transactions.used')}
                          className={`text-right tabular ${isWithdrawal ? 'value-negative' : ''}`}
                        >
                          {isWithdrawal
                            ? formatNumber(Math.abs(Number(transaction.amount) || 0))
                            : '—'}
                        </td>
                        <td
                          data-label={t('transactions.bonus')}
                          className={`text-right tabular ${isDeposit ? 'value-positive' : 'value-negative'}`}
                        >
                          {isDeposit ? '+' : '−'}
                          {formatNumber(Math.abs(Number(transaction.amount) || 0))}
                        </td>
                        <td data-label={t('common.status')}>
                          <span className="status-pill status-active">{typeLabel}</span>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="expanded-row">
                          <td colSpan={8}>
                            <div className="order-items">
                              <h3>{t('transactions.items')}</h3>
                              <div className="responsive-table-wrap">
                                <table className="data-table data-table-compact">
                                  <thead>
                                    <tr>
                                      <th>{t('transactions.product')}</th>
                                      <th className="text-right">{t('transactions.quantity')}</th>
                                      <th className="text-right">{t('transactions.price')}</th>
                                      <th className="text-right">{t('transactions.amount')}</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {items.map((item: any, index: number) => (
                                      <tr key={`${item.productName ?? 'item'}-${index}`}>
                                        <td>
                                          {item.productName || t('transactions.unknownProduct')}
                                        </td>
                                        <td className="text-right tabular">
                                          {formatNumber(item.amount)}
                                        </td>
                                        <td className="text-right tabular">
                                          {formatNumber(item.price)}
                                        </td>
                                        <td className="text-right tabular">
                                          <strong>{formatNumber(item.total)}</strong>
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {totalPages > 1 && (
        <div className="table-pagination">
          <button
            type="button"
            className="btn-outline px-4"
            disabled={page <= 1 || loading}
            onClick={() => updateParams({ page: page - 1 })}
          >
            Назад
          </button>
          <span>
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn-outline px-4"
            disabled={page >= totalPages || loading}
            onClick={() => updateParams({ page: page + 1 })}
          >
            Далее
          </button>
        </div>
      )}
    </div>
  );
}

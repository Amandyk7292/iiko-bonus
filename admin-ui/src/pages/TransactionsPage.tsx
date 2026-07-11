import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronDown, Gift, RefreshCw, Search } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import PageState from '../components/PageState';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function TransactionsPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const navigate = useNavigate();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const fetchTransactions = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getTransactions();
      setTransactions(Array.isArray(data) ? data : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchTransactions(); }, [fetchTransactions]);

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const from = dateFrom ? new Date(`${dateFrom}T00:00:00`).getTime() : Number.NEGATIVE_INFINITY;
    const to = dateTo ? new Date(`${dateTo}T23:59:59.999`).getTime() : Number.POSITIVE_INFINITY;
    return transactions.filter(transaction => {
      const stamp = new Date(transaction.timestamp ?? transaction.created_at ?? 0).getTime();
      const text = `${transaction.customers?.name ?? ''} ${transaction.customers?.phone ?? ''} ${transaction.order_id ?? ''}`.toLocaleLowerCase();
      return text.includes(query) && stamp >= from && stamp <= to;
    });
  }, [dateFrom, dateTo, search, transactions]);

  if (loading && transactions.length === 0) return <PageState type="loading" title={t('transactions.load')} />;
  if (error && transactions.length === 0) return <PageState type="error" description={error} onRetry={fetchTransactions} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <button type="button" className="btn-outline px-4 inline-flex items-center gap-2" onClick={() => navigate('/customers')}>
          <Gift aria-hidden="true" size={17} /> {t('transactions.manualBonus')}
        </button>
        <button type="button" className="btn-outline px-4 inline-flex items-center gap-2" onClick={fetchTransactions} disabled={loading}>
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} /> {t('common.refresh')}
        </button>
      </div>
      {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}

      <section className="sagi-filter" aria-label={t('common.search')}>
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="transactions-search">{t('common.search')}</label>
          <div className="input-with-icon"><Search aria-hidden="true" size={18} /><input id="transactions-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder={t('transactions.searchPlaceholder')} className="input-classic" /></div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="transactions-from">{t('common.from')}</label>
          <input id="transactions-from" type="date" value={dateFrom} max={dateTo || undefined} onChange={event => setDateFrom(event.target.value)} className="input-classic" />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="transactions-to">{t('common.to')}</label>
          <input id="transactions-to" type="date" value={dateTo} min={dateFrom || undefined} onChange={event => setDateTo(event.target.value)} className="input-classic" />
        </div>
      </section>

      {filtered.length === 0 ? <PageState type="empty" title={t('transactions.empty')} description={t('transactions.emptyHint')} /> : (
        <section className="card table-card">
          <div className="responsive-table-wrap">
            <table className="data-table transactions-table">
              <thead><tr>
                <th scope="col">{t('common.date')}</th><th scope="col">{t('transactions.number')}</th><th scope="col">{t('transactions.customer')}</th>
                <th scope="col">{t('transactions.phone')}</th><th scope="col" className="text-right">{t('transactions.amount')}</th>
                <th scope="col" className="text-right">{t('transactions.used')}</th><th scope="col" className="text-right">{t('transactions.bonus')}</th><th scope="col">{t('common.status')}</th>
              </tr></thead>
              <tbody>
                {filtered.map(transaction => {
                  const type = String(transaction.type ?? '');
                  const isDeposit = type.includes('deposit');
                  const isWithdrawal = type.includes('withdrawal');
                  const items = Array.isArray(transaction.items) ? transaction.items : [];
                  const expanded = expandedId === transaction.id;
                  const typeLabel = t(`transaction.${type}`);
                  const orderLabel = transaction.order_id === 'MANUAL' || type.includes('manual')
                    ? t('transactions.manual')
                    : type === 'expiration' || transaction.order_id === 'EXPIRED_90_DAYS'
                      ? t('transactions.expiration')
                      : t('transactions.receipt', { id: transaction.order_id || '—' });
                  return (
                    <Fragment key={transaction.id}>
                      <tr>
                        <td data-label={t('common.date')}><time dateTime={transaction.timestamp ?? transaction.created_at}>{formatDate(transaction.timestamp ?? transaction.created_at)}</time></td>
                        <td data-label={t('transactions.number')}>
                          <div className="receipt-cell"><span className="receipt-pill">{orderLabel}</span>{items.length > 0 && <button type="button" className="icon-button icon-button-sm" onClick={() => setExpandedId(expanded ? null : transaction.id)} aria-expanded={expanded} aria-label={t('transactions.items')}><ChevronDown aria-hidden="true" className={expanded ? 'rotate-180' : ''} size={17} /></button>}</div>
                        </td>
                        <td data-label={t('transactions.customer')}><strong>{transaction.customers?.name || t('transactions.unknownCustomer')}</strong></td>
                        <td data-label={t('transactions.phone')}>{transaction.customers?.phone || '—'}</td>
                        <td data-label={t('transactions.amount')} className="text-right tabular">{transaction.order_total == null ? '—' : formatNumber(transaction.order_total)}</td>
                        <td data-label={t('transactions.used')} className={`text-right tabular ${isWithdrawal ? 'value-negative' : ''}`}>{isWithdrawal ? formatNumber(Math.abs(Number(transaction.amount) || 0)) : '—'}</td>
                        <td data-label={t('transactions.bonus')} className={`text-right tabular ${isDeposit ? 'value-positive' : 'value-negative'}`}>{isDeposit ? '+' : '−'}{formatNumber(Math.abs(Number(transaction.amount) || 0))}</td>
                        <td data-label={t('common.status')}><span className="status-pill status-active">{typeLabel}</span></td>
                      </tr>
                      {expanded && (
                        <tr className="expanded-row"><td colSpan={8}>
                          <div className="order-items"><h3>{t('transactions.items')}</h3><div className="responsive-table-wrap"><table className="data-table data-table-compact"><thead><tr><th>{t('transactions.product')}</th><th className="text-right">{t('transactions.quantity')}</th><th className="text-right">{t('transactions.price')}</th><th className="text-right">{t('transactions.amount')}</th></tr></thead><tbody>
                            {items.map((item: any, index: number) => <tr key={`${item.productName ?? 'item'}-${index}`}><td>{item.productName || t('transactions.unknownProduct')}</td><td className="text-right tabular">{formatNumber(item.amount)}</td><td className="text-right tabular">{formatNumber(item.price)}</td><td className="text-right tabular"><strong>{formatNumber(item.total)}</strong></td></tr>)}
                          </tbody></table></div></div>
                        </td></tr>
                      )}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

import { useCallback, useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Search } from 'lucide-react';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api, type AdminOrder } from '../lib/api';
import { useI18n } from '../lib/i18n';

const statuses = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];

export default function OrdersPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const { toast } = useFeedback();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [paymentStatus, setPaymentStatus] = useState('');
  const [orderStatus, setOrderStatus] = useState('');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [savingId, setSavingId] = useState('');
  const pageSize = 50;

  const load = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true);
      setError('');
    }
    try {
      const result = await api.getOrders({ page, pageSize, search, paymentStatus, orderStatus });
      setOrders(result.orders ?? []);
      setTotal(result.total ?? 0);
      if (!silent) setError('');
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [orderStatus, page, paymentStatus, search, t]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState !== 'visible' || inFlight) return;
      inFlight = true;
      try {
        await load(true);
      } finally {
        inFlight = false;
      }
    };
    const timer = window.setInterval(() => void refresh(), 5000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  const changeStatus = async (order: AdminOrder, status: string) => {
    if (status === order.orderStatus || savingId) return;
    let cancellationReason = '';
    if (status === 'cancelled') {
      const promptedReason = window.prompt(t('orders.cancelReasonPrompt'));
      if (promptedReason === null) return;
      cancellationReason = promptedReason.trim();
      if (!window.confirm(t('orders.refundConfirm', { amount: formatNumber(order.amount) }))) return;
    }
    setSavingId(order.id);
    try {
      const result = await api.updateOrderStatus(order.id, status, cancellationReason);
      setOrders(current => current.map(item => item.id === order.id ? result.order : item));
      toast(status === 'cancelled' ? t('orders.refundSucceeded') : t('orders.statusSaved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setSavingId('');
    }
  };

  if (loading && orders.length === 0) return <PageState type="loading" />;
  if (error && orders.length === 0) return <PageState type="error" description={error} onRetry={load} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <p className="orders-summary">{t('orders.found', { count: total })}</p>
        <button type="button" className="btn-outline px-4 inline-flex items-center gap-2" onClick={() => void load()} disabled={loading}>
          {loading ? <LoaderCircle className="spin" size={17} /> : <RefreshCw aria-hidden="true" size={17} />}
          {t('common.refresh')}
        </button>
      </div>
      {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}

      <section className="sagi-filter">
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="order-search">{t('common.search')}</label>
          <div className="input-with-icon"><Search aria-hidden="true" size={18} /><input id="order-search" type="search" className="input-classic" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} placeholder={t('orders.searchPlaceholder')} autoComplete="off" /></div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="payment-status">{t('orders.payment')}</label>
          <select id="payment-status" className="input-classic" value={paymentStatus} onChange={event => { setPaymentStatus(event.target.value); setPage(1); }}>
            <option value="">{t('orders.all')}</option>
            {['pending', 'paid', 'refunded', 'failed', 'expired'].map(value => <option value={value} key={value}>{t(`payment.${value}`)}</option>)}
          </select>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="order-status">{t('common.status')}</label>
          <select id="order-status" className="input-classic" value={orderStatus} onChange={event => { setOrderStatus(event.target.value); setPage(1); }}>
            <option value="">{t('orders.all')}</option>
            {statuses.map(value => <option value={value} key={value}>{t(`orderStatus.${value}`)}</option>)}
          </select>
        </div>
      </section>

      {orders.length === 0 ? <PageState type="empty" title={t('orders.empty')} description={t('orders.emptyHint')} /> : (
        <section className="card table-card">
          <div className="responsive-table-wrap"><table className="data-table orders-table">
            <thead><tr><th>{t('orders.number')}</th><th>{t('common.date')}</th><th>{t('orders.customer')}</th><th>{t('orders.details')}</th><th>{t('orders.payment')}</th><th>{t('common.status')}</th><th className="text-right">{t('orders.total')}</th></tr></thead>
            <tbody>{orders.map(order => <tr key={order.id}>
              <td data-label={t('orders.number')}><strong>№{order.number}</strong></td>
              <td data-label={t('common.date')} className="tabular">{formatDate(order.createdAt, { dateStyle: 'short', timeStyle: 'short' })}</td>
              <td data-label={t('orders.customer')}><strong>{order.customer?.name || '—'}</strong><small className="table-secondary">{order.customer?.phone || '—'}</small></td>
              <td data-label={t('orders.details')}><strong>{order.branch || '—'}</strong><small className="table-secondary">{order.items.slice(0, 2).map(item => `${item.name || t('orders.item')} ×${item.quantity || 1}`).join(', ') || '—'}</small></td>
              <td data-label={t('orders.payment')}><span className={`order-badge payment-${order.paymentStatus}`}>{t(`payment.${order.paymentStatus}`)}</span></td>
              <td data-label={t('common.status')}>
                {['paid', 'refunded'].includes(order.paymentStatus) ? <div className="order-status-control">
                  {savingId === order.id && <LoaderCircle className="spin" size={16} />}
                  <select aria-label={t('orders.changeStatus')} className="input-classic order-status-select" value={order.orderStatus} onChange={event => void changeStatus(order, event.target.value)} disabled={savingId === order.id || ['completed', 'cancelled'].includes(order.orderStatus)}>
                    {statuses.map(value => <option value={value} key={value}>{t(`orderStatus.${value}`)}</option>)}
                  </select>
                </div> : <span className="table-secondary">—</span>}
              </td>
              <td data-label={t('orders.total')} className="text-right tabular"><strong>{formatNumber(order.amount)} ₸</strong>{order.discount > 0 && <small className="table-secondary">−{formatNumber(order.discount)} ₸</small>}</td>
            </tr>)}</tbody>
          </table></div>
          {total > pageSize && <div className="table-pagination">
            <button type="button" className="btn-outline px-4" onClick={() => setPage(value => Math.max(1, value - 1))} disabled={page === 1 || loading}>←</button>
            <span className="tabular">{page} / {Math.ceil(total / pageSize)}</span>
            <button type="button" className="btn-outline px-4" onClick={() => setPage(value => value + 1)} disabled={page >= Math.ceil(total / pageSize) || loading}>→</button>
          </div>}
        </section>
      )}
    </div>
  );
}

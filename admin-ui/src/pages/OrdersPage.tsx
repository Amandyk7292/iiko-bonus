import { lazy, Suspense, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BadgeCheck, Camera, LoaderCircle, MapPin, RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from '../lib/router';
import PageState from '../components/PageState';
import Modal from '../components/Modal';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api, type AdminOrder, type DeliveryProof } from '../lib/api';
import {
  availableOrderStatuses,
  canMutateOrders,
  canRefundOrders,
  ORDER_STATUSES,
} from '../lib/admin-permissions';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
import { isCancellationReasonValid, normalizeCancellationReason } from '../lib/order-validation';

const OrderYandexDelivery = lazy(() =>
  import('./DispatchPage').then((module) => ({ default: module.OrderYandexDelivery })),
);

const mergeMutationResult = (current: AdminOrder, updated: AdminOrder): AdminOrder => ({
  ...current,
  ...updated,
  customer: updated.customer ?? current.customer,
  courier: updated.courier ?? current.courier,
});

const isRefundReconciling = (order: AdminOrder) =>
  ['processing', 'unknown'].includes(String(order.refundStatus || ''));

const paymentBadgeStatus = (order: AdminOrder) =>
  isRefundReconciling(order) ? 'refund-pending' : order.paymentStatus;

const isPreorder = (order: AdminOrder) => (order.orderType ?? order.fulfillmentType) === 'preorder';
const fulfillmentType = (order: AdminOrder) =>
  order.effectiveFulfillmentType ??
  (isPreorder(order)
    ? (order.preorderFulfillmentType ?? 'pickup')
    : (order.orderType ?? order.fulfillmentType ?? 'pickup'));

export default function OrdersPage({ role = 'viewer' }: { role?: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { toast } = useFeedback();
  const orderMutationsAllowed = canMutateOrders(role);
  const refundsAllowed = canRefundOrders(role);
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState('');
  const loadGeneration = useRef(0);
  const foregroundLoadPending = useRef(false);
  const [search, setSearch] = useState(params.get('search') || '');
  const [paymentStatus, setPaymentStatus] = useState(
    params.get('payment') === 'expired' ? '' : params.get('payment') || '',
  );
  const [orderStatus, setOrderStatus] = useState(params.get('status') || '');
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [total, setTotal] = useState(0);
  const [, setSavingIds] = useState<Set<string>>(() => new Set());
  const savingIdsRef = useRef(new Set<string>());
  const [yandexOrder, setYandexOrder] = useState<AdminOrder | null>(null);
  const [deliveryProof, setDeliveryProof] = useState<DeliveryProof | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [cancellationOrder, setCancellationOrder] = useState<AdminOrder | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const normalizedCancellationReason = normalizeCancellationReason(cancellationReason);
  const cancellationReasonValid = isCancellationReasonValid(cancellationReason);
  const cancellationReasonInvalid = cancellationReason.length > 0 && !cancellationReasonValid;
  const pageSize = 50;
  const isSaving = (id?: string) => Boolean(id && savingIdsRef.current.has(id));
  const cancellationSaving = isSaving(cancellationOrder?.id);
  const setOrderSaving = (id: string, value: boolean) => {
    if (value) savingIdsRef.current.add(id);
    else savingIdsRef.current.delete(id);
    setSavingIds(new Set(savingIdsRef.current));
  };

  const load = useCallback(
    async (silent = false) => {
      const generation = ++loadGeneration.current;
      // A realtime refresh taking over a visible load must also finish its loading/error state.
      const foreground = !silent || foregroundLoadPending.current;
      foregroundLoadPending.current = foreground;
      if (foreground) {
        setLoading(true);
        setError('');
      }
      try {
        const result = await api.getOrders({ page, pageSize, search, paymentStatus, orderStatus });
        if (generation !== loadGeneration.current) return;
        setOrders(result.orders ?? []);
        setTotal(result.total ?? 0);
        setInitialized(true);
        setError('');
      } catch (caught) {
        if (generation !== loadGeneration.current) return;
        if (foreground) setError(caught instanceof Error ? caught.message : t('common.loadError'));
      } finally {
        if (generation === loadGeneration.current) {
          foregroundLoadPending.current = false;
          setLoading(false);
        }
      }
    },
    [orderStatus, page, paymentStatus, search, t],
  );

  useEffect(() => {
    foregroundLoadPending.current = true;
    setLoading(true);
    setError('');
    const timer = window.setTimeout(() => void load(), 250);
    return () => {
      window.clearTimeout(timer);
      loadGeneration.current += 1;
      foregroundLoadPending.current = false;
    };
  }, [load]);

  useEffect(() => {
    const next = new URLSearchParams(params);
    for (const [key, value] of [
      ['search', search.trim()],
      ['payment', paymentStatus],
      ['status', orderStatus],
      ['page', page > 1 ? String(page) : ''],
    ]) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
  }, [orderStatus, page, params, paymentStatus, search, setParams]);

  useAdminRealtimeEvents(
    ['order.created', 'order.updated', 'order.customer_arrived'],
    () => {
      if (document.visibilityState === 'visible') void load(true);
    },
    [load],
  );

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const timer = window.setInterval(refresh, 60_000);
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [load]);

  const persistStatus = async (order: AdminOrder, status: string, reason = '') => {
    if (!orderMutationsAllowed || (status === 'cancelled' && !refundsAllowed)) {
      return false;
    }
    if (isSaving(order.id)) return false;
    const optimistic =
      status === 'cancelled'
        ? order
        : { ...order, orderStatus: status, updatedAt: new Date().toISOString() };
    setOrderSaving(order.id, true);
    if (status !== 'cancelled') {
      setOrders((current) => current.map((item) => (item.id === order.id ? optimistic : item)));
    }
    try {
      const result = await api.updateOrderStatus(order.id, status, reason);
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id ? mergeMutationResult(item, result.order) : item,
        ),
      );
      toast(status === 'cancelled' ? t('orders.refundSucceeded') : t('orders.statusSaved'));
      return true;
    } catch (caught) {
      if (status !== 'cancelled') {
        setOrders((current) => current.map((item) => (item.id === order.id ? order : item)));
      }
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
      return false;
    } finally {
      setOrderSaving(order.id, false);
    }
  };

  const changeStatus = (order: AdminOrder, status: string) => {
    if (!orderMutationsAllowed || status === order.orderStatus || isSaving(order.id)) return;
    if (status === 'cancelled') {
      if (!refundsAllowed) return;
      setCancellationOrder(order);
      setCancellationReason('');
      return;
    }
    void persistStatus(order, status);
  };

  const submitCancellation = async (event: FormEvent) => {
    event.preventDefault();
    if (!refundsAllowed || !cancellationOrder || cancellationSaving || !cancellationReasonValid) {
      return;
    }
    if (await persistStatus(cancellationOrder, 'cancelled', normalizedCancellationReason)) {
      setCancellationOrder(null);
      setCancellationReason('');
    }
  };

  const openDeliveryProof = async (order: AdminOrder) => {
    setProofLoading(true);
    setDeliveryProof(null);
    try {
      setDeliveryProof((await api.getDeliveryProof(order.id)).proof);
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : 'Не удалось загрузить подтверждение',
        'error',
      );
    } finally {
      setProofLoading(false);
    }
  };

  if (loading && !initialized) return <PageState type="loading" />;
  if (error && !initialized)
    return <PageState type="error" description={error} onRetry={() => void load()} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <p className="orders-summary">{t('orders.found', { count: total })}</p>
        <button
          type="button"
          className="btn-outline px-4 inline-flex items-center gap-2"
          onClick={() => void load()}
          disabled={loading}
        >
          {loading ? (
            <LoaderCircle className="spin" size={17} />
          ) : (
            <RefreshCw aria-hidden="true" size={17} />
          )}
          {t('common.refresh')}
        </button>
      </div>
      {error && orders.length > 0 && (
        <div className="inline-alert inline-alert-error" role="alert">
          {error}
        </div>
      )}

      <section className="sagi-filter">
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="order-search">
            {t('common.search')}
          </label>
          <div className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input
              id="order-search"
              name="orderSearch"
              type="search"
              className="input-classic"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder={t('orders.searchPlaceholder')}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="payment-status">
            {t('orders.payment')}
          </label>
          <SelectControl
            id="payment-status"
            value={paymentStatus}
            onChange={(value) => {
              setPaymentStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: t('orders.all') },
              { value: 'issues', label: t('payment.issues') },
              ...['pending', 'paid', 'refunded', 'failed'].map((value) => ({
                value,
                label: t(`payment.${value}`),
              })),
            ]}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="order-status">
            {t('common.status')}
          </label>
          <SelectControl
            id="order-status"
            value={orderStatus}
            onChange={(value) => {
              setOrderStatus(value);
              setPage(1);
            }}
            options={[
              { value: '', label: t('orders.all') },
              ...ORDER_STATUSES.map((value) => ({
                value,
                label: t(`orderStatus.${value}`),
              })),
            ]}
          />
        </div>
      </section>

      {loading && orders.length === 0 ? (
        <PageState type="loading" />
      ) : error && orders.length === 0 ? (
        <PageState type="error" description={error} onRetry={() => void load()} />
      ) : orders.length === 0 ? (
        <PageState type="empty" title={t('orders.empty')} description={t('orders.emptyHint')} />
      ) : (
        <section className="card table-card">
          <div className="responsive-table-wrap">
            <table className="data-table orders-table">
              <thead>
                <tr>
                  <th>{t('orders.number')}</th>
                  <th>{t('common.date')}</th>
                  <th>{t('orders.customer')}</th>
                  <th>{t('orders.details')}</th>
                  <th>{t('orders.payment')}</th>
                  <th>{t('common.status')}</th>
                  <th className="text-right">{t('orders.total')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td data-label={t('orders.number')}>
                      <strong>№{order.number}</strong>
                    </td>
                    <td data-label={t('common.date')} className="tabular">
                      {formatDate(order.createdAt, { dateStyle: 'short', timeStyle: 'short' })}
                    </td>
                    <td data-label={t('orders.customer')}>
                      <strong>{order.customer?.name || '—'}</strong>
                      <small className="table-secondary">{order.customer?.phone || '—'}</small>
                    </td>
                    <td data-label={t('orders.details')}>
                      <div className="flex flex-wrap items-center gap-2 mb-2">
                        {isPreorder(order) && (
                          <span className="status-pill fulfillment-preorder">
                            {t('locations.preorder')}
                          </span>
                        )}
                        <span
                          className={`status-pill fulfillment-${fulfillmentType(order) === 'delivery' ? 'delivery' : 'pickup'}`}
                        >
                          {t(
                            fulfillmentType(order) === 'delivery'
                              ? 'locations.delivery'
                              : 'locations.pickup',
                          )}
                        </span>
                      </div>
                      {isPreorder(order) && order.pickupTime && (
                        <small className="table-secondary">
                          {formatDate(order.pickupTime, { dateStyle: 'short', timeStyle: 'short' })}
                        </small>
                      )}
                      <strong>{order.branch || '—'}</strong>
                      <small className="table-secondary">
                        {order.items
                          .slice(0, 2)
                          .map((item) => `${item.name || t('orders.item')} ×${item.quantity || 1}`)
                          .join(', ') || '—'}
                      </small>
                      {order.customerArrivedAt && (
                        <div className="customer-arrived-alert">
                          <MapPin size={15} aria-hidden="true" />
                          <span>{t('orders.customerArrived')}</span>
                          <small>
                            {formatDate(order.customerArrivedAt, { timeStyle: 'short' })}
                          </small>
                        </div>
                      )}
                      {fulfillmentType(order) === 'delivery' && (
                        <div className="delivery-admin-control">
                          {order.courier && (
                            <small>
                              {order.courier.name} ·{' '}
                              {order.courier.isAutomobile === true ||
                              order.courier.transportType === 'car'
                                ? t('couriers.transport.car')
                                : order.courier.isAutomobile === false ||
                                    order.courier.transportType
                                  ? t(`couriers.transport.${order.courier.transportType || 'foot'}`)
                                  : t('orders.transportPending')}
                              {order.courier.vehicle ? ` · ${order.courier.vehicle}` : ''} ·{' '}
                              {order.courier.phone}
                            </small>
                          )}
                          <small>
                            {t(`deliveryStatus.${order.deliveryStatus || 'unassigned'}`)}
                          </small>
                          {order.trackingUrl && (
                            <a
                              href={order.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-button-refund"
                            >
                              {t('dispatch.yandex.track')}
                            </a>
                          )}
                          {orderMutationsAllowed &&
                            order.paymentStatus === 'paid' &&
                            !['completed', 'cancelled'].includes(order.orderStatus) && (
                              <button
                                type="button"
                                className="btn-outline compact-button"
                                onClick={() => setYandexOrder(order)}
                              >
                                {t('kitchen.dispatch.yandex')}
                              </button>
                            )}
                          {order.deliveryStatus === 'delivered' && (
                            <button
                              type="button"
                              className="text-button-refund"
                              onClick={() => void openDeliveryProof(order)}
                            >
                              <Camera size={14} aria-hidden="true" />
                              Подтверждение
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                    <td data-label={t('orders.payment')}>
                      <span className={`order-badge payment-${paymentBadgeStatus(order)}`}>
                        {t(
                          isRefundReconciling(order)
                            ? 'payment.refundPending'
                            : `payment.${order.paymentStatus}`,
                        )}
                      </span>
                      {Number(order.refundAmount || 0) > 0 && (
                        <small className="table-secondary">
                          Возврат: {formatNumber(Number(order.refundAmount))} ₸
                        </small>
                      )}
                    </td>
                    <td data-label={t('common.status')}>
                      {!isRefundReconciling(order) &&
                      ['paid', 'refunded'].includes(order.paymentStatus) &&
                      orderMutationsAllowed ? (
                        <div className="order-status-control">
                          {isSaving(order.id) && (
                            <LoaderCircle className="spin" size={16} aria-hidden="true" />
                          )}
                          <SelectControl
                            compact
                            ariaLabel={t('orders.changeStatus')}
                            className="order-status-select"
                            value={order.orderStatus}
                            onChange={(value) => void changeStatus(order, value)}
                            disabled={
                              isSaving(order.id) ||
                              ['completed', 'cancelled'].includes(order.orderStatus)
                            }
                            options={ORDER_STATUSES.map((value) => ({
                              value,
                              label: t(`orderStatus.${value}`),
                              disabled: !availableOrderStatuses(
                                order.orderStatus,
                                refundsAllowed,
                              ).includes(value),
                            }))}
                          />
                        </div>
                      ) : ['paid', 'refunded'].includes(order.paymentStatus) ? (
                        <span className="status-pill status-info">
                          {t(`orderStatus.${order.orderStatus}`)}
                        </span>
                      ) : (
                        <span className="table-secondary">—</span>
                      )}
                    </td>
                    <td data-label={t('orders.total')} className="text-right tabular">
                      <strong>{formatNumber(order.amount)} ₸</strong>
                      {order.discount > 0 && (
                        <small className="table-secondary">−{formatNumber(order.discount)} ₸</small>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {total > pageSize && (
            <div className="table-pagination">
              <button
                type="button"
                className="btn-outline px-4"
                onClick={() => setPage((value) => Math.max(1, value - 1))}
                disabled={page === 1 || loading}
              >
                ←
              </button>
              <span className="tabular">
                {page} / {Math.ceil(total / pageSize)}
              </span>
              <button
                type="button"
                className="btn-outline px-4"
                onClick={() => setPage((value) => value + 1)}
                disabled={page >= Math.ceil(total / pageSize) || loading}
              >
                →
              </button>
            </div>
          )}
        </section>
      )}
      <Modal
        open={Boolean(cancellationOrder)}
        onClose={() => !cancellationSaving && setCancellationOrder(null)}
        title={t('orderStatus.cancelled')}
        description={
          cancellationOrder
            ? t('orders.refundConfirm', { amount: formatNumber(cancellationOrder.amount) })
            : undefined
        }
        size="sm"
      >
        <form
          className="modal-body form-stack"
          onSubmit={(event) => void submitCancellation(event)}
        >
          <div className="field-group">
            <label className="field-label" htmlFor="order-cancellation-reason">
              {t('orders.cancelReasonPrompt')}
            </label>
            <textarea
              id="order-cancellation-reason"
              name="cancellationReason"
              className="input-classic"
              rows={4}
              minLength={3}
              maxLength={500}
              required
              aria-invalid={cancellationReasonInvalid}
              aria-describedby="order-cancellation-reason-help"
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              autoFocus
            />
            <p
              id="order-cancellation-reason-help"
              className={cancellationReasonInvalid ? 'field-error' : 'field-hint'}
              role={cancellationReasonInvalid ? 'alert' : undefined}
            >
              {t(
                cancellationReasonInvalid
                  ? 'orders.cancelReasonInvalid'
                  : 'orders.cancelReasonHint',
              )}
            </p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={() => setCancellationOrder(null)}
              disabled={cancellationSaving}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-danger px-5 inline-flex items-center gap-2"
              disabled={cancellationSaving || !cancellationReasonValid}
            >
              {cancellationSaving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t('common.confirm')}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(yandexOrder)}
        onClose={() => {
          if (document.querySelector('[role="alertdialog"]')) return;
          setYandexOrder(null);
          void load(true);
        }}
        title={`${t('kitchen.dispatch.yandex')}${yandexOrder ? ` · №${yandexOrder.number}` : ''}`}
        size="lg"
      >
        <div className="modal-body">
          {yandexOrder && (
            <Suspense fallback={<PageState compact type="loading" />}>
              <OrderYandexDelivery orderId={yandexOrder.id} />
            </Suspense>
          )}
        </div>
      </Modal>
      <Modal
        open={proofLoading || Boolean(deliveryProof)}
        onClose={() => !proofLoading && setDeliveryProof(null)}
        title="Подтверждение доставки"
        description="Фото доступно по временной защищённой ссылке."
        size="md"
      >
        <div className="modal-body">
          {proofLoading ? (
            <PageState compact type="loading" />
          ) : (
            deliveryProof && (
              <div className="delivery-proof">
                <img
                  src={deliveryProof.photoUrl}
                  alt="Фото передачи заказа клиенту"
                  width="960"
                  height="720"
                  loading="lazy"
                  decoding="async"
                />
                <dl>
                  <div>
                    <dt>
                      <BadgeCheck size={16} />
                      PIN клиента
                    </dt>
                    <dd>{deliveryProof.pinVerified ? 'Проверен' : 'Не проверен'}</dd>
                  </div>
                  <div>
                    <dt>Курьер</dt>
                    <dd>
                      {deliveryProof.courier?.name || '—'}
                      {deliveryProof.courier?.phone ? ` · ${deliveryProof.courier.phone}` : ''}
                    </dd>
                  </div>
                  <div>
                    <dt>Время</dt>
                    <dd>
                      {formatDate(deliveryProof.createdAt, {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </dd>
                  </div>
                  {deliveryProof.latitude != null && deliveryProof.longitude != null && (
                    <div>
                      <dt>
                        <MapPin size={16} />
                        Координаты
                      </dt>
                      <dd>
                        <a
                          href={`https://yandex.kz/maps/?pt=${deliveryProof.longitude},${deliveryProof.latitude}&z=17`}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {deliveryProof.latitude.toFixed(5)}, {deliveryProof.longitude.toFixed(5)}
                        </a>
                      </dd>
                    </div>
                  )}
                </dl>
              </div>
            )
          )}
        </div>
      </Modal>
    </div>
  );
}

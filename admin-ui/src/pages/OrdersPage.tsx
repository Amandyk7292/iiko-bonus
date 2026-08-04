import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { BadgeCheck, Camera, LoaderCircle, MapPin, RefreshCw, Search } from 'lucide-react';
import { useSearchParams } from '../lib/router';
import PageState from '../components/PageState';
import Modal from '../components/Modal';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api, type AdminOrder, type Courier, type DeliveryProof } from '../lib/api';
import {
  availableOrderStatuses,
  canMutateOrders,
  canRefundOrders,
  ORDER_STATUSES,
} from '../lib/admin-permissions';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
import { isCancellationReasonValid, normalizeCancellationReason } from '../lib/order-validation';

const deliveryTransitions: Record<string, string[]> = {
  unassigned: [],
  assigned: ['picked_up', 'en_route', 'cancelled'],
  picked_up: ['en_route', 'delivered', 'cancelled'],
  en_route: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

const mergeMutationResult = (current: AdminOrder, updated: AdminOrder): AdminOrder => ({
  ...current,
  ...updated,
  customer: updated.customer ?? current.customer,
  courier: updated.courier ?? current.courier,
});

export default function OrdersPage({ role = 'viewer' }: { role?: string }) {
  const { t, formatDate, formatNumber } = useI18n();
  const { toast } = useFeedback();
  const orderMutationsAllowed = canMutateOrders(role);
  const refundsAllowed = canRefundOrders(role);
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(params.get('search') || '');
  const [paymentStatus, setPaymentStatus] = useState(params.get('payment') || '');
  const [orderStatus, setOrderStatus] = useState(params.get('status') || '');
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [total, setTotal] = useState(0);
  const [, setSavingIds] = useState<Set<string>>(() => new Set());
  const savingIdsRef = useRef(new Set<string>());
  const [couriers, setCouriers] = useState<Courier[]>([]);
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
    },
    [orderStatus, page, paymentStatus, search, t],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 250);
    return () => window.clearTimeout(timer);
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

  useEffect(() => {
    void api
      .getCouriers()
      .then((result) => setCouriers(result.couriers ?? []))
      .catch(() => undefined);
  }, []);

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

  const assignCourier = async (order: AdminOrder, courierId: string) => {
    if (!orderMutationsAllowed || !courierId || isSaving(order.id)) return;
    const selectedCourier = couriers.find((courier) => courier.id === courierId);
    const optimistic: AdminOrder = {
      ...order,
      deliveryStatus: 'assigned',
      courier: selectedCourier
        ? {
            id: selectedCourier.id,
            name: selectedCourier.name,
            phone: selectedCourier.phone,
            vehicle: selectedCourier.vehicle,
          }
        : order.courier,
    };
    setOrderSaving(order.id, true);
    setOrders((current) => current.map((item) => (item.id === order.id ? optimistic : item)));
    try {
      const eta = new Date(Date.now() + 45 * 60_000).toISOString();
      const result = await api.assignCourier(order.id, courierId, eta);
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id ? mergeMutationResult(item, result.order) : item,
        ),
      );
      toast(t('orders.courierAssigned'));
    } catch (caught) {
      setOrders((current) => current.map((item) => (item.id === order.id ? order : item)));
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setOrderSaving(order.id, false);
    }
  };

  const changeDeliveryStatus = async (order: AdminOrder, status: string) => {
    if (!orderMutationsAllowed || !status || isSaving(order.id)) return;
    setOrderSaving(order.id, true);
    setOrders((current) =>
      current.map((item) => (item.id === order.id ? { ...item, deliveryStatus: status } : item)),
    );
    try {
      const result = await api.updateDeliveryStatus(order.id, status);
      setOrders((current) =>
        current.map((item) =>
          item.id === order.id ? mergeMutationResult(item, result.order) : item,
        ),
      );
      toast(t('orders.deliverySaved'));
    } catch (caught) {
      setOrders((current) => current.map((item) => (item.id === order.id ? order : item)));
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setOrderSaving(order.id, false);
    }
  };

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

  if (loading && orders.length === 0) return <PageState type="loading" />;
  if (error && orders.length === 0)
    return <PageState type="error" description={error} onRetry={load} />;

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
      {error && (
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
              ...['pending', 'paid', 'refunded', 'failed', 'expired'].map((value) => ({
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

      {orders.length === 0 ? (
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
                      {order.orderType === 'delivery' && (
                        <div className="delivery-admin-control">
                          <span className="status-pill status-warning">{t('orders.delivery')}</span>
                          {order.courier ? (
                            <small>
                              {order.courier.name} · {order.courier.phone}
                            </small>
                          ) : orderMutationsAllowed ? (
                            <SelectControl
                              compact
                              ariaLabel={t('orders.assignCourier')}
                              className="compact-select"
                              value=""
                              onChange={(value) => void assignCourier(order, value)}
                              disabled={isSaving(order.id)}
                              options={[
                                { value: '', label: t('orders.assignCourier') },
                                ...couriers
                                  .filter((courier) => courier.active)
                                  .map((courier) => ({
                                    value: courier.id,
                                    label: `${courier.name} · ${courier.vehicle || courier.phone}`,
                                  })),
                              ]}
                            />
                          ) : (
                            <small>{t('orders.courierNotAssigned')}</small>
                          )}
                          {orderMutationsAllowed &&
                            order.courier &&
                            (deliveryTransitions[order.deliveryStatus || 'unassigned']?.length ??
                              0) > 0 && (
                              <SelectControl
                                compact
                                ariaLabel={t(
                                  `deliveryStatus.${order.deliveryStatus || 'unassigned'}`,
                                )}
                                className="compact-select"
                                value=""
                                onChange={(value) => void changeDeliveryStatus(order, value)}
                                disabled={isSaving(order.id)}
                                options={[
                                  {
                                    value: '',
                                    label: t(
                                      `deliveryStatus.${order.deliveryStatus || 'unassigned'}`,
                                    ),
                                  },
                                  ...deliveryTransitions[order.deliveryStatus || 'unassigned'].map(
                                    (value) => ({
                                      value,
                                      label: t(`deliveryStatus.${value}`),
                                    }),
                                  ),
                                ]}
                              />
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
                      <span className={`order-badge payment-${order.paymentStatus}`}>
                        {t(`payment.${order.paymentStatus}`)}
                      </span>
                      {Number(order.refundAmount || 0) > 0 && (
                        <small className="table-secondary">
                          Возврат: {formatNumber(Number(order.refundAmount))} ₸
                        </small>
                      )}
                    </td>
                    <td data-label={t('common.status')}>
                      {['paid', 'refunded'].includes(order.paymentStatus) &&
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
                            options={availableOrderStatuses(order.orderStatus, refundsAllowed).map(
                              (value) => ({
                                value,
                                label: t(`orderStatus.${value}`),
                              }),
                            )}
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

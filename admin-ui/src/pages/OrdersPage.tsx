import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  BadgeCheck,
  Camera,
  LoaderCircle,
  MapPin,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useSearchParams } from '../lib/router';
import PageState from '../components/PageState';
import Modal from '../components/Modal';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api, type AdminOrder, type Courier, type DeliveryProof } from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';

const statuses = ['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
const deliveryTransitions: Record<string, string[]> = {
  unassigned: [],
  assigned: ['picked_up', 'en_route', 'cancelled'],
  picked_up: ['en_route', 'delivered', 'cancelled'],
  en_route: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export default function OrdersPage() {
  const { t, formatDate, formatNumber } = useI18n();
  const { toast } = useFeedback();
  const [params, setParams] = useSearchParams();
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState(params.get('search') || '');
  const [paymentStatus, setPaymentStatus] = useState(params.get('payment') || '');
  const [orderStatus, setOrderStatus] = useState(params.get('status') || '');
  const [page, setPage] = useState(Math.max(1, Number(params.get('page')) || 1));
  const [total, setTotal] = useState(0);
  const [savingId, setSavingId] = useState('');
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [refundOrder, setRefundOrder] = useState<AdminOrder | null>(null);
  const [refundData, setRefundData] = useState<any | null>(null);
  const [refundQuantities, setRefundQuantities] = useState<Record<string, number>>({});
  const [refundReason, setRefundReason] = useState('');
  const [deliveryProof, setDeliveryProof] = useState<DeliveryProof | null>(null);
  const [proofLoading, setProofLoading] = useState(false);
  const [cancellationOrder, setCancellationOrder] = useState<AdminOrder | null>(null);
  const [cancellationReason, setCancellationReason] = useState('');
  const pageSize = 50;

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
    if (!courierId || savingId) return;
    setSavingId(order.id);
    try {
      const eta = new Date(Date.now() + 45 * 60_000).toISOString();
      await api.assignCourier(order.id, courierId, eta);
      await load(true);
      toast(t('orders.courierAssigned'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setSavingId('');
    }
  };

  const changeDeliveryStatus = async (order: AdminOrder, status: string) => {
    if (!status || savingId) return;
    setSavingId(order.id);
    try {
      await api.updateDeliveryStatus(order.id, status);
      await load(true);
      toast(t('orders.deliverySaved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setSavingId('');
    }
  };

  const persistStatus = async (order: AdminOrder, status: string, reason = '') => {
    setSavingId(order.id);
    try {
      const result = await api.updateOrderStatus(order.id, status, reason);
      setOrders((current) => current.map((item) => (item.id === order.id ? result.order : item)));
      toast(status === 'cancelled' ? t('orders.refundSucceeded') : t('orders.statusSaved'));
      return true;
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
      return false;
    } finally {
      setSavingId('');
    }
  };

  const changeStatus = (order: AdminOrder, status: string) => {
    if (status === order.orderStatus || savingId) return;
    if (status === 'cancelled') {
      setCancellationOrder(order);
      setCancellationReason('');
      return;
    }
    void persistStatus(order, status);
  };

  const submitCancellation = async (event: FormEvent) => {
    event.preventDefault();
    if (!cancellationOrder || savingId) return;
    if (await persistStatus(cancellationOrder, 'cancelled', cancellationReason.trim())) {
      setCancellationOrder(null);
      setCancellationReason('');
    }
  };

  const openPartialRefund = async (order: AdminOrder) => {
    setRefundOrder(order);
    setRefundData(null);
    setRefundQuantities({});
    setRefundReason('');
    try {
      setRefundData((await api.getRefundOptions(order.id)).refund);
    } catch (caught) {
      setRefundOrder(null);
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    }
  };

  const submitPartialRefund = async () => {
    if (!refundOrder || savingId) return;
    const items = Object.entries(refundQuantities)
      .filter(([, quantity]) => quantity > 0)
      .map(([lineKey, quantity]) => ({ lineKey, quantity }));
    if (!items.length) {
      toast('Выберите позиции для возврата', 'error');
      return;
    }
    setSavingId(refundOrder.id);
    try {
      const result = await api.partialRefund(refundOrder.id, {
        idempotencyKey: crypto.randomUUID(),
        reason: refundReason,
        items,
      });
      const adjustment = result.refund.adjustment;
      const restored = Number(adjustment?.spentBonusRestored || 0);
      const reversed = Number(adjustment?.earnedBonusReversed || 0);
      toast(
        `Возвращено ${formatNumber(result.refund.amount)} ₸${restored ? ` · восстановлено ${formatNumber(restored)} бонусов/сертификата` : ''}${reversed ? ` · сторнировано ${formatNumber(reversed)} начисленных бонусов` : ''}`,
      );
      setRefundOrder(null);
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Возврат не выполнен', 'error');
    } finally {
      setSavingId('');
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
              ...statuses.map((value) => ({ value, label: t(`orderStatus.${value}`) })),
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
                      <div className="substitution-preference">
                        <strong>{t('orders.substitutionLabel')}</strong>
                        <span>
                          {t(
                            `orders.substitution.${order.substitutionPreference || 'call_customer'}`,
                          )}
                        </span>
                      </div>
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
                          ) : (
                            <SelectControl
                              compact
                              ariaLabel={t('orders.assignCourier')}
                              className="compact-select"
                              value=""
                              onChange={(value) => void assignCourier(order, value)}
                              disabled={savingId === order.id}
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
                          )}
                          {order.courier &&
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
                                disabled={savingId === order.id}
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
                              <Camera size={14} />
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
                      {order.paymentStatus === 'paid' &&
                        Number(order.refundAmount || 0) < Number(order.amount || 0) && (
                          <button
                            className="text-button-refund"
                            type="button"
                            onClick={() => void openPartialRefund(order)}
                          >
                            <RotateCcw size={14} />
                            По позициям
                          </button>
                        )}
                    </td>
                    <td data-label={t('common.status')}>
                      {['paid', 'refunded'].includes(order.paymentStatus) ? (
                        <div className="order-status-control">
                          {savingId === order.id && <LoaderCircle className="spin" size={16} />}
                          <SelectControl
                            compact
                            ariaLabel={t('orders.changeStatus')}
                            className="order-status-select"
                            value={order.orderStatus}
                            onChange={(value) => void changeStatus(order, value)}
                            disabled={
                              savingId === order.id ||
                              ['completed', 'cancelled'].includes(order.orderStatus)
                            }
                            options={statuses.map((value) => ({
                              value,
                              label: t(`orderStatus.${value}`),
                            }))}
                          />
                        </div>
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
        onClose={() => !savingId && setCancellationOrder(null)}
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
              maxLength={500}
              required
              value={cancellationReason}
              onChange={(event) => setCancellationReason(event.target.value)}
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={() => setCancellationOrder(null)}
              disabled={Boolean(savingId)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-danger px-5 inline-flex items-center gap-2"
              disabled={Boolean(savingId)}
            >
              {savingId && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t('common.confirm')}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(refundOrder)}
        onClose={() => !savingId && setRefundOrder(null)}
        title={`Частичный возврат · заказ №${refundOrder?.number || ''}`}
        description="Укажите количество возвращаемых позиций. Скидка распределяется сервером пропорционально."
        size="lg"
      >
        <div className="modal-body form-stack">
          {!refundData ? (
            <PageState compact type="loading" />
          ) : (
            <>
              <div className="refund-summary">
                <div>
                  <span>Оплачено</span>
                  <strong>{formatNumber(refundData.paidAmount)} ₸</strong>
                </div>
                <div>
                  <span>Уже возвращено</span>
                  <strong>{formatNumber(refundData.alreadyRefunded)} ₸</strong>
                </div>
                <div>
                  <span>Можно вернуть</span>
                  <strong>{formatNumber(refundData.remainingAmount)} ₸</strong>
                </div>
              </div>
              <div className="refund-lines">
                {refundData.lines.map((line: any) => (
                  <label
                    className={`refund-line ${line.refundableQuantity <= 0 ? 'is-disabled' : ''}`}
                    key={line.lineKey}
                  >
                    <div>
                      <strong>{line.name}</strong>
                      <small>
                        {formatNumber(line.unitAmount)} ₸ · куплено {line.quantity}
                        {line.refundedQuantity ? ` · возвращено ${line.refundedQuantity}` : ''}
                      </small>
                    </div>
                    <input
                      aria-label={`Количество ${line.name}`}
                      className="input-classic refund-quantity"
                      type="number"
                      min="0"
                      max={line.refundableQuantity}
                      value={refundQuantities[line.lineKey] || 0}
                      disabled={line.refundableQuantity <= 0}
                      onChange={(event) =>
                        setRefundQuantities((current) => ({
                          ...current,
                          [line.lineKey]: Math.max(
                            0,
                            Math.min(line.refundableQuantity, Number(event.target.value) || 0),
                          ),
                        }))
                      }
                    />
                  </label>
                ))}
              </div>
              <label className="field-group">
                <span className="field-label">Причина возврата</span>
                <textarea
                  className="input-classic"
                  maxLength={500}
                  value={refundReason}
                  onChange={(event) => setRefundReason(event.target.value)}
                  placeholder="Например: товар отсутствует или клиент отказался от позиции"
                />
              </label>
              <div className="inline-alert inline-alert-warning" role="note">
                Отправка возврата через Kaspi необратима. Проверьте позиции и количество перед
                подтверждением.
              </div>
              <div className="modal-actions">
                <button
                  className="btn-outline px-5"
                  type="button"
                  onClick={() => setRefundOrder(null)}
                  disabled={Boolean(savingId)}
                >
                  Отмена
                </button>
                <button
                  className="btn-danger px-5 inline-flex items-center gap-2"
                  type="button"
                  onClick={() => void submitPartialRefund()}
                  disabled={Boolean(savingId)}
                >
                  {savingId ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />}
                  Вернуть выбранное
                </button>
              </div>
            </>
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

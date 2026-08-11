import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ChefHat,
  Clock3,
  LoaderCircle,
  PackageCheck,
  RefreshCw,
  ShoppingBag,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';

const columns = [
  {
    status: 'queued',
    titleKey: 'kitchen.columnQueued',
    icon: Clock3,
    actionKey: 'kitchen.actionStart',
    next: 'preparing',
  },
  {
    status: 'preparing',
    titleKey: 'kitchen.columnPreparing',
    icon: ChefHat,
    actionKey: 'kitchen.actionReady',
    next: 'ready',
  },
  {
    status: 'ready',
    titleKey: 'kitchen.columnReady',
    icon: CheckCircle2,
    actionKey: 'kitchen.actionHandoff',
    next: 'handed_over',
  },
];

const dispatchStatuses = [
  'not_started',
  'pending',
  'processing',
  'retrying',
  'succeeded',
  'failed',
];

const elapsedMinutes = (value?: string | null) => {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
};

const dispatchStatusKey = (value?: string | null) => {
  const status = String(value || 'not_started');
  return dispatchStatuses.includes(status) ? status : 'not_started';
};

const dispatchProviderLabel = (value?: string | null) => {
  const provider = String(value || '').toLowerCase();
  if (provider === 'bulka' || provider === 'internal') return 'Bulka';
  return value || '';
};

const optimisticKitchenOrder = (order: any, next: string, minutes?: number) => {
  const now = new Date();
  const updates: Record<string, unknown> = {
    kitchenStatus: next,
    updatedAt: now.toISOString(),
  };
  if (next === 'preparing') {
    updates.fulfillmentStatus = 'preparing';
    updates.kitchenStartedAt = now.toISOString();
    updates.preparationMinutes = minutes;
    if (minutes) updates.promisedReadyAt = new Date(now.getTime() + minutes * 60_000).toISOString();
  } else if (next === 'ready') {
    updates.fulfillmentStatus = 'ready';
    updates.kitchenReadyAt = now.toISOString();
  } else if (next === 'handed_over') {
    updates.handedToCourierAt = now.toISOString();
  }
  return { ...order, ...updates };
};

export default function KitchenPage() {
  const { formatDate, t } = useI18n();
  const { toast } = useFeedback();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [, setSavingIds] = useState<Set<string>>(() => new Set());
  const savingIdsRef = useRef(new Set<string>());
  const [preparationOrder, setPreparationOrder] = useState<any | null>(null);
  const [preparationMinutes, setPreparationMinutes] = useState('30');
  const [iikoManualEntryConfirmed, setIikoManualEntryConfirmed] = useState(false);
  const [, setTick] = useState(0);
  const isSaving = (id?: string) => Boolean(id && savingIdsRef.current.has(id));
  const modalSaving = isSaving(preparationOrder?.id);

  const setOrderSaving = (id: string, value: boolean) => {
    if (value) savingIdsRef.current.add(id);
    else savingIdsRef.current.delete(id);
    setSavingIds(new Set(savingIdsRef.current));
  };

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setOrders((await api.getKitchenOrders()).orders ?? []);
        setError('');
      } catch (caught) {
        if (!silent) setError(caught instanceof Error ? caught.message : t('kitchen.loadError'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(
      () => document.visibilityState === 'visible' && void load(true),
      30_000,
    );
    const tickTimer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(tickTimer);
    };
  }, [load]);

  useAdminRealtimeEvents(
    ['order.created', 'order.updated', 'order.customer_arrived'],
    () => document.visibilityState === 'visible' && void load(true),
    [load],
  );

  const persistUpdate = async (
    order: any,
    next: string,
    minutes?: number,
    manualEntryConfirmed = false,
  ) => {
    if (isSaving(order.id)) return false;
    const optimistic = optimisticKitchenOrder(order, next, minutes);
    setOrderSaving(order.id, true);
    setOrders((current) =>
      next === 'handed_over'
        ? current.filter((item) => item.id !== order.id)
        : current.map((item) => (item.id === order.id ? optimistic : item)),
    );
    try {
      const result =
        next === 'preparing'
          ? await api.updateKitchenStatus(order.id, next, minutes, manualEntryConfirmed)
          : await api.updateKitchenStatus(order.id, next, minutes);
      if (next !== 'handed_over') {
        setOrders((current) => current.map((item) => (item.id === order.id ? result.order : item)));
      }
      return true;
    } catch (caught) {
      setOrders((current) => {
        const restored = current.map((item) => (item.id === order.id ? order : item));
        return restored.some((item) => item.id === order.id) ? restored : [...restored, order];
      });
      toast(caught instanceof Error ? caught.message : t('kitchen.statusError'), 'error');
      return false;
    } finally {
      setOrderSaving(order.id, false);
    }
  };

  const update = (order: any, next: string) => {
    if (isSaving(order.id)) return;
    if (next === 'preparing') {
      setPreparationOrder(order);
      setPreparationMinutes(String(order.preparationMinutes || 30));
      setIikoManualEntryConfirmed(false);
      return;
    }
    void persistUpdate(order, next);
  };

  const submitPreparation = async (event: FormEvent) => {
    event.preventDefault();
    if (!preparationOrder || modalSaving || !iikoManualEntryConfirmed) return;
    const minutes = Number(preparationMinutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) return;
    const order = preparationOrder;
    setPreparationOrder(null);
    if (!(await persistUpdate(order, 'preparing', minutes, true))) {
      setPreparationOrder(order);
    } else {
      setIikoManualEntryConfirmed(false);
    }
  };

  const closePreparation = () => {
    if (modalSaving) return;
    setPreparationOrder(null);
    setIikoManualEntryConfirmed(false);
  };

  const lateCount = useMemo(
    () =>
      orders.filter(
        (order) =>
          order.promisedReadyAt &&
          new Date(order.promisedReadyAt) < new Date() &&
          order.kitchenStatus !== 'ready',
      ).length,
    [orders],
  );
  if (loading && !orders.length) return <PageState type="loading" />;
  if (error && !orders.length)
    return <PageState type="error" description={error} onRetry={() => void load()} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('kitchen.heading')}</h2>
          <p className="page-help">{t('kitchen.intro')}</p>
        </div>
        <div className="action-cluster">
          <span className={`status-pill ${lateCount ? 'status-danger' : 'status-active'}`}>
            {t('kitchen.overdue', { count: lateCount })}
          </span>
          <button
            className="btn-outline px-5 inline-flex items-center gap-2"
            type="button"
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" size={17} />
            {t('common.refresh')}
          </button>
        </div>
      </div>
      <section className="kitchen-board">
        {columns.map((column) => {
          const ColumnIcon = column.icon;
          const columnOrders = orders.filter((order) => order.kitchenStatus === column.status);
          return (
            <div className={`kitchen-column kitchen-${column.status}`} key={column.status}>
              <header>
                <span>
                  <ColumnIcon aria-hidden="true" size={19} />
                  {t(column.titleKey)}
                </span>
                <strong>{columnOrders.length}</strong>
              </header>
              <div className="kitchen-column-list">
                {columnOrders.length === 0 ? (
                  <p className="kitchen-empty">{t('kitchen.noOrders')}</p>
                ) : (
                  columnOrders.map((order) => {
                    const late = Boolean(
                      order.promisedReadyAt &&
                      new Date(order.promisedReadyAt) < new Date() &&
                      order.kitchenStatus !== 'ready',
                    );
                    const delivery = order.fulfillmentType === 'delivery';
                    const dispatchStatus = dispatchStatusKey(order.courierDispatchStatus);
                    const actionLabel =
                      column.next === 'handed_over'
                        ? delivery
                          ? t('kitchen.handoff.delivery')
                          : t('kitchen.handoff.pickup')
                        : t(column.actionKey);
                    return (
                      <article
                        className={`card kitchen-ticket ${late ? 'kitchen-ticket-late' : ''}`}
                        key={order.id}
                      >
                        <div className="kitchen-ticket-head">
                          <strong>№{order.number}</strong>
                          <span>
                            {elapsedMinutes(order.kitchenStartedAt || order.createdAt) == null
                              ? '—'
                              : t('kitchen.elapsed', {
                                  count:
                                    elapsedMinutes(order.kitchenStartedAt || order.createdAt) ?? 0,
                                })}
                          </span>
                        </div>
                        <div
                          className={`status-pill mt-2 gap-2 ${delivery ? 'status-warning' : 'status-active'}`}
                        >
                          {delivery ? (
                            <ShoppingBag aria-hidden="true" size={17} />
                          ) : (
                            <PackageCheck aria-hidden="true" size={17} />
                          )}
                          <span>{t(delivery ? 'locations.delivery' : 'locations.pickup')}</span>
                        </div>
                        <p>{order.branch || t('kitchen.branch')}</p>
                        <ul>
                          {(order.items || []).map((item: any, index: number) => (
                            <li key={`${item.lineKey || item.id || index}`}>
                              <b>{item.quantity || 1}×</b> {item.name || t('kitchen.product')}
                              {item.configuration?.weight ? (
                                <small>{item.configuration.weight}</small>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                        {order.comment && <blockquote>{order.comment}</blockquote>}
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
                            <CheckCircle2 size={16} aria-hidden="true" />
                            <span>{t('orders.customerArrived')}</span>
                            <small>
                              {formatDate(order.customerArrivedAt, { timeStyle: 'short' })}
                            </small>
                          </div>
                        )}
                        {delivery && (
                          <div
                            className={`inline-alert items-start mt-3 ${
                              dispatchStatus === 'failed'
                                ? 'inline-alert-error'
                                : dispatchStatus === 'succeeded'
                                  ? 'inline-alert-success'
                                  : 'inline-alert-warning'
                            }`}
                            role={dispatchStatus === 'failed' ? 'alert' : 'status'}
                          >
                            <ShoppingBag aria-hidden="true" size={18} />
                            <span className="grid min-w-0 gap-1 break-words">
                              <strong>{t(`kitchen.dispatch.${dispatchStatus}`)}</strong>
                              {order.courierDispatchProvider && (
                                <small>
                                  {t('kitchen.dispatch.provider', {
                                    provider:
                                      String(order.courierDispatchProvider).toLowerCase() === 'yandex'
                                        ? t('kitchen.dispatch.yandex')
                                        : dispatchProviderLabel(order.courierDispatchProvider),
                                  })}
                                </small>
                              )}
                              {order.courierDispatchError && (
                                <small className="value-negative">
                                  {order.courierDispatchError}
                                </small>
                              )}
                            </span>
                          </div>
                        )}
                        <div className="kitchen-time">
                          <Clock3 aria-hidden="true" size={15} />
                          {order.promisedReadyAt ? (
                            <>
                              {t('kitchen.readyBy', {
                                time: formatDate(order.promisedReadyAt, { timeStyle: 'short' }),
                              })}
                            </>
                          ) : (
                            t('kitchen.noPromisedTime')
                          )}
                        </div>
                        <button
                          className="btn-classic w-full min-h-12 gap-2 text-base"
                          type="button"
                          disabled={isSaving(order.id)}
                          onClick={() => update(order, column.next)}
                        >
                          {isSaving(order.id) ? (
                            <LoaderCircle aria-hidden="true" className="spin" size={17} />
                          ) : (
                            <PackageCheck aria-hidden="true" size={17} />
                          )}
                          {actionLabel}
                        </button>
                      </article>
                    );
                  })
                )}
              </div>
            </div>
          );
        })}
      </section>
      <Modal
        open={Boolean(preparationOrder)}
        title={t('kitchen.actionStart')}
        description={preparationOrder ? `№${preparationOrder.number}` : undefined}
        onClose={closePreparation}
        size="sm"
      >
        <form className="modal-body form-stack" onSubmit={(event) => void submitPreparation(event)}>
          <div className="field-group">
            <label className="field-label" htmlFor="preparation-minutes">
              {t('kitchen.preparationPrompt')}
            </label>
            <input
              id="preparation-minutes"
              name="preparationMinutes"
              className="input-classic"
              type="number"
              inputMode="numeric"
              min="1"
              max="240"
              step="1"
              value={preparationMinutes}
              onChange={(event) => setPreparationMinutes(event.target.value)}
              required
            />
          </div>
          {preparationOrder?.fulfillmentType === 'delivery' && (
            <div className="inline-alert inline-alert-warning items-start" role="note">
              <AlertTriangle aria-hidden="true" size={20} />
              <span className="grid gap-1">
                <strong>{t('kitchen.deliveryWarning')}</strong>
                <small>{t('kitchen.deliveryWarningHint')}</small>
              </span>
            </div>
          )}
          <label className="form-section inline-alert kitchen-iiko-confirmation cursor-pointer">
            <input
              type="checkbox"
              checked={iikoManualEntryConfirmed}
              onChange={(event) => setIikoManualEntryConfirmed(event.target.checked)}
              required
            />
            <span className="grid gap-1">
              <strong>{t('kitchen.iikoConfirmation')}</strong>
              <small>{t('kitchen.iikoConfirmationHint')}</small>
            </span>
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5 min-h-12"
              onClick={closePreparation}
              disabled={modalSaving}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-classic px-5 min-h-12 inline-flex items-center gap-2"
              disabled={modalSaving || !iikoManualEntryConfirmed}
            >
              {modalSaving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t('kitchen.actionStart')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

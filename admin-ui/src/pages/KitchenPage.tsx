import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  AlertTriangle,
  BellRing,
  CheckCircle2,
  ChefHat,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  PackageCheck,
  Phone,
  RefreshCw,
  ShoppingBag,
  Volume2,
  VolumeX,
  WifiOff,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useAdminRealtime, useAdminRealtimeEvents } from '../lib/admin-realtime';
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
  'awaiting_confirmation',
  'succeeded',
  'failed',
];

const elapsedMinutes = (value?: string | null) => {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
};

const acceptanceRequestedAt = (order: any) => order.acceptanceRequestedAt || order.createdAt;

const kitchenElapsedFrom = (order: any) =>
  order.kitchenStatus === 'queued'
    ? acceptanceRequestedAt(order)
    : order.kitchenStartedAt || order.createdAt;

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

const kitchenStatusRank = (status?: string | null) => {
  if (status === 'queued') return 0;
  if (status === 'preparing') return 1;
  if (status === 'ready') return 2;
  if (status === 'handed_over' || status === 'cancelled') return 3;
  return -1;
};

const shouldApplyKitchenMutation = (current: any, incoming: any, hasNewerLoad: boolean) => {
  const currentRank = kitchenStatusRank(current?.kitchenStatus);
  const incomingRank = kitchenStatusRank(incoming?.kitchenStatus);
  if (incomingRank !== currentRank) return incomingRank > currentRank;
  return !hasNewerLoad;
};

export default function KitchenPage() {
  const { formatDate, t } = useI18n();
  const { toast } = useFeedback();
  const {
    connectionStatus,
    playOrderAlarm,
    setSoundEnabled,
    soundEnabled,
    soundReady,
    unlockSound,
  } = useAdminRealtime();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [, setSavingIds] = useState<Set<string>>(() => new Set());
  const savingIdsRef = useRef(new Set<string>());
  const [preparationOrder, setPreparationOrder] = useState<any | null>(null);
  const [preparationMinutes, setPreparationMinutes] = useState('30');
  const [iikoManualEntryConfirmed, setIikoManualEntryConfirmed] = useState(false);
  const [, setTick] = useState(0);
  const loadRequestRef = useRef(0);
  const appliedLoadRequestRef = useRef(0);
  const loadBarrierRef = useRef(0);
  const loadInFlightRef = useRef<Promise<any[] | null> | null>(null);
  const trailingLoadRef = useRef(false);
  const trailingLoadSilentRef = useRef(true);
  const isSaving = (id?: string) => Boolean(id && savingIdsRef.current.has(id));
  const modalSaving = isSaving(preparationOrder?.id);

  const setOrderSaving = (id: string, value: boolean) => {
    if (value) savingIdsRef.current.add(id);
    else savingIdsRef.current.delete(id);
    setSavingIds(new Set(savingIdsRef.current));
  };

  const executeLoad = useCallback(
    async (silent = false) => {
      const requestId = ++loadRequestRef.current;
      const barrier = loadBarrierRef.current;
      if (!silent) setLoading(true);
      try {
        const nextOrders = (await api.getKitchenOrders()).orders ?? [];
        if (barrier !== loadBarrierRef.current || requestId <= appliedLoadRequestRef.current) {
          return null;
        }
        appliedLoadRequestRef.current = requestId;
        setOrders(nextOrders);
        setError('');
        return nextOrders;
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : t('kitchen.loadError'));
        }
        return null;
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t],
  );

  const load = useCallback(
    (silent = false) => {
      if (loadInFlightRef.current) {
        trailingLoadRef.current = true;
        trailingLoadSilentRef.current = trailingLoadSilentRef.current && silent;
        if (!silent) setLoading(true);
        return loadInFlightRef.current;
      }

      const runQueuedLoads = async () => {
        let nextSilent = silent;
        let lastSuccessfulOrders: any[] | null = null;
        while (true) {
          trailingLoadRef.current = false;
          trailingLoadSilentRef.current = true;
          const nextOrders = await executeLoad(nextSilent);
          if (nextOrders !== null) lastSuccessfulOrders = nextOrders;
          if (!trailingLoadRef.current) return lastSuccessfulOrders;
          nextSilent = trailingLoadSilentRef.current;
        }
      };

      let request: Promise<any[] | null>;
      request = runQueuedLoads().finally(() => {
        if (loadInFlightRef.current === request) loadInFlightRef.current = null;
      });
      loadInFlightRef.current = request;
      return request;
    },
    [executeLoad],
  );

  useEffect(() => {
    void load();
    const refreshTimer = window.setInterval(
      () => document.visibilityState === 'visible' && void load(true),
      30_000,
    );
    const tickTimer = window.setInterval(() => setTick((value) => value + 1), 30_000);
    const refreshVisible = () => {
      if (document.visibilityState === 'visible') void load(true);
    };
    const refreshOnline = () => void load(true);
    document.addEventListener('visibilitychange', refreshVisible);
    window.addEventListener('online', refreshOnline);
    return () => {
      window.clearInterval(refreshTimer);
      window.clearInterval(tickTimer);
      document.removeEventListener('visibilitychange', refreshVisible);
      window.removeEventListener('online', refreshOnline);
    };
  }, [load]);

  useAdminRealtimeEvents(
    ['connected', 'order.created', 'order.updated', 'order.customer_arrived'],
    () => void load(true),
    [load],
  );

  const unacceptedOrders = useMemo(
    () =>
      orders
        .filter((order) => order.kitchenStatus === 'queued')
        .sort(
          (left, right) =>
            new Date(acceptanceRequestedAt(left) || 0).getTime() -
            new Date(acceptanceRequestedAt(right) || 0).getTime(),
        ),
    [orders],
  );
  const hasUnacceptedOrders = unacceptedOrders.length > 0;
  const oldestUnacceptedOrder = unacceptedOrders[0] || null;

  useEffect(() => {
    if (!hasUnacceptedOrders || !soundEnabled) return;
    const ring = () => {
      if (document.visibilityState === 'visible') playOrderAlarm();
    };
    ring();
    const alarmTimer = window.setInterval(ring, 25_000);
    document.addEventListener('visibilitychange', ring);
    window.addEventListener('online', ring);
    return () => {
      window.clearInterval(alarmTimer);
      document.removeEventListener('visibilitychange', ring);
      window.removeEventListener('online', ring);
    };
  }, [hasUnacceptedOrders, playOrderAlarm, soundEnabled, soundReady]);

  const persistUpdate = async (
    order: any,
    next: string,
    minutes?: number,
    manualEntryConfirmed = false,
  ) => {
    if (isSaving(order.id)) return false;
    const waitsForServerAcceptance = next === 'preparing';
    const optimistic = optimisticKitchenOrder(order, next, minutes);
    const loadVersionAtMutation = appliedLoadRequestRef.current;
    setOrderSaving(order.id, true);
    if (!waitsForServerAcceptance) {
      setOrders((current) =>
        next === 'handed_over'
          ? current.filter((item) => item.id !== order.id)
          : current.map((item) => (item.id === order.id ? optimistic : item)),
      );
    }
    try {
      const result =
        next === 'preparing'
          ? await api.updateKitchenStatus(order.id, next, minutes, manualEntryConfirmed)
          : await api.updateKitchenStatus(order.id, next, minutes);
      // A server-confirmed acceptance wins over any older kitchen GET still in flight.
      loadBarrierRef.current += 1;
      if (next !== 'handed_over') {
        setOrders((current) =>
          current.map((item) =>
            item.id === order.id &&
            shouldApplyKitchenMutation(
              item,
              result.order,
              appliedLoadRequestRef.current > loadVersionAtMutation,
            )
              ? result.order
              : item,
          ),
        );
      }
      return true;
    } catch (caught) {
      if (waitsForServerAcceptance) {
        const reconciledOrders = await load(true);
        if (reconciledOrders !== null) {
          const reconciledOrder = reconciledOrders.find((item) => item.id === order.id);
          if (!reconciledOrder || kitchenStatusRank(reconciledOrder.kitchenStatus) > 0) return true;
        }
      } else if (next === 'handed_over') {
        if (appliedLoadRequestRef.current === loadVersionAtMutation) {
          setOrders((current) =>
            current.some((item) => item.id === order.id) ? current : [...current, order],
          );
        }
      } else {
        setOrders((current) =>
          current.map((item) =>
            item.id === order.id &&
            item.kitchenStatus === optimistic.kitchenStatus &&
            item.updatedAt === optimistic.updatedAt
              ? order
              : item,
          ),
        );
      }
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
      {oldestUnacceptedOrder && (
        <section
          className="kitchen-acceptance-alert"
          role="alert"
          aria-labelledby="kitchen-acceptance-alert-title"
        >
          <BellRing className="mt-1" aria-hidden="true" size={32} />
          <div className="min-w-0">
            <h2 className="m-0 text-xl leading-tight" id="kitchen-acceptance-alert-title">
              {t('kitchen.alarmTitle', { count: unacceptedOrders.length })}
            </h2>
            <p className="m-0 mt-1 text-base font-bold tabular" aria-live="off">
              {t('kitchen.alarmOldest', {
                number: oldestUnacceptedOrder.number,
                count: elapsedMinutes(acceptanceRequestedAt(oldestUnacceptedOrder)) ?? 0,
              })}
            </p>
            <small className="mt-1 block text-sm leading-relaxed">
              {isSaving(oldestUnacceptedOrder.id)
                ? t('kitchen.alarmSaving')
                : t('kitchen.alarmHint')}
            </small>
            {(connectionStatus === 'offline' || connectionStatus === 'reconnecting') && (
              <span
                className="inline-alert kitchen-acceptance-offline mt-2 inline-flex items-center gap-2"
                role="status"
              >
                <WifiOff aria-hidden="true" size={17} />
                {t('kitchen.alarmOffline')}
              </span>
            )}
          </div>
          <div className="kitchen-acceptance-alert-actions grid gap-2">
            <button
              className="btn-outline kitchen-acceptance-primary min-h-12 w-full gap-2 px-5 text-base"
              type="button"
              disabled={isSaving(oldestUnacceptedOrder.id)}
              onClick={() => update(oldestUnacceptedOrder, 'preparing')}
            >
              {isSaving(oldestUnacceptedOrder.id) ? (
                <LoaderCircle aria-hidden="true" className="spin" size={20} />
              ) : (
                <PackageCheck aria-hidden="true" size={20} />
              )}
              {t('kitchen.actionStart')}
            </button>
            {(!soundEnabled || !soundReady) && (
              <button
                className="btn-outline kitchen-acceptance-sound min-h-12 w-full gap-2 px-5"
                type="button"
                onClick={() => {
                  if (!soundEnabled) setSoundEnabled(true);
                  else void unlockSound();
                }}
              >
                {soundEnabled ? (
                  <Volume2 aria-hidden="true" size={19} />
                ) : (
                  <VolumeX aria-hidden="true" size={19} />
                )}
                {t(soundEnabled ? 'kitchen.alarmUnlockSound' : 'kitchen.alarmEnableSound')}
              </button>
            )}
          </div>
        </section>
      )}
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
                    const externalCourier = order.externalDelivery?.courier;
                    const courierMapUrl =
                      externalCourier?.latitude != null && externalCourier?.longitude != null
                        ? `https://yandex.kz/maps/?pt=${encodeURIComponent(
                            `${externalCourier.longitude},${externalCourier.latitude}`,
                          )}&z=16&l=map`
                        : null;
                    const actionLabel =
                      column.next === 'handed_over'
                        ? delivery
                          ? t('kitchen.handoff.delivery')
                          : t('kitchen.handoff.pickup')
                        : t(column.actionKey);
                    return (
                      <article
                        className={`card kitchen-ticket ${
                          order.kitchenStatus === 'queued' || late ? 'kitchen-ticket-late' : ''
                        }`}
                        key={order.id}
                      >
                        <div className="kitchen-ticket-head">
                          <strong>№{order.number}</strong>
                          <span>
                            {elapsedMinutes(kitchenElapsedFrom(order)) == null
                              ? '—'
                              : t('kitchen.elapsed', {
                                  count: elapsedMinutes(kitchenElapsedFrom(order)) ?? 0,
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
                        {order.acceptedAt && (
                          <div
                            className="inline-alert inline-alert-success mt-3 flex items-start gap-2"
                            role="status"
                          >
                            <CheckCircle2 aria-hidden="true" size={17} />
                            <span className="grid min-w-0 gap-1">
                              <strong>
                                {t('kitchen.acceptedBy', {
                                  name: order.acceptedBy || t('kitchen.acceptedUnknown'),
                                })}
                              </strong>
                              <small className="break-words">
                                {formatDate(order.acceptedAt, { timeStyle: 'short' })}
                                {order.acceptedDeviceLabel
                                  ? ` · ${t('kitchen.acceptedDevice', {
                                      device: order.acceptedDeviceLabel,
                                    })}`
                                  : ''}
                              </small>
                            </span>
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
                                      String(order.courierDispatchProvider).toLowerCase() ===
                                      'yandex'
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
                        {delivery && (externalCourier || order.externalDelivery?.trackingUrl) && (
                          <div className="inline-alert inline-alert-success items-start mt-3">
                            <MapPin aria-hidden="true" size={18} />
                            <span className="grid min-w-0 gap-1 break-words">
                              <strong>{t('kitchen.courierTracking')}</strong>
                              {externalCourier?.name && <small>{externalCourier.name}</small>}
                              {externalCourier?.phone && (
                                <small className="inline-flex items-center gap-1">
                                  <Phone aria-hidden="true" size={13} />
                                  <a href={`tel:${externalCourier.phone}`}>
                                    {externalCourier.phone}
                                  </a>
                                </small>
                              )}
                              {externalCourier?.vehicle && <small>{externalCourier.vehicle}</small>}
                              {externalCourier?.locationUpdatedAt && (
                                <small>
                                  {t('kitchen.courierUpdated', {
                                    time: formatDate(externalCourier.locationUpdatedAt, {
                                      timeStyle: 'short',
                                    }),
                                  })}
                                </small>
                              )}
                              <span className="flex flex-wrap gap-2">
                                {courierMapUrl && (
                                  <a
                                    className="btn-outline inline-flex min-h-10 items-center gap-1 px-3 text-sm"
                                    href={courierMapUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <MapPin aria-hidden="true" size={14} />
                                    {t('kitchen.courierOpenMap')}
                                  </a>
                                )}
                                {order.externalDelivery?.trackingUrl && (
                                  <a
                                    className="btn-outline inline-flex min-h-10 items-center gap-1 px-3 text-sm"
                                    href={order.externalDelivery.trackingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <ExternalLink aria-hidden="true" size={14} />
                                    {t('kitchen.courierLiveLink')}
                                  </a>
                                )}
                              </span>
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

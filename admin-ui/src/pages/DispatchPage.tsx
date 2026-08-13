import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Calculator,
  CircleOff,
  Clock3,
  ExternalLink,
  Link2,
  LoaderCircle,
  MapPin,
  Navigation,
  PackageCheck,
  RefreshCw,
  Route,
  RotateCw,
  Send,
  Undo2,
  X,
} from 'lucide-react';
import DispatchMap from '../components/DispatchMap';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import {
  api,
  type DispatchOrder,
  type ExternalDelivery,
  type YandexDeliveryConfiguration,
} from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';

const availabilityStatuses = ['offline', 'available', 'busy', 'break'];
type YandexItemsResolution = 'returned' | 'delivered';
type YandexCreateResolution = 'attach' | 'not_created';

const deliveryAddressText = (value: DispatchOrder['deliveryAddress']) => {
  if (!value) return '';
  return value;
};

export default function DispatchPage() {
  const { formatDate, formatNumber, t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [couriers, setCouriers] = useState<any[]>([]);
  const [orders, setOrders] = useState<DispatchOrder[]>([]);
  const [yandexConfig, setYandexConfig] = useState<YandexDeliveryConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [nowMs, setNowMs] = useState(() => Date.now());

  const canQuoteYandex = Boolean(yandexConfig?.canQuote ?? yandexConfig?.canManage);
  const canCreateYandex = Boolean(yandexConfig?.canCreate ?? yandexConfig?.canManage);
  const canReconcileYandexCreate = yandexConfig?.canCreate === true;

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const result = await api.getDispatch();
        setCouriers(result.couriers ?? []);
        setOrders(result.orders ?? []);
        setYandexConfig(result.yandexDelivery ?? null);
        setError('');
      } catch (caught) {
        if (!silent) setError(caught instanceof Error ? caught.message : t('dispatch.loadError'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
    const refresh = () => document.visibilityState === 'visible' && void load(true);
    const timer = window.setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  useEffect(() => {
    const hasBusinessJob = orders.some(
      (order) => order.externalDelivery?.apiFamily === 'business_v2',
    );
    if (yandexConfig?.apiMode !== 'business_v2' && !hasBusinessJob) return undefined;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [orders, yandexConfig?.apiMode]);

  useAdminRealtimeEvents(
    ['order.created', 'order.updated', 'courier.updated', 'delivery.updated'],
    () => document.visibilityState === 'visible' && void load(true),
    [load],
  );

  const assign = async (orderId: string) => {
    if (saving) return;
    setSaving(`${orderId}:own`);
    try {
      const result = await api.autoAssignCourier(orderId);
      toast(
        t('dispatch.assignedToast', {
          name: result.courier.name,
          eta: formatDate(result.eta, { timeStyle: 'short' }),
        }),
      );
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('dispatch.assignError'), 'error');
    } finally {
      setSaving('');
    }
  };

  const runYandexAction = async (
    orderId: string,
    action: string,
    request: () => Promise<{ delivery: ExternalDelivery | null }>,
    successMessage: string,
  ) => {
    if (saving) return;
    setSaving(`${orderId}:${action}`);
    try {
      await request();
      toast(successMessage);
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('dispatch.yandex.actionError'), 'error');
    } finally {
      setSaving('');
    }
  };

  const quoteYandex = (orderId: string) =>
    runYandexAction(
      orderId,
      'quote',
      () => api.quoteYandexDelivery(orderId),
      t('dispatch.yandex.quoteSuccess'),
    );

  const requestYandex = async (orderId: string, delivery: ExternalDelivery | null) => {
    const businessMode =
      delivery?.apiFamily === 'business_v2' ||
      (!delivery && yandexConfig?.apiMode === 'business_v2');
    const quotedPrice = Number(delivery?.quotedPrice ?? delivery?.price);
    if (businessMode) {
      if (
        !delivery?.id ||
        delivery.apiFamily !== 'business_v2' ||
        !delivery.quoteFingerprint ||
        delivery.fixedPrice !== true ||
        !Number.isFinite(quotedPrice) ||
        quotedPrice <= 0
      ) {
        toast(t('dispatch.yandex.fixedQuoteRequired'), 'error');
        return;
      }
      if (!delivery.quoteExpiresAt || new Date(delivery.quoteExpiresAt).getTime() <= Date.now()) {
        toast(t('dispatch.yandex.quoteExpired'), 'error');
        return;
      }
      const accepted = await confirm({
        title: t('dispatch.yandex.requestConfirmTitle'),
        body: t('dispatch.yandex.requestConfirmBody', {
          price: formatNumber(quotedPrice),
        }),
        confirmLabel: t('dispatch.yandex.requestConfirmLabel', {
          price: formatNumber(quotedPrice),
        }),
      });
      if (!accepted) return;
    }
    await runYandexAction(
      orderId,
      'request',
      () =>
        api.requestYandexDelivery(
          orderId,
          businessMode
            ? {
                deliveryJobId: delivery?.id,
                maxPriceKzt: quotedPrice,
                quoteFingerprint: delivery?.quoteFingerprint || undefined,
              }
            : {},
        ),
      businessMode
        ? t('dispatch.yandex.businessRequestSuccess')
        : t('dispatch.yandex.cargoRequestSuccess'),
    );
  };

  const syncYandex = (orderId: string) =>
    runYandexAction(
      orderId,
      'sync',
      () => api.syncYandexDelivery(orderId),
      t('dispatch.yandex.syncSuccess'),
    );

  const cancelYandex = async (orderId: string) => {
    if (saving) return;
    setSaving(`${orderId}:cancel`);
    try {
      const { cancellation } = await api.getYandexCancellationInfo(orderId);
      if (cancellation.cancelState === 'unavailable') {
        toast(t('dispatch.yandex.cancelUnavailable'), 'error');
        return;
      }
      const paid = ['paid', 'minimal'].includes(cancellation.cancelState);
      if (paid && !canCreateYandex) {
        toast(t('dispatch.yandex.paidCancelRequiresManager'), 'error');
        return;
      }
      const prompt = paid
        ? cancellation.price == null
          ? t('dispatch.yandex.cancelUnknownPrice', {
              title: cancellation.title || t('dispatch.yandex.cancelMayBePaid'),
              message: cancellation.message || t('dispatch.yandex.cancelUnknownPriceFallback'),
            })
          : t('dispatch.yandex.cancelPaidPrice', {
              price: formatNumber(cancellation.price),
            })
        : t('dispatch.yandex.cancelFreePrompt');
      if (
        !(await confirm({
          title: t('dispatch.yandex.cancelTitle'),
          body: prompt,
          confirmLabel: t('dispatch.yandex.cancelConfirm'),
          destructive: true,
        }))
      ) {
        return;
      }
      await api.cancelYandexDelivery(orderId, paid);
      toast(paid ? t('dispatch.yandex.cancelPaidSuccess') : t('dispatch.yandex.cancelFreeSuccess'));
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('dispatch.yandex.cancelError'), 'error');
    } finally {
      setSaving('');
    }
  };

  const resolveYandexItems = async (
    orderId: string,
    delivery: ExternalDelivery,
    resolution: YandexItemsResolution,
  ) => {
    if (saving || !canCreateYandex) return;
    setSaving(`${orderId}:resolve-${resolution}`);
    try {
      const enteredReason = window.prompt(
        t(`dispatch.yandex.itemsResolution.${resolution}.reasonPrompt`),
      );
      if (enteredReason === null) return;
      const reason = enteredReason.trim();
      if (!reason) {
        toast(t('dispatch.yandex.itemsResolution.reasonRequired'), 'error');
        return;
      }
      if (reason.length > 240) {
        toast(t('dispatch.yandex.itemsResolution.reasonTooLong'), 'error');
        return;
      }
      const accepted = await confirm({
        title: t(`dispatch.yandex.itemsResolution.${resolution}.confirmTitle`),
        body: t(`dispatch.yandex.itemsResolution.${resolution}.confirmBody`, { reason }),
        confirmLabel: t(`dispatch.yandex.itemsResolution.${resolution}.confirmLabel`),
        destructive: resolution === 'returned',
      });
      if (!accepted) return;
      await api.resolveYandexDeliveryItems(orderId, {
        deliveryJobId: delivery.id,
        resolution,
        reason,
      });
      toast(t(`dispatch.yandex.itemsResolution.${resolution}.success`));
      await load(true);
    } catch (caught) {
      toast(
        caught instanceof Error ? caught.message : t('dispatch.yandex.itemsResolution.actionError'),
        'error',
      );
    } finally {
      setSaving('');
    }
  };

  const resolveYandexCreate = async (
    orderId: string,
    delivery: ExternalDelivery,
    resolution: YandexCreateResolution,
  ) => {
    if (saving || !canReconcileYandexCreate) return;
    const action = resolution === 'attach' ? 'reconcile-attach' : 'reconcile-not-created';
    setSaving(`${orderId}:${action}`);
    try {
      let externalOrderId: string | undefined;
      if (resolution === 'attach') {
        const enteredExternalOrderId = window.prompt(
          t('dispatch.yandex.createReconciliation.attach.externalOrderIdPrompt'),
        );
        if (enteredExternalOrderId === null) return;
        externalOrderId = enteredExternalOrderId.trim();
        if (!/^[0-9A-Za-z._:-]{1,160}$/.test(externalOrderId)) {
          toast(t('dispatch.yandex.createReconciliation.externalOrderIdInvalid'), 'error');
          return;
        }
      }

      const enteredReason = window.prompt(
        t(`dispatch.yandex.createReconciliation.${resolution}.reasonPrompt`),
      );
      if (enteredReason === null) return;
      const reason = enteredReason.trim();
      if (!reason) {
        toast(t('dispatch.yandex.createReconciliation.reasonRequired'), 'error');
        return;
      }
      if (reason.length > 240) {
        toast(t('dispatch.yandex.createReconciliation.reasonTooLong'), 'error');
        return;
      }

      const accepted = await confirm({
        title: t(`dispatch.yandex.createReconciliation.${resolution}.confirmTitle`),
        body: t(`dispatch.yandex.createReconciliation.${resolution}.confirmBody`, {
          externalOrderId: externalOrderId || '',
          reason,
        }),
        confirmLabel: t(`dispatch.yandex.createReconciliation.${resolution}.confirmLabel`),
        destructive: resolution === 'not_created',
      });
      if (!accepted) return;

      await api.resolveYandexCreateReconciliation(orderId, {
        deliveryJobId: delivery.id,
        resolution,
        ...(externalOrderId ? { externalOrderId } : {}),
        reason,
      });
      toast(t(`dispatch.yandex.createReconciliation.${resolution}.success`));
      await load(true);
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : t('dispatch.yandex.createReconciliation.actionError'),
        'error',
      );
    } finally {
      setSaving('');
    }
  };

  const setAvailability = async (courierId: string, status: string) => {
    if (saving) return;
    setSaving(courierId);
    try {
      await api.setCourierAvailability(courierId, status);
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('dispatch.statusError'), 'error');
    } finally {
      setSaving('');
    }
  };

  const activeCouriers = useMemo(
    () => couriers.filter((courier) => courier.availabilityStatus !== 'offline').length,
    [couriers],
  );
  if (loading && !couriers.length && !orders.length) return <PageState type="loading" />;
  if (error && !couriers.length && !orders.length)
    return <PageState type="error" description={error} onRetry={load} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('dispatch.heading')}</h2>
          <p className="page-help">{t('dispatch.intro')}</p>
        </div>
        <button
          className="btn-outline px-5 inline-flex items-center gap-2"
          type="button"
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" size={17} />
          {t('common.refresh')}
        </button>
      </div>
      {yandexConfig && !yandexConfig.configured && (
        <div className="inline-alert inline-alert-warning" role="status">
          {t('dispatch.yandex.notConfigured', {
            provider: yandexConfig.providerLabel || t('dispatch.yandex.cargoProvider'),
            missing: yandexConfig.missing.join(', '),
          })}
        </div>
      )}
      <section className="ops-metrics-grid">
        <article className="card metric-card">
          <p>{t('dispatch.onShift')}</p>
          <strong>{activeCouriers}</strong>
          <small>{t('dispatch.courierTotal', { count: couriers.length })}</small>
        </article>
        <article className="card metric-card">
          <p>{t('dispatch.activeDeliveries')}</p>
          <strong>{orders.length}</strong>
          <small>
            {t('dispatch.unassignedTotal', {
              count: orders.filter((order) => !order.courierId).length,
            })}
          </small>
        </article>
        <article className="card metric-card">
          <p>{t('dispatch.averageEta')}</p>
          <strong>
            {t('dispatch.minutesValue', {
              count: orders.length
                ? Math.round(
                    orders.reduce((sum, order) => sum + Number(order.routeEtaMinutes || 0), 0) /
                      orders.length,
                  )
                : 0,
            })}
          </strong>
          <small>{t('dispatch.currentRoutes')}</small>
        </article>
      </section>
      <section className="card dispatch-map-card">
        <DispatchMap couriers={couriers} orders={orders} />
      </section>
      <div className="operations-split">
        <section className="card ops-panel">
          <div className="section-heading">
            <h2>{t('dispatch.couriers')}</h2>
            <p>{t('dispatch.locationFreshness')}</p>
          </div>
          <div className="ops-list">
            {couriers.length === 0 ? (
              <PageState compact type="empty" title={t('dispatch.noCouriers')} />
            ) : (
              couriers.map((courier) => (
                <article className="ops-row" key={courier.id}>
                  <div className="ops-row-icon">
                    <Bike aria-hidden="true" size={19} />
                  </div>
                  <div className="ops-row-copy">
                    <strong>{courier.name}</strong>
                    <span>
                      {t(`couriers.transport.${courier.transportType || 'car'}`)}
                      {' · '}
                      {courier.vehicle || courier.phone}
                    </span>
                    <small>
                      {courier.latitude == null
                        ? t('dispatch.noLocation')
                        : t('dispatch.courierOrders', {
                            active: courier.activeOrders,
                            max: courier.maxActiveOrders,
                            updated: courier.locationUpdatedAt
                              ? formatDate(courier.locationUpdatedAt)
                              : t('dispatch.timeUnknown'),
                          })}
                    </small>
                  </div>
                  <SelectControl
                    compact
                    ariaLabel={t('dispatch.courierStatusLabel', { name: courier.name })}
                    className="compact-select"
                    value={courier.availabilityStatus || 'offline'}
                    disabled={saving === courier.id}
                    onChange={(value) => void setAvailability(courier.id, value)}
                    options={availabilityStatuses.map((value) => ({
                      value,
                      label: t(`dispatch.availability.${value}`),
                    }))}
                  />
                </article>
              ))
            )}
          </div>
        </section>
        <section className="card ops-panel">
          <div className="section-heading">
            <h2>{t('dispatch.deliveries')}</h2>
            <p>{t('dispatch.routeHint')}</p>
          </div>
          <div className="ops-list">
            {orders.length === 0 ? (
              <PageState compact type="empty" title={t('dispatch.noDeliveries')} />
            ) : (
              orders.map((order) => {
                const routeUrl =
                  order.branchLatitude != null && order.deliveryLatitude != null
                    ? `https://yandex.kz/maps/?rtext=${order.branchLatitude},${order.branchLongitude}~${order.deliveryLatitude},${order.deliveryLongitude}&rtt=auto`
                    : '';
                const external = order.externalDelivery;
                const createReconciliationRequired = Boolean(
                  external?.apiFamily === 'business_v2' &&
                    (external.createReconciliationExhausted ||
                      external.status === 'creating_exhausted'),
                );
                const hasReservedYandex = Boolean(
                  external &&
                    !external.terminal &&
                    (external.active || createReconciliationRequired),
                );
                const hasActiveYandex = Boolean(
                  hasReservedYandex && !['draft', 'quoted'].includes(external?.status || ''),
                );
                const busy = saving.startsWith(`${order.id}:`);
                const quotePrice = external?.price ?? external?.quotedPrice;
                const businessMode =
                  external?.apiFamily === 'business_v2' ||
                  (!external && yandexConfig?.apiMode === 'business_v2');
                const quoteExpiresAtMs = external?.quoteExpiresAt
                  ? new Date(external.quoteExpiresAt).getTime()
                  : Number.NaN;
                const quoteRemainingSeconds = Number.isFinite(quoteExpiresAtMs)
                  ? Math.max(0, Math.ceil((quoteExpiresAtMs - nowMs) / 1_000))
                  : 0;
                const quoteCountdown = `${String(Math.floor(quoteRemainingSeconds / 60)).padStart(2, '0')}:${String(quoteRemainingSeconds % 60).padStart(2, '0')}`;
                const businessQuoteReady = Boolean(
                  external?.apiFamily === 'business_v2' &&
                  external.fixedPrice === true &&
                  Number(external.quotedPrice) > 0 &&
                  quoteRemainingSeconds > 0,
                );
                const kitchenAccepted = Boolean(
                  order.courierDispatchRequestedAt ||
                  ['preparing', 'ready', 'handed_over'].includes(
                    String(order.kitchenStatus || 'queued'),
                  ),
                );
                const requestDisabledReason = !kitchenAccepted
                  ? t('dispatch.yandex.kitchenRequired')
                  : businessMode && yandexConfig?.restaurantDeliveryConfirmed !== true
                    ? t('dispatch.yandex.restaurantApprovalRequired')
                    : businessMode && yandexConfig?.dispatchReady === false
                      ? t('dispatch.yandex.operationalAlertsRequired')
                    : businessMode && !businessQuoteReady
                      ? external?.apiFamily === 'business_v2' &&
                        external.fixedPrice === true &&
                        Number(external.quotedPrice) > 0 &&
                        quoteRemainingSeconds <= 0
                        ? t('dispatch.yandex.quoteExpired')
                        : t('dispatch.yandex.fixedQuoteRequired')
                      : '';
                const requestDisabledReasonId = `yandex-request-disabled-${order.id}`;
                const itemsResolutionRequired = Boolean(
                  external?.apiFamily === 'business_v2' &&
                  (external.itemsResolutionRequired ||
                    [
                      'cancelled_items_unresolved',
                      'items_resolution_returned',
                      'items_resolution_delivered',
                    ].includes(external.status)),
                );
                const resolutionInProgress = external?.status.startsWith('items_resolution_');
                const itemsResolutionHintId = `yandex-items-resolution-${order.id}`;
                const createReconciliationHintId = `yandex-create-reconciliation-${order.id}`;
                return (
                  <article className="ops-row ops-order-row" key={order.id}>
                    <div className="ops-row-icon">
                      <Navigation aria-hidden="true" size={19} />
                    </div>
                    <div className="ops-row-copy">
                      <strong>
                        №{order.number} · {formatNumber(order.amount)} ₸
                      </strong>
                      <span>
                        {deliveryAddressText(order.deliveryAddress) || t('dispatch.addressMissing')}
                      </span>
                      <small>
                        <Route aria-hidden="true" size={13} /> {order.routeDistanceKm ?? '—'}{' '}
                        {t('dispatch.kilometers')}
                        {' · '}
                        <Clock3 aria-hidden="true" size={13} />{' '}
                        {external?.etaMinutes ?? order.routeEtaMinutes ?? '—'}{' '}
                        {t('dispatch.minutes')}
                      </small>
                      {external && (
                        <small className="external-delivery-summary">
                          {external.apiFamily === 'business_v2'
                            ? t('dispatch.yandex.businessProvider')
                            : t('dispatch.yandex.cargoProvider')}
                          : {external.statusLabel}
                          {quotePrice != null ? ` · ${formatNumber(quotePrice)} ₸` : ''}
                          {external.courier?.name ? ` · ${external.courier.name}` : ''}
                          {external.courier?.isAutomobile === true
                            ? ` · ${t('dispatch.yandex.carCourier')}`
                            : ''}
                          {external.courier?.vehicle ? ` · ${external.courier.vehicle}` : ''}
                        </small>
                      )}
                      {external?.apiFamily === 'business_v2' &&
                        external.fixedPrice === true &&
                        Number(external.quotedPrice) > 0 &&
                        external.quoteExpiresAt && (
                          <small className="external-delivery-summary tabular-nums">
                            {quoteRemainingSeconds > 0
                              ? t('dispatch.yandex.quoteCountdown', { time: quoteCountdown })
                              : t('dispatch.yandex.quoteExpiredShort')}
                          </small>
                        )}
                      {external?.transportWarning && (
                        <small className="external-delivery-error">
                          {external.transportWarning}
                        </small>
                      )}
                      {external?.lastError && (
                        <small className="external-delivery-error">{external.lastError}</small>
                      )}
                      {itemsResolutionRequired && (
                        <small
                          className="external-delivery-resolution-alert"
                          id={itemsResolutionHintId}
                          role="alert"
                        >
                          {t('dispatch.yandex.itemsResolution.required')}
                        </small>
                      )}
                      {createReconciliationRequired && (
                        <small
                          className="external-delivery-resolution-alert"
                          id={createReconciliationHintId}
                          role="alert"
                        >
                          {t('dispatch.yandex.createReconciliation.required')}
                          {!canReconcileYandexCreate
                            ? ` ${t('dispatch.yandex.createReconciliation.ownerRequired')}`
                            : ''}
                        </small>
                      )}
                      {!kitchenAccepted && (
                        <small className="external-delivery-summary">
                          {t('dispatch.yandex.kitchenRequired')}
                        </small>
                      )}
                      {order.courierDispatchError && (
                        <small className="external-delivery-error">
                          {t('dispatch.yandex.dispatchErrorPrefix', {
                            error: order.courierDispatchError,
                          })}
                        </small>
                      )}
                    </div>
                    <div className="row-actions">
                      {routeUrl && (
                        <a
                          href={routeUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="icon-button icon-button-sm"
                          aria-label={t('dispatch.openRoute')}
                          title={t('dispatch.openRoute')}
                        >
                          <ExternalLink aria-hidden="true" size={16} />
                        </a>
                      )}
                      {external?.trackingUrl && (
                        <a
                          href={external.trackingUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="btn-outline compact-button"
                        >
                          {t('dispatch.yandex.track')}
                        </a>
                      )}
                      {hasActiveYandex ? (
                        <>
                          <span className="status-pill status-info">{external?.statusLabel}</span>
                          {canQuoteYandex && !createReconciliationRequired && (
                            <button
                              type="button"
                              className="icon-button icon-button-sm"
                              disabled={Boolean(saving)}
                              onClick={() => void syncYandex(order.id)}
                              aria-label={t('dispatch.yandex.syncLabel')}
                              title={t('dispatch.yandex.syncLabel')}
                            >
                              {saving === `${order.id}:sync` ? (
                                <LoaderCircle aria-hidden="true" className="spin" size={15} />
                              ) : (
                                <RotateCw aria-hidden="true" size={15} />
                              )}
                            </button>
                          )}
                          {canQuoteYandex && external?.canCancel && (
                            <button
                              type="button"
                              className="icon-button icon-button-sm icon-button-danger"
                              disabled={Boolean(saving)}
                              onClick={() => void cancelYandex(order.id)}
                              aria-label={t('dispatch.yandex.cancelLabel')}
                              title={t('dispatch.yandex.cancelLabel')}
                            >
                              {saving === `${order.id}:cancel` ? (
                                <LoaderCircle aria-hidden="true" className="spin" size={15} />
                              ) : (
                                <X aria-hidden="true" size={15} />
                              )}
                            </button>
                          )}
                          {itemsResolutionRequired &&
                            !resolutionInProgress &&
                            canCreateYandex &&
                            external && (
                              <>
                                <button
                                  type="button"
                                  className="btn-outline compact-button danger-outline"
                                  disabled={Boolean(saving)}
                                  aria-describedby={itemsResolutionHintId}
                                  onClick={() =>
                                    void resolveYandexItems(order.id, external, 'returned')
                                  }
                                >
                                  {saving === `${order.id}:resolve-returned` ? (
                                    <LoaderCircle aria-hidden="true" className="spin" size={15} />
                                  ) : (
                                    <Undo2 aria-hidden="true" size={15} />
                                  )}
                                  {t('dispatch.yandex.itemsResolution.returned.action')}
                                </button>
                                <button
                                  type="button"
                                  className="btn-classic compact-button"
                                  disabled={Boolean(saving)}
                                  aria-describedby={itemsResolutionHintId}
                                  onClick={() =>
                                    void resolveYandexItems(order.id, external, 'delivered')
                                  }
                                >
                                  {saving === `${order.id}:resolve-delivered` ? (
                                    <LoaderCircle aria-hidden="true" className="spin" size={15} />
                                  ) : (
                                    <PackageCheck aria-hidden="true" size={15} />
                                  )}
                                  {t('dispatch.yandex.itemsResolution.delivered.action')}
                                </button>
                              </>
                            )}
                          {createReconciliationRequired && canReconcileYandexCreate && external && (
                            <>
                              <button
                                type="button"
                                className="btn-outline compact-button"
                                disabled={Boolean(saving)}
                                aria-busy={saving === `${order.id}:reconcile-attach`}
                                aria-describedby={createReconciliationHintId}
                                onClick={() =>
                                  void resolveYandexCreate(order.id, external, 'attach')
                                }
                              >
                                {saving === `${order.id}:reconcile-attach` ? (
                                  <LoaderCircle aria-hidden="true" className="spin" size={15} />
                                ) : (
                                  <Link2 aria-hidden="true" size={15} />
                                )}
                                {t('dispatch.yandex.createReconciliation.attach.action')}
                              </button>
                              <button
                                type="button"
                                className="btn-danger compact-button"
                                disabled={Boolean(saving)}
                                aria-busy={saving === `${order.id}:reconcile-not-created`}
                                aria-describedby={createReconciliationHintId}
                                onClick={() =>
                                  void resolveYandexCreate(order.id, external, 'not_created')
                                }
                              >
                                {saving === `${order.id}:reconcile-not-created` ? (
                                  <LoaderCircle aria-hidden="true" className="spin" size={15} />
                                ) : (
                                  <CircleOff aria-hidden="true" size={15} />
                                )}
                                {t('dispatch.yandex.createReconciliation.not_created.action')}
                              </button>
                            </>
                          )}
                        </>
                      ) : !order.courierId &&
                        (yandexConfig?.configured || Boolean(external)) &&
                        canQuoteYandex ? (
                        <>
                          <button
                            type="button"
                            className="btn-outline compact-button"
                            disabled={Boolean(saving)}
                            onClick={() => void quoteYandex(order.id)}
                          >
                            {saving === `${order.id}:quote` ? (
                              <LoaderCircle aria-hidden="true" className="spin" size={15} />
                            ) : (
                              <Calculator aria-hidden="true" size={15} />
                            )}
                            {t('dispatch.yandex.quoteAction')}
                          </button>
                          {canCreateYandex && (
                            <>
                              <button
                                type="button"
                                className="btn-classic compact-button"
                                disabled={Boolean(saving) || Boolean(requestDisabledReason)}
                                aria-describedby={
                                  requestDisabledReason ? requestDisabledReasonId : undefined
                                }
                                title={requestDisabledReason || undefined}
                                onClick={() => void requestYandex(order.id, external || null)}
                              >
                                {saving === `${order.id}:request` ? (
                                  <LoaderCircle aria-hidden="true" className="spin" size={15} />
                                ) : (
                                  <Send aria-hidden="true" size={15} />
                                )}
                                {quotePrice != null
                                  ? t('dispatch.yandex.requestWithPrice', {
                                      price: formatNumber(quotePrice),
                                    })
                                  : t('dispatch.yandex.requestAction')}
                              </button>
                              {requestDisabledReason && (
                                <span className="sr-only" id={requestDisabledReasonId}>
                                  {requestDisabledReason}
                                </span>
                              )}
                            </>
                          )}
                          {external?.canCancel && (
                            <button
                              type="button"
                              className="icon-button icon-button-sm icon-button-danger"
                              disabled={Boolean(saving)}
                              onClick={() => void cancelYandex(order.id)}
                              aria-label={t('dispatch.yandex.cancelLabel')}
                              title={t('dispatch.yandex.cancelLabel')}
                            >
                              {saving === `${order.id}:cancel` ? (
                                <LoaderCircle aria-hidden="true" className="spin" size={15} />
                              ) : (
                                <X aria-hidden="true" size={15} />
                              )}
                            </button>
                          )}
                        </>
                      ) : null}
                      {!order.courierId && !hasReservedYandex && (
                        <button
                          type="button"
                          className="btn-outline compact-button"
                          disabled={Boolean(saving) || !kitchenAccepted}
                          onClick={() => void assign(order.id)}
                        >
                          {saving === `${order.id}:own` ? (
                            <LoaderCircle aria-hidden="true" className="spin" size={15} />
                          ) : (
                            <MapPin aria-hidden="true" size={15} />
                          )}
                          {t('dispatch.assign')}
                        </button>
                      )}
                      {order.courierId && (
                        <span className="status-pill status-active">{t('dispatch.assigned')}</span>
                      )}
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

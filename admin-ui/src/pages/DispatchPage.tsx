import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Bike,
  Calculator,
  Clock3,
  ExternalLink,
  LoaderCircle,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  RotateCw,
  Send,
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
      toast(caught instanceof Error ? caught.message : 'Не удалось выполнить действие', 'error');
    } finally {
      setSaving('');
    }
  };

  const quoteYandex = (orderId: string) =>
    runYandexAction(
      orderId,
      'quote',
      () => api.quoteYandexDelivery(orderId),
      'Стоимость доставки рассчитана',
    );

  const requestYandex = (orderId: string) =>
    runYandexAction(
      orderId,
      'request',
      () => api.requestYandexDelivery(orderId),
      'Заявка передана в Яндекс.Доставку',
    );

  const syncYandex = (orderId: string) =>
    runYandexAction(
      orderId,
      'sync',
      () => api.syncYandexDelivery(orderId),
      'Статус доставки обновлён',
    );

  const cancelYandex = async (orderId: string) => {
    if (saving) return;
    setSaving(`${orderId}:cancel`);
    try {
      const { cancellation } = await api.getYandexCancellationInfo(orderId);
      if (cancellation.cancelState === 'unavailable') {
        toast('Курьер уже забрал заказ. Обратитесь в поддержку Яндекса.', 'error');
        return;
      }
      const paid = cancellation.cancelState === 'paid';
      const prompt = paid
        ? `Яндекс удержит ${formatNumber(cancellation.price)} ₸ за отмену. Всё равно отменить?`
        : 'Отменить вызов курьера Яндекс.Доставки?';
      if (
        !(await confirm({
          title: 'Отмена Яндекс.Доставки',
          body: prompt,
          confirmLabel: 'Отменить доставку',
          destructive: true,
        }))
      ) {
        return;
      }
      await api.cancelYandexDelivery(orderId, paid);
      toast(paid ? 'Платная отмена подтверждена' : 'Заявка Яндекс.Доставки отменена');
      await load(true);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось отменить доставку', 'error');
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
          Яндекс.Доставка пока недоступна. Заполните на VPS: {yandexConfig.missing.join(', ')}.
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
                const hasActiveYandex = Boolean(external?.claimId && !external.terminal);
                const busy = saving.startsWith(`${order.id}:`);
                const quotePrice = external?.price ?? external?.quotedPrice;
                const kitchenAccepted = Boolean(
                  order.courierDispatchRequestedAt ||
                  ['preparing', 'ready', 'handed_over'].includes(
                    String(order.kitchenStatus || 'queued'),
                  ),
                );
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
                          Яндекс: {external.statusLabel}
                          {quotePrice != null ? ` · ${formatNumber(quotePrice)} ₸` : ''}
                          {external.courier?.name ? ` · ${external.courier.name}` : ''}
                          {external.courier?.isAutomobile === true ? ' · Автокурьер' : ''}
                          {external.courier?.vehicle ? ` · ${external.courier.vehicle}` : ''}
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
                      {!kitchenAccepted && (
                        <small className="external-delivery-summary">
                          Курьер не вызван — сначала примите заказ на кухне.
                        </small>
                      )}
                      {order.courierDispatchError && (
                        <small className="external-delivery-error">
                          Вызов курьера: {order.courierDispatchError}
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
                          Отследить
                        </a>
                      )}
                      {hasActiveYandex ? (
                        <>
                          <span className="status-pill status-info">{external?.statusLabel}</span>
                          <button
                            type="button"
                            className="icon-button icon-button-sm"
                            disabled={Boolean(saving)}
                            onClick={() => void syncYandex(order.id)}
                            aria-label="Обновить статус Яндекс.Доставки"
                            title="Обновить статус Яндекс.Доставки"
                          >
                            {saving === `${order.id}:sync` ? (
                              <LoaderCircle aria-hidden="true" className="spin" size={15} />
                            ) : (
                              <RotateCw aria-hidden="true" size={15} />
                            )}
                          </button>
                          {external?.canCancel && (
                            <button
                              type="button"
                              className="icon-button icon-button-sm icon-button-danger"
                              disabled={Boolean(saving)}
                              onClick={() => void cancelYandex(order.id)}
                              aria-label="Отменить Яндекс.Доставку"
                              title="Отменить Яндекс.Доставку"
                            >
                              {saving === `${order.id}:cancel` ? (
                                <LoaderCircle aria-hidden="true" className="spin" size={15} />
                              ) : (
                                <X aria-hidden="true" size={15} />
                              )}
                            </button>
                          )}
                        </>
                      ) : !order.courierId && yandexConfig?.configured && yandexConfig.canManage ? (
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
                            Цена
                          </button>
                          <button
                            type="button"
                            className="btn-classic compact-button"
                            disabled={Boolean(saving) || !kitchenAccepted}
                            onClick={() => void requestYandex(order.id)}
                          >
                            {saving === `${order.id}:request` ? (
                              <LoaderCircle aria-hidden="true" className="spin" size={15} />
                            ) : (
                              <Send aria-hidden="true" size={15} />
                            )}
                            {quotePrice != null
                              ? `Вызвать · ${formatNumber(quotePrice)} ₸`
                              : 'Вызвать Яндекс'}
                          </button>
                        </>
                      ) : null}
                      {!order.courierId && !hasActiveYandex && (
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

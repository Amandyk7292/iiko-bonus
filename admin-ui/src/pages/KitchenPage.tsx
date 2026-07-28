import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { CheckCircle2, ChefHat, Clock3, LoaderCircle, PackageCheck, RefreshCw } from 'lucide-react';
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

const elapsedMinutes = (value?: string | null) => {
  if (!value) return null;
  return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60_000));
};

export default function KitchenPage() {
  const { formatDate, t } = useI18n();
  const { toast } = useFeedback();
  const [orders, setOrders] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [preparationOrder, setPreparationOrder] = useState<any | null>(null);
  const [preparationMinutes, setPreparationMinutes] = useState('30');
  const [, setTick] = useState(0);

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

  const persistUpdate = async (order: any, next: string, minutes?: number) => {
    setSaving(order.id);
    try {
      await api.updateKitchenStatus(order.id, next, minutes);
      await load(true);
      return true;
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('kitchen.statusError'), 'error');
      return false;
    } finally {
      setSaving('');
    }
  };

  const update = (order: any, next: string) => {
    if (next === 'preparing') {
      setPreparationOrder(order);
      setPreparationMinutes(String(order.preparationMinutes || 30));
      return;
    }
    void persistUpdate(order, next);
  };

  const submitPreparation = async (event: FormEvent) => {
    event.preventDefault();
    if (!preparationOrder || saving) return;
    const minutes = Number(preparationMinutes);
    if (!Number.isFinite(minutes) || minutes < 1 || minutes > 240) return;
    if (await persistUpdate(preparationOrder, 'preparing', minutes)) {
      setPreparationOrder(null);
    }
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
  if (error && !orders.length) return <PageState type="error" description={error} onRetry={load} />;

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
                          className="btn-classic kitchen-action"
                          type="button"
                          disabled={Boolean(saving)}
                          onClick={() => update(order, column.next)}
                        >
                          {saving === order.id ? (
                            <LoaderCircle aria-hidden="true" className="spin" size={17} />
                          ) : (
                            <PackageCheck aria-hidden="true" size={17} />
                          )}
                          {t(column.actionKey)}
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
        onClose={() => !saving && setPreparationOrder(null)}
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
              autoFocus
            />
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={() => setPreparationOrder(null)}
              disabled={Boolean(saving)}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-classic px-5 inline-flex items-center gap-2"
              disabled={Boolean(saving)}
            >
              {saving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t('kitchen.actionStart')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

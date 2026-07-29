import { useCallback, useEffect, useMemo, useState } from 'react';
import { LoaderCircle, RefreshCw, Save, Search, Warehouse } from 'lucide-react';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api, type InventoryItem } from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { canMutateInventory } from '../lib/admin-permissions';
import { useI18n } from '../lib/i18n';
import { useSearchParams } from '../lib/router';

type Draft = { quantity: string; stopped: boolean };

const cleanIntegerDraft = (value: string) => value.replace(/^0+(?=\d)/, '');

export default function InventoryPage({ role = 'viewer' }: { role?: string }) {
  const { t, formatDate } = useI18n();
  const { toast } = useFeedback();
  const inventoryMutationsAllowed = canMutateInventory(role);
  const [params, setParams] = useSearchParams();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [branches, setBranches] = useState<Array<{ id: string; name: string; active: boolean }>>(
    [],
  );
  const branchId = params.get('branch') || '';
  const [search, setSearch] = useState(params.get('search') || '');
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [savingId, setSavingId] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const [inventory, locations] = await Promise.all([
          api.getInventory(branchId),
          api.getFulfillmentLocations(),
        ]);
        setItems(inventory.inventory ?? []);
        setBranches(
          (locations.locations ?? []).map((location) => ({
            id: String(location.id),
            name: String(location.name),
            active: location.active !== false,
          })),
        );
        setDrafts(
          Object.fromEntries(
            (inventory.inventory ?? []).map((item) => [
              `${item.branch_id}:${item.product_id}`,
              {
                quantity: item.source_quantity == null ? '' : String(item.source_quantity),
                stopped: item.manual_stop,
              },
            ]),
          ),
        );
        setError('');
      } catch (caught) {
        if (!silent) setError(caught instanceof Error ? caught.message : t('common.loadError'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [branchId, t],
  );

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (search.trim()) next.set('search', search.trim());
      else next.delete('search');
      setParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [search, setParams]);
  useAdminRealtimeEvents(
    ['menu.updated'],
    () => document.visibilityState === 'visible' && void load(true),
    [load],
  );

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visibleItems = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return needle
      ? items.filter((item) =>
          `${item.product_name} ${item.product_id}`.toLocaleLowerCase().includes(needle),
        )
      : items;
  }, [items, search]);

  const setDraft = (item: InventoryItem, patch: Partial<Draft>) => {
    const key = `${item.branch_id}:${item.product_id}`;
    setDrafts((current) => ({
      ...current,
      [key]: { ...(current[key] ?? { quantity: '', stopped: false }), ...patch },
    }));
  };

  const save = async (item: InventoryItem) => {
    if (!inventoryMutationsAllowed) return;
    const key = `${item.branch_id}:${item.product_id}`;
    const draft = drafts[key];
    if (!draft || savingId) return;
    const quantity = draft.quantity.trim() === '' ? null : Number(draft.quantity);
    if (quantity != null && (!Number.isInteger(quantity) || quantity < 0 || quantity > 100000)) {
      toast(t('inventory.quantityInvalid'), 'error');
      return;
    }
    setSavingId(key);
    try {
      const result = await api.updateInventory(item.branch_id, item.product_id, {
        productName: item.product_name,
        sourceQuantity: quantity,
        manualStop: draft.stopped,
      });
      setItems((current) =>
        current.map((value) =>
          value.branch_id === item.branch_id && value.product_id === item.product_id
            ? result.inventory
            : value,
        ),
      );
      toast(t('inventory.saved'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setSavingId('');
    }
  };

  const sync = async () => {
    if (!inventoryMutationsAllowed || syncing) return;
    setSyncing(true);
    try {
      await api.syncInventory();
      await load(true);
      toast(t('inventory.synced'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    } finally {
      setSyncing(false);
    }
  };

  if (loading && items.length === 0) return <PageState type="loading" />;
  if (error && items.length === 0)
    return <PageState type="error" description={error} onRetry={() => load()} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('inventory.heading')}</h2>
          <p className="page-help">{t('inventory.intro')}</p>
        </div>
        {inventoryMutationsAllowed && (
          <button
            type="button"
            className="btn-classic px-5 inline-flex items-center gap-2"
            onClick={sync}
            disabled={syncing}
          >
            {syncing ? (
              <LoaderCircle className="spin" size={17} aria-hidden="true" />
            ) : (
              <RefreshCw aria-hidden="true" size={17} />
            )}
            {syncing ? t('inventory.syncing') : t('inventory.sync')}
          </button>
        )}
      </div>
      {!inventoryMutationsAllowed && (
        <div className="inline-alert inline-alert-info" role="status">
          {t('inventory.readOnly')}
        </div>
      )}
      {error && (
        <div className="inline-alert inline-alert-error" role="alert">
          {error}
        </div>
      )}
      <section className="sagi-filter inventory-filter">
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="inventory-search">
            {t('common.search')}
          </label>
          <div className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input
              id="inventory-search"
              name="inventorySearch"
              className="input-classic"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('inventory.search')}
              autoComplete="off"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="inventory-branch">
            {t('inventory.branch')}
          </label>
          <SelectControl
            id="inventory-branch"
            value={branchId}
            onChange={(value) => {
              const next = new URLSearchParams(params);
              if (value) next.set('branch', value);
              else next.delete('branch');
              setParams(next);
            }}
            options={[
              { value: '', label: t('inventory.allBranches') },
              ...branches.map((branch) => ({
                value: branch.id,
                label: `${branch.name}${branch.active ? '' : ` · ${t('common.inactive')}`}`,
              })),
            ]}
          />
        </div>
      </section>
      {visibleItems.length === 0 ? (
        <PageState
          type="empty"
          title={t('inventory.empty')}
          description={t('inventory.emptyHint')}
        />
      ) : (
        <section className="card table-card">
          <div className="responsive-table-wrap">
            <table className="data-table inventory-table">
              <thead>
                <tr>
                  <th>{t('inventory.product')}</th>
                  <th>{t('inventory.branch')}</th>
                  <th>{t('inventory.quantity')}</th>
                  <th>{t('inventory.stop')}</th>
                  <th>{t('inventory.source')}</th>
                  <th className="text-right">{t('common.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const key = `${item.branch_id}:${item.product_id}`;
                  const draft = drafts[key] ?? {
                    quantity: '',
                    stopped: item.manual_stop,
                  };
                  return (
                    <tr key={key}>
                      <td data-label={t('inventory.product')}>
                        <strong>{item.product_name || item.product_id}</strong>
                        <small className="table-secondary">{item.product_id}</small>
                      </td>
                      <td data-label={t('inventory.branch')}>
                        {item.bulka_locations?.name ||
                          branches.find((branch) => branch.id === item.branch_id)?.name ||
                          '—'}
                      </td>
                      <td data-label={t('inventory.quantity')}>
                        <input
                          className="input-classic inventory-number"
                          type="number"
                          min="0"
                          max="100000"
                          step="1"
                          inputMode="numeric"
                          name={`inventoryQuantity-${item.branch_id}-${item.product_id}`}
                          value={draft.quantity}
                          disabled={!inventoryMutationsAllowed}
                          onChange={(event) =>
                            setDraft(item, { quantity: cleanIntegerDraft(event.target.value) })
                          }
                          aria-label={t('inventory.quantity')}
                        />
                      </td>
                      <td data-label={t('inventory.stop')}>
                        <label className="switch-row switch-row-compact">
                          <input
                            type="checkbox"
                            checked={draft.stopped}
                            disabled={!inventoryMutationsAllowed}
                            onChange={(event) => setDraft(item, { stopped: event.target.checked })}
                          />
                          <span className="switch-control" aria-hidden="true" />
                          <span>{draft.stopped ? t('common.enabled') : t('common.disabled')}</span>
                        </label>
                      </td>
                      <td data-label={t('inventory.source')}>
                        <span className="status-pill status-info">{item.source || 'admin'}</span>
                        <small className="table-secondary">
                          {item.last_synced_at
                            ? formatDate(item.last_synced_at, {
                                dateStyle: 'short',
                                timeStyle: 'short',
                              })
                            : '—'}
                        </small>
                      </td>
                      <td data-label={t('common.actions')}>
                        <div className="row-actions justify-end">
                          {inventoryMutationsAllowed ? (
                            <button
                              type="button"
                              className="icon-button"
                              onClick={() => void save(item)}
                              disabled={savingId === key}
                              aria-label={t('common.save')}
                            >
                              {savingId === key ? (
                                <LoaderCircle className="spin" size={17} aria-hidden="true" />
                              ) : (
                                <Save aria-hidden="true" size={17} />
                              )}
                            </button>
                          ) : (
                            <span className="table-secondary" aria-label={t('inventory.readOnly')}>
                              —
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
      <div className="inline-alert" role="note">
        <Warehouse aria-hidden="true" size={18} />
        {t('inventory.reservationHint')}
      </div>
    </div>
  );
}

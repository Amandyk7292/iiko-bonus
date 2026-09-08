import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../../lib/i18n';
import { dashboardApi, download } from './api';
import { errorKey, type Report } from './model';
import DataTable from './DataTable';
type Level = { storeId: string; minBalanceLevel: number | null; maxBalanceLevel: number | null };
export default function Balances({
  serverId,
  date,
  refresh,
}: {
  serverId: string;
  date: string;
  refresh: number;
}) {
  const { t } = useI18n();
  const [data, setData] = useState<Awaited<ReturnType<typeof dashboardApi.balances>>>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [filter, setFilter] = useState('all');
  const [store, setStore] = useState('');
  const [group, setGroup] = useState('');
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    setData(undefined);
    setStore('');
    setGroup('');
  }, [serverId, date]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    void dashboardApi
      .balances(serverId, date, controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setData(value);
      })
      .catch((caught) => {
        if (!controller.signal.aborted) setError(errorKey(caught));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [serverId, date, refresh]);
  const report = useMemo<Report | undefined>(() => {
    if (!data) return;
    const products = new Map(data.products.map((product) => [String(product.id), product]));
    const stores = new Map(data.stores.map((item) => [item.id, item.name]));
    const groups = new Map(data.groups.map((item) => [item.id, item.name]));
    const rows = data.rows
      .map((row) => {
        const product = products.get(String(row.product));
        const level = (product?.storeBalanceLevels as Level[] | undefined)?.find(
          (item) => item.storeId === row.store,
        );
        return {
          ...row,
          product: String(product?.name || row.product),
          group: groups.get(String(product?.parent)) || '',
          groupId: String(product?.parent || ''),
          storeId: row.store,
          store: stores.get(String(row.store)) || row.store,
          amount: Number(row.amount),
          sum: row.sum,
          min: level?.minBalanceLevel ?? null,
          max: level?.maxBalanceLevel ?? null,
        };
      })
      .filter(
        (row) =>
          (!store || row.storeId === store) &&
          (!group || row.groupId === group) &&
          (filter === 'negative'
            ? row.amount < 0
            : filter === 'below'
              ? row.min !== null && row.amount < row.min
              : filter === 'above'
                ? row.max !== null && row.amount > row.max
                : true),
      );
    return {
      serverId,
      fetchedAt: data.fetchedAt,
      columns: Object.fromEntries(
        ['product', 'group', 'store', 'quantity', 'amount', 'min', 'max'].map((key) => [
          key === 'quantity' ? 'amount' : key === 'amount' ? 'sum' : key,
          {
            name: t(`id.${key}`),
            type: ['product', 'group', 'store'].includes(key) ? 'STRING' : 'AMOUNT',
          },
        ]),
      ),
      rows,
    };
  }, [data, filter, store, group, serverId, t]);
  const exportStock = async () => {
    setExporting(true);
    setError('');
    try {
      const response = await fetch(
        `/admin/api/iiko-dashboard/balances/export?${new URLSearchParams({ serverId, date, store, group, filter })}`,
        { credentials: 'same-origin', signal: AbortSignal.timeout(90000) },
      );
      if (!response.ok) throw new Error();
      await download(await response.blob(), `iiko-stock-${date}.xlsx`);
    } catch {
      setError('id.error');
    } finally {
      setExporting(false);
    }
  };
  return (
    <section className="card id-panel">
      <div className="id-actions">
        <label>
          <span>{t('id.stockFilter')}</span>
          <select
            aria-label={t('id.stockFilter')}
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          >
            {['all', 'negative', 'below', 'above'].map((value) => (
              <option value={value} key={value}>
                {t(`id.${value === 'all' ? 'allStock' : value}`)}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('id.store')}</span>
          <select
            aria-label={t('id.store')}
            value={store}
            onChange={(event) => setStore(event.target.value)}
          >
            <option value="">—</option>
            {data?.stores.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>{t('id.group')}</span>
          <select
            aria-label={t('id.group')}
            value={group}
            onChange={(event) => setGroup(event.target.value)}
          >
            <option value="">—</option>
            {data?.groups.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={!data || loading || exporting}
          onClick={() => void exportStock()}
        >
          {t('id.export')}
        </button>
      </div>
      {loading && <p role="status">{t('id.loading')}</p>}
      {error && (
        <p className="id-error" role="alert">
          {t(error)}
        </p>
      )}
      {report && <DataTable report={report} />}
    </section>
  );
}

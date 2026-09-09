import { useCallback, useEffect, useRef, useState } from 'react';
import { Package, RefreshCw, Search, Store, X } from 'lucide-react';
import { api } from '../lib/api';
import { useFeedback } from '../components/Feedback';
import PageState from '../components/PageState';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import {
  isCashierProductStopped,
  type CashierCatalog,
  type CashierProduct,
} from '../lib/cashier-catalog';
import '../styles/cashier-catalog.css';

function StockRow({
  product,
  reload,
  frontConnected,
}: {
  product: CashierProduct;
  reload: () => Promise<void>;
  frontConnected: boolean;
}) {
  const { toast, confirm } = useFeedback();
  const [draft, setDraft] = useState<string | null>(null);
  const [baseRevision, setBaseRevision] = useState(product.revision);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [imageFailed, setImageFailed] = useState(false);
  const stale = draft !== null && baseRevision !== product.revision;
  const quantity = draft ?? product.sourceQuantity?.toString() ?? '';
  const valid = /^\d+$/.test(quantity) && Number(quantity) <= 100000;
  const stopped = isCashierProductStopped(product);
  const blocked =
    product.blockedBy === 'iiko'
      ? 'Стоп-лист iiko'
      : product.blockedBy
        ? 'Отключён администратором'
        : '';
  async function save(changes: { sourceQuantity?: number; manualStop?: boolean; useIiko?: true }) {
    setSaving(true);
    setError('');
    try {
      const detail = changes.useIiko
        ? `Использовать остаток iikoFront: ${product.frontQuantity ?? 'не ограничен'}`
        : changes.sourceQuantity !== undefined
          ? `Остаток: ${product.sourceQuantity ?? 'не указан'} → ${changes.sourceQuantity}`
          : changes.manualStop
            ? 'Добавить в стоп-лист'
            : 'Снять со стоп-листа';
      if (
        !(await confirm({
          title: 'Сохранить изменения?',
          body: `${product.name}\n${detail}`,
          confirmLabel: 'Сохранить',
        }))
      )
        return;
      await api.updateCashierProduct(product.id, {
        expectedRevision: draft === null ? product.revision : baseRevision,
        ...changes,
      });
      setDraft(null);
      toast(
        changes.manualStop === true
          ? 'Товар в стоп-листе'
          : changes.manualStop === false
            ? 'Стоп-лист снят'
            : 'Остаток сохранён',
      );
      await reload();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось сохранить');
      await reload();
    } finally {
      setSaving(false);
    }
  }
  return (
    <article
      className={`cashier-stock-row${draft !== null ? ' is-editing' : ''}`}
      aria-label={product.name}
    >
      <div className="cashier-product-info">
        <div className="cashier-product-image">
          {product.imageUrl && !imageFailed ? (
            <img
              src={product.imageUrl}
              alt=""
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <Package size={26} aria-hidden="true" />
          )}
        </div>
        <div className="cashier-product-copy">
          <span className="cashier-category">{product.category || 'Товар'}</span>
          <h2>{product.name}</h2>
          <span className={`cashier-stock-status ${stopped ? 'is-stopped' : ''}`}>
            {blocked ||
              (product.manualStop
                ? 'В стоп-листе'
                : product.availableQuantity === 0
                  ? 'Нет в наличии'
                  : product.availableQuantity == null
                    ? 'Остаток не указан'
                    : `Доступно: ${product.availableQuantity}`)}
          </span>
          {product.stockSource === 'manual' && (
            <span className="cashier-manual-source">Вручную</span>
          )}
        </div>
      </div>
      <div className="cashier-stock-editor">
        <label htmlFor={`stock-${product.id}`}>На точке, шт.</label>
        <div className="cashier-quantity-line">
          <input
            id={`stock-${product.id}`}
            className="input-classic"
            inputMode="numeric"
            type="text"
            aria-label={`Остаток: ${product.name}`}
            title="На точке, шт."
            aria-invalid={draft !== null && !valid}
            value={quantity}
            placeholder="Не указан"
            disabled={saving || !!blocked}
            onChange={(event) => {
              if (draft === null) setBaseRevision(product.revision);
              setDraft(event.target.value);
              setError('');
            }}
          />
          {draft !== null && (
            <>
              <button
                type="button"
                className="btn-classic"
                disabled={saving || !valid || stale}
                onClick={() => void save({ sourceQuantity: Number(quantity) })}
              >
                {saving ? 'Сохраняем…' : 'Сохранить'}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`Сбросить: ${product.name}`}
                disabled={saving}
                onClick={() => {
                  setDraft(null);
                  setError('');
                }}
              >
                <X size={18} />
              </button>
            </>
          )}
        </div>
        <span className="cashier-reserved">В заказах: {product.reserved}</span>
        {product.stockSource === 'manual' && product.isIikoProduct && frontConnected && (
          <button
            type="button"
            className="cashier-follow-iiko"
            disabled={saving || draft !== null}
            onClick={() => void save({ useIiko: true })}
          >
            Вернуть iikoFront
          </button>
        )}
        {stale && (
          <p className="cashier-field-error" role="alert">
            Остаток изменился. Сбросьте ввод и проверьте новое количество.
          </p>
        )}
        {draft !== null && !valid && (
          <p className="cashier-field-error">Целое число от 0 до 100 000</p>
        )}
        {error && (
          <p className="cashier-field-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <label className="cashier-stop-control switch-row">
        <span>Стоп-лист</span>
        <input
          type="checkbox"
          role="switch"
          aria-label={`Стоп-лист: ${product.name}`}
          checked={product.manualStop}
          disabled={saving || draft !== null || !!blocked}
          onChange={(event) => void save({ manualStop: event.target.checked })}
        />
        <span className="switch-control" aria-hidden="true" />
      </label>
    </article>
  );
}

export default function CashierCatalogPage() {
  const [catalog, setCatalog] = useState<CashierCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [category, setCategory] = useState('');
  const running = useRef<Promise<void> | null>(null);
  const pending = useRef(false);
  const alive = useRef(true);
  const load = useCallback((): Promise<void> => {
    pending.current = true;
    if (running.current) return running.current;
    running.current = (async () => {
      while (pending.current && alive.current) {
        pending.current = false;
        try {
          const result = await api.getCashierCatalog();
          if (alive.current) {
            setCatalog(result);
            setError('');
          }
        } catch (caught) {
          if (alive.current)
            setError(caught instanceof Error ? caught.message : 'Не удалось загрузить остатки');
        } finally {
          if (alive.current) setLoading(false);
        }
      }
    })().finally(() => {
      running.current = null;
    });
    return running.current;
  }, []);
  useEffect(() => {
    alive.current = true;
    void load();
    const resume = () => {
      if (!document.hidden) void load();
    };
    const timer = window.setInterval(resume, 30000);
    window.addEventListener('online', resume);
    document.addEventListener('visibilitychange', resume);
    return () => {
      alive.current = false;
      clearInterval(timer);
      window.removeEventListener('online', resume);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [load]);
  useAdminRealtimeEvents(
    ['connected', 'inventory.updated', 'order.updated', 'order.created'],
    () => {
      void load();
    },
  );
  const products = catalog?.products ?? [];
  const counts = {
    all: products.length,
    stopped: products.filter(isCashierProductStopped).length,
    untracked: products.filter((p) => p.sourceQuantity == null).length,
  };
  const categories = [...new Set(products.map((p) => p.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );
  const visible = products.filter(
    (p) =>
      `${p.name} ${p.category}`
        .toLocaleLowerCase('ru')
        .includes(search.trim().toLocaleLowerCase('ru')) &&
      (!category || p.category === category) &&
      (filter === 'all' ||
        (filter === 'stopped' ? isCashierProductStopped(p) : p.sourceQuantity == null)),
  );
  return (
    <div className="page-stack cashier-catalog">
      <div className="cashier-catalog-heading">
        <div>
          <p>
            <Store size={16} aria-hidden="true" />
            {catalog?.branch.address || catalog?.branch.name || 'Моя точка'}
          </p>
        </div>
        <div className="cashier-catalog-actions">
          {catalog?.frontSync?.configured && (
            <span className="cashier-connection">
              {catalog.frontSync.connected ? 'iikoFront подключён' : 'Касса не на связи'}
            </span>
          )}
          <button
            type="button"
            className="btn-outline"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            Обновить
          </button>
        </div>
      </div>
      <div className="cashier-catalog-tools">
        <label className="cashier-search">
          <Search size={19} aria-hidden="true" />
          <input
            aria-label="Поиск товара"
            placeholder="Найти товар"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              className="icon-button"
              type="button"
              aria-label="Очистить поиск"
              onClick={() => setSearch('')}
            >
              <X size={16} />
            </button>
          )}
        </label>
        <select
          className="input-classic cashier-category-filter"
          aria-label="Категория"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="">Все категории</option>
          {categories.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div className="cashier-filters" aria-label="Фильтр товаров">
          {(
            [
              ['all', 'Все'],
              ['stopped', 'Стоп-лист'],
              ['untracked', 'Без остатка'],
            ] as const
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-pressed={filter === key}
              onClick={() => setFilter(key)}
            >
              {label}
              <span>{counts[key]}</span>
            </button>
          ))}
        </div>
      </div>
      {error && catalog && (
        <p role="alert" className="cashier-field-error">
          {error}
        </p>
      )}
      {loading ? (
        <PageState type="loading" />
      ) : !catalog ? (
        <PageState type="error" description={error} onRetry={load} />
      ) : visible.length ? (
        <div className="cashier-stock-list">
          {visible.map((product) => (
            <StockRow
              key={product.id}
              product={product}
              reload={load}
              frontConnected={catalog?.frontSync?.connected === true}
            />
          ))}
        </div>
      ) : (
        <PageState
          type="empty"
          title={
            search
              ? 'Товар не найден'
              : filter === 'stopped'
                ? 'В стоп-листе нет товаров'
                : 'Товаров нет'
          }
          description={search ? 'Попробуйте другое название.' : ''}
        />
      )}
    </div>
  );
}

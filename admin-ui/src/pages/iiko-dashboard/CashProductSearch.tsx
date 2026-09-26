import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { loadControls } from './load-controls';

export type CashProduct = { id: string; name: string };
type Props = {
  scope: { serverId: string; from: string; to: string; department: string };
  shift: string;
  refresh: number;
  value: string;
  onChange: (value: string) => void;
  onSelect: (product: CashProduct) => void;
};

export default function CashProductSearch({
  scope,
  shift,
  refresh,
  value,
  onChange,
  onSelect,
}: Props) {
  const id = useId();
  const listId = `${id}-products`;
  const list = useRef<HTMLUListElement>(null);
  const [requested, setRequested] = useState(false);
  const [open, setOpen] = useState(false);
  const [products, setProducts] = useState<CashProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [active, setActive] = useState(-1);

  useEffect(() => {
    if (!requested || !shift) return;
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    void loadControls<{ products: CashProduct[] }>(
      { ...scope, shift, search: '' },
      controller.signal,
      '/iiko-dashboard/cash-report',
    )
      .then((result) => {
        if (!controller.signal.aborted) {
          setProducts(result.products ?? []);
          setActive(-1);
        }
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [requested, scope, shift, refresh, attempt]);

  const matches = useMemo(() => {
    const query = value.trim().toLocaleLowerCase('ru');
    return products.filter((product) => product.name.toLocaleLowerCase('ru').includes(query));
  }, [products, value]);
  const visible = matches.slice(0, 40);
  const expanded = open && Boolean(shift);
  const activeProduct = expanded ? visible[active] : undefined;
  useEffect(() => {
    if (expanded && active >= 0)
      list.current?.children[active]?.scrollIntoView?.({ block: 'nearest' });
  }, [active, expanded]);

  const choose = (product: CashProduct) => {
    setOpen(false);
    setActive(-1);
    onSelect(product);
  };
  return (
    <div
      className="id-cash-product-field"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
        }
      }}
    >
      <label htmlFor={id}>Товар</label>
      <div className="id-search-input">
        <Search size={16} aria-hidden="true" />
        <input
          id={id}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={expanded ? listId : undefined}
          aria-activedescendant={activeProduct ? `${id}-option-${active}` : undefined}
          autoComplete="off"
          disabled={!shift}
          value={value}
          maxLength={160}
          placeholder="Например, Синнабон"
          onFocus={() => {
            setRequested(true);
            setOpen(true);
            setActive(-1);
          }}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(-1);
            setRequested(true);
            setOpen(true);
          }}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              setOpen(true);
              setRequested(true);
              if (visible.length) {
                const direction = event.key === 'ArrowDown' ? 1 : -1;
                setActive((current) =>
                  current < 0
                    ? direction === 1
                      ? 0
                      : visible.length - 1
                    : (current + direction + visible.length) % visible.length,
                );
              }
            } else if (event.key === 'Enter') {
              setOpen(false);
              if (activeProduct) {
                event.preventDefault();
                choose(activeProduct);
              }
            } else if (event.key === 'Escape') {
              event.preventDefault();
              setOpen(false);
              setActive(-1);
            }
          }}
        />
        {expanded && (
          <div className="id-cash-suggestions">
            <p className="id-cash-suggestions-caption">Товары выбранной смены</p>
            <ul ref={list} id={listId} role="listbox" aria-label="Подсказки товаров">
              {visible.map((product, index) => (
                <li role="presentation" key={product.id || product.name}>
                  <button
                    id={`${id}-option-${index}`}
                    type="button"
                    role="option"
                    aria-selected={index === active}
                    tabIndex={-1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => choose(product)}
                  >
                    {product.name}
                  </button>
                </li>
              ))}
            </ul>
            {loading && <p role="status">Загружаем товары смены…</p>}
            {!loading && failed && (
              <div className="id-cash-suggestions-error" role="status">
                <p>Не удалось загрузить подсказки. Можно искать вручную.</p>
                <button type="button" onClick={() => setAttempt((current) => current + 1)}>
                  Повторить
                </button>
              </div>
            )}
            {!loading && !failed && !matches.length && (
              <p role="status">В этой смене совпадений нет</p>
            )}
            {matches.length > visible.length && (
              <p>Уточните название, чтобы увидеть остальные товары</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

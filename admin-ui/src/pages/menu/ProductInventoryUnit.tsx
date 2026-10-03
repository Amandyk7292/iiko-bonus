import { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { request } from '../../lib/api';

type Unit = 'шт' | 'кг';
type UnitState = { unit: Unit | null; configured: boolean; canEdit: boolean };
export type ProductInventoryUnitHandle = { saveIfChanged: () => Promise<boolean> };

const ProductInventoryUnit = forwardRef<
  ProductInventoryUnitHandle,
  { productId: string; onSaved: () => void }
>(function ProductInventoryUnit({ productId, onSaved }, ref) {
  const [stored, setStored] = useState<UnitState | null>(null);
  const [unit, setUnit] = useState<Unit | null>(null);
  const [changed, setChanged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [visited, setVisited] = useState(false);
  const path = `/menu/inventory-units/${encodeURIComponent(productId)}`;

  useEffect(() => {
    if (!visited) return;
    let active = true;
    setLoading(true);
    setError('');
    setStored(null);
    setChanged(false);
    void request<UnitState>(path)
      .then((value) => {
        if (!active) return;
        setStored(value);
        setUnit(value.unit);
      })
      .catch((caught) => {
        if (active)
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить единицу');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [path, retry, visited]);

  useImperativeHandle(
    ref,
    () => ({
      async saveIfChanged() {
        if (!changed) return true;
        if (!stored?.canEdit || !unit) return false;
        try {
          await request(path, { method: 'PUT', body: JSON.stringify({ unit }) });
          setStored({ ...stored, unit, configured: true });
          setChanged(false);
          setError('');
          onSaved();
          return true;
        } catch (caught) {
          setExpanded(true);
          setError(caught instanceof Error ? caught.message : 'Не удалось сохранить единицу');
          return false;
        }
      },
    }),
    [changed, stored, unit, path, onSaved],
  );

  return (
    <details
      className="product-editor-disclosure"
      open={expanded}
      onToggle={(event) => {
        setExpanded(event.currentTarget.open);
        if (event.currentTarget.open) setVisited(true);
      }}
    >
      <summary>Учёт количества{stored?.configured && unit ? ` · ${unit}` : ''}</summary>
      <div className="field-group pt-3">
        <span className="field-label">Единица для всех точек</span>
        {loading ? (
          <span role="status">Загрузка…</span>
        ) : (
          stored && (
            <div className="segmented-control" role="group" aria-label="Единица измерения товара">
              {(['шт', 'кг'] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={unit === value}
                  className={unit === value ? 'is-active' : undefined}
                  disabled={!stored.canEdit}
                  onClick={() => {
                    setUnit(value);
                    setChanged(!stored.configured || value !== stored.unit);
                    setError('');
                  }}
                >
                  {value === 'шт' ? 'Штуки' : 'Килограммы'}
                </button>
              ))}
            </div>
          )
        )}
        {error && (
          <p className="product-editor-validation" role="alert">
            {error}
          </p>
        )}
        {!loading && !stored && (
          <button
            type="button"
            className="btn-outline"
            onClick={() => setRetry((value) => value + 1)}
          >
            Повторить
          </button>
        )}
      </div>
    </details>
  );
});

export default ProductInventoryUnit;

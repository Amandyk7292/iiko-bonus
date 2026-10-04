import { Check, Pencil } from '../../components/BulkaIcons';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { request } from '../../lib/api';
import type { ProductBadge as Badge } from './menu-page.shared';
import ProductStickerPicker from './ProductStickerPicker';
export type ProductBadgesHandle = { saveIfChanged: () => Promise<boolean> };
export default function ProductBadges({
  productId,
  imageUrl,
  onSaved,
  ref,
  integrated = false,
  onBusyChange,
}: {
  productId?: string;
  imageUrl?: string;
  onSaved?: () => void;
  ref?: Ref<ProductBadgesHandle>;
  integrated?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [badges, setBadges] = useState<Badge[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [stickerId, setStickerId] = useState<string | null>(null);
  const [editing, setEditing] = useState<string>(),
    [label, setLabel] = useState(''),
    [labelKk, setLabelKk] = useState(''),
    [background, setBackground] = useState('#782b0e'),
    [foreground, setForeground] = useState('#ffffff');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [loaded, setLoaded] = useState(false);
  const [badgeEditorOpen, setBadgeEditorOpen] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reload, setReload] = useState(0);
  const initialSelection = useRef('');
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useImperativeHandle(ref, () => ({
    saveIfChanged: async () => {
      if (!loaded || busy) {
        if (!loadError) setMessage('Дождитесь загрузки оформления и попробуйте сохранить снова.');
        return false;
      }
      if (initialSelection.current === JSON.stringify({ badgeIds: selected, stickerId }))
        return true;
      return saveSelection();
    },
  }));
  useEffect(() => {
    let active = true;
    setLoaded(false);
    setMessage('');
    setLoadError('');
    request<{ badges: Badge[]; selected: string[]; stickerId?: string | null }>(
      `/menu/badges${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`,
    )
      .then((data) => {
        if (active) {
          setBadges(data.badges);
          setSelected(data.selected);
          setStickerId(data.stickerId || null);
          initialSelection.current = JSON.stringify({
            badgeIds: data.selected,
            stickerId: data.stickerId || null,
          });
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (active)
          setLoadError(error instanceof Error ? error.message : 'Не удалось загрузить оформление');
      });
    return () => {
      active = false;
    };
  }, [productId, reload]);
  async function saveBadge() {
    if (!label.trim()) return;
    setBusy(true);
    setMessage('');
    try {
      const { badge } = await request<{ badge: Badge }>('/menu/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(editing ? { id: editing } : {}),
          label: label.trim(),
          labelKk: labelKk.trim(),
          background,
          foreground,
        }),
      });
      setBadges((current) => [...current.filter((b) => b.id !== badge.id), badge]);
      setEditing(undefined);
      setLabel('');
      setLabelKk('');
      setBadgeEditorOpen(false);
      setMessage('Метка сохранена в общем справочнике');
      onSaved?.();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }
  async function saveSelection() {
    setBusy(true);
    setMessage('');
    try {
      await request('/menu/badges/assignment', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ productId, badgeIds: selected, stickerId }),
      });
      initialSelection.current = JSON.stringify({ badgeIds: selected, stickerId });
      setMessage('Оформление товара сохранено');
      onSaved?.();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить');
      return false;
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {loadError && (
        <div className="grid gap-3">
          <p role="alert">{loadError}</p>
          <button
            type="button"
            className="btn-outline"
            onClick={() => setReload((current) => current + 1)}
          >
            Повторить загрузку
          </button>
        </div>
      )}
      <fieldset className="product-badges grid gap-4" disabled={busy || !loaded}>
        <ProductStickerPicker
          badges={badges}
          selectedId={stickerId}
          imageUrl={imageUrl}
          onSelect={setStickerId}
          onCreated={(badge) => setBadges((current) => [...current, badge])}
          onBusy={setBusy}
          onMessage={setMessage}
        />
        <h3 className="font-semibold">Текстовые метки</h3>
        <p className="field-hint">Выберите до трёх меток.</p>
        <div className="flex flex-wrap gap-2">
          {badges
            .filter((badge) => !badge.imageUrl)
            .map((b) => (
              <span key={b.id} className="inline-flex gap-1 items-center">
                <button
                  type="button"
                  aria-pressed={selected.includes(b.id)}
                  data-unsaved-change
                  style={{
                    background: b.background,
                    color: b.foreground,
                    borderRadius: 12,
                    padding: '8px 12px',
                    minHeight: 44,
                    border: selected.includes(b.id) ? '3px solid #111' : '3px solid transparent',
                  }}
                  onClick={() =>
                    setSelected((ids) =>
                      ids.includes(b.id)
                        ? ids.filter((id) => id !== b.id)
                        : ids.length < 3
                          ? [...ids, b.id]
                          : ids,
                    )
                  }
                >
                  {selected.includes(b.id) && <Check aria-hidden="true" size={16} />}
                  {b.label}
                </button>
                <button
                  type="button"
                  aria-label={`Изменить метку ${b.label}`}
                  className="icon-button"
                  onClick={() => {
                    setBadgeEditorOpen(true);
                    setEditing(b.id);
                    setLabel(b.label);
                    setLabelKk(b.labelKk || '');
                    setBackground(b.background);
                    setForeground(b.foreground);
                  }}
                >
                  <Pencil aria-hidden="true" size={17} />
                </button>
              </span>
            ))}
        </div>
        {productId && !integrated ? (
          <button type="button" className="btn-outline" onClick={() => void saveSelection()}>
            Сохранить оформление товара
          </button>
        ) : !productId ? (
          <p>Сначала сохраните товар, затем откройте его редактирование для выбора меток.</p>
        ) : null}
        <details
          className="product-editor-disclosure"
          open={badgeEditorOpen}
          onToggle={(event) => setBadgeEditorOpen(event.currentTarget.open)}
        >
          <summary>{editing ? 'Изменить общую метку' : 'Создать метку'}</summary>
          <div className="grid gap-3 pt-3">
            <p className="field-hint">Метка общая для всех товаров. Изменения применятся везде.</p>
            <label>
              Название на русском
              <input
                className="input-classic"
                value={label}
                maxLength={24}
                placeholder="Хит, Острое, Новинка"
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              Название на казахском
              <input
                className="input-classic"
                value={labelKk}
                maxLength={24}
                placeholder="Ащы, Жаңа"
                onChange={(e) => setLabelKk(e.target.value)}
              />
            </label>
            <p className="text-sm text-gray-500">
              Без казахского перевода показывается русское название.
            </p>
            <div className="flex flex-wrap gap-4">
              <label>
                Фон{' '}
                <input
                  type="color"
                  value={background}
                  onChange={(e) => setBackground(e.target.value)}
                />
              </label>
              <label>
                Текст{' '}
                <input
                  type="color"
                  value={foreground}
                  onChange={(e) => setForeground(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-center gap-2" aria-label="Предпросмотр метки">
                <span className="text-xs">RU</span>
                <span
                  style={{ background, color: foreground, borderRadius: 12, padding: '6px 12px' }}
                >
                  {label || 'Предпросмотр'}
                </span>
                <span className="text-xs">KK</span>
                <span
                  style={{ background, color: foreground, borderRadius: 12, padding: '6px 12px' }}
                >
                  {labelKk || label || 'Алдын ала қарау'}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="btn-outline"
              disabled={!label.trim()}
              onClick={() => void saveBadge()}
            >
              {editing ? 'Обновить общую метку' : 'Создать общую метку'}
            </button>
            {editing && (
              <button
                type="button"
                onClick={() => {
                  setEditing(undefined);
                  setLabel('');
                  setLabelKk('');
                  setBadgeEditorOpen(false);
                }}
              >
                Отмена редактирования метки
              </button>
            )}
          </div>
        </details>
        {message && <p role="status">{message}</p>}
      </fieldset>
    </>
  );
}

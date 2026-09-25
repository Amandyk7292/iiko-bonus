import { useEffect, useState } from 'react';
import { request } from '../../lib/api';
type Badge = { id: string; label: string; background: string; foreground: string };
export default function ProductBadges({ productId }: { productId?: string }) {
  const [badges, setBadges] = useState<Badge[]>([]),
    [selected, setSelected] = useState<string[]>([]);
  const [editing, setEditing] = useState<string>(),
    [label, setLabel] = useState(''),
    [background, setBackground] = useState('#782b0e'),
    [foreground, setForeground] = useState('#ffffff');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    setLoaded(false);
    request<{ badges: Badge[]; selected: string[] }>(
      `/menu/badges${productId ? `?productId=${encodeURIComponent(productId)}` : ''}`,
    )
      .then((data) => {
        if (active) {
          setBadges(data.badges);
          setSelected(data.selected);
          setLoaded(true);
        }
      })
      .catch((error) => {
        if (active) setMessage(error.message);
      });
    return () => {
      active = false;
    };
  }, [productId]);
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
          background,
          foreground,
        }),
      });
      setBadges((current) => [...current.filter((b) => b.id !== badge.id), badge]);
      setEditing(undefined);
      setLabel('');
      setMessage('Метка сохранена в общем справочнике');
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
        body: JSON.stringify({ productId, badgeIds: selected }),
      });
      setMessage('Метки товара сохранены');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить');
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="card p-4 grid gap-3" disabled={busy || !loaded}>
      <legend>Метки на карточке товара</legend>
      <p>
        До трёх меток. Созданные метки доступны для всех товаров. Изменение цвета или названия
        применяется везде.
      </p>
      <div className="flex flex-wrap gap-2">
        {badges.map((b) => (
          <span key={b.id} className="inline-flex gap-1 items-center">
            <button
              type="button"
              aria-pressed={selected.includes(b.id)}
              style={{
                background: b.background,
                color: b.foreground,
                borderRadius: 12,
                padding: '8px 12px',
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
              {selected.includes(b.id) ? '✓ ' : ''}
              {b.label}
            </button>
            <button
              type="button"
              aria-label={`Изменить метку ${b.label}`}
              onClick={() => {
                setEditing(b.id);
                setLabel(b.label);
                setBackground(b.background);
                setForeground(b.foreground);
              }}
            >
              ✎
            </button>
          </span>
        ))}
      </div>
      {productId ? (
        <button type="button" className="btn-outline" onClick={() => void saveSelection()}>
          Сохранить метки товара
        </button>
      ) : (
        <p>Сначала сохраните товар, затем откройте его редактирование для выбора меток.</p>
      )}
      <label>
        Название метки
        <input
          className="input-classic"
          value={label}
          maxLength={24}
          placeholder="Хит, Острое, Новинка"
          onChange={(e) => setLabel(e.target.value)}
        />
      </label>
      <div className="flex flex-wrap gap-4">
        <label>
          Фон{' '}
          <input type="color" value={background} onChange={(e) => setBackground(e.target.value)} />
        </label>
        <label>
          Текст{' '}
          <input type="color" value={foreground} onChange={(e) => setForeground(e.target.value)} />
        </label>
        <span style={{ background, color: foreground, borderRadius: 12, padding: '6px 12px' }}>
          {label || 'Предпросмотр'}
        </span>
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
          }}
        >
          Отмена редактирования метки
        </button>
      )}
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}

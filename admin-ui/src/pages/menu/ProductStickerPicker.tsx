import { Check } from '../../components/BulkaIcons';
import { useEffect, useId, useState } from 'react';
import { request } from '../../lib/api';
import type { ProductBadge } from './menu-page.shared';
import ProductPhotoSticker from './ProductPhotoSticker';

export default function ProductStickerPicker({
  badges,
  selectedId,
  imageUrl,
  onSelect,
  onCreated,
  onBusy,
  onMessage,
}: {
  badges: ProductBadge[];
  selectedId: string | null;
  imageUrl?: string;
  onSelect: (id: string | null) => void;
  onCreated: (badge: ProductBadge) => void;
  onBusy: (busy: boolean) => void;
  onMessage: (message: string) => void;
}) {
  const id = useId();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState('');
  const stickers = badges.filter((badge) => badge.imageUrl);
  const selected = stickers.find((badge) => badge.id === selectedId);
  useEffect(() => {
    if (!file) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  async function createSticker() {
    if (!file || !name.trim()) return;
    onBusy(true);
    onMessage('Загружаем стикер…');
    try {
      const body = new FormData();
      body.append('image', file);
      body.append('purpose', 'sticker');
      const uploaded = await request<{ imageUrl: string }>('/menu/upload-image', {
        method: 'POST',
        body,
      });
      const { badge } = await request<{ badge: ProductBadge }>('/menu/badges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          label: name.trim(),
          labelKk: name.trim(),
          imageUrl: uploaded.imageUrl,
          background: '#782b0e',
          foreground: '#ffffff',
        }),
      });
      onCreated(badge);
      onSelect(badge.id);
      setName('');
      setFile(undefined);
      onMessage('Стикер добавлен. Сохраните товар, чтобы применить его.');
    } catch (error) {
      onMessage(error instanceof Error ? error.message : 'Не удалось загрузить стикер');
    } finally {
      onBusy(false);
    }
  }

  return (
    <section className="grid min-w-0 gap-3" aria-label="Стикер на фото">
      <h3 className="font-semibold">Стикер на фото</h3>
      <div className="product-sticker-choices">
        <button
          type="button"
          className={`product-sticker-choice ${!selectedId ? 'is-selected' : ''}`}
          aria-pressed={!selectedId}
          data-unsaved-change
          onClick={() => onSelect(null)}
        >
          Без стикера
        </button>
        {stickers.map((badge) => (
          <button
            key={badge.id}
            type="button"
            aria-label={badge.label}
            aria-pressed={badge.id === selectedId}
            data-unsaved-change
            onClick={() => onSelect(badge.id)}
            className={`product-sticker-choice ${badge.id === selectedId ? 'is-selected' : ''}`}
          >
            <ProductPhotoSticker badges={[badge]} size={64} />
            <span>
              {badge.id === selectedId && <Check aria-hidden="true" size={16} />}
              {badge.label === 'Менің таңдауым (круг)'
                ? 'Круг'
                : badge.label === 'Менің таңдауым (сердце)'
                  ? 'Сердце'
                  : badge.label}
            </span>
          </button>
        ))}
      </div>
      {selected && (
        <figure className="grid gap-2">
          <div
            className="relative aspect-square w-full max-w-40 overflow-hidden rounded-2xl bg-amber-50"
            aria-label="Предпросмотр стикера на товаре"
          >
            {imageUrl && (
              <img
                src={imageUrl}
                alt="Фото товара"
                width="256"
                height="256"
                className="h-full w-full object-cover"
              />
            )}
            <div className="absolute left-2 top-2">
              <ProductPhotoSticker badges={[selected]} size={40} />
            </div>
          </div>
          <figcaption className="text-sm text-gray-600">Так стикер выглядит на товаре.</figcaption>
        </figure>
      )}
      <details className="rounded-xl border border-gray-200 p-3">
        <summary className="cursor-pointer py-2 font-medium">Добавить свой стикер</summary>
        <div className="grid gap-3 pt-3">
          <label htmlFor={`${id}-name`}>Название стикера</label>
          <input
            id={`${id}-name`}
            className="input-classic"
            maxLength={24}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <label htmlFor={`${id}-file`}>Изображение стикера</label>
          <input
            key={file?.name || 'empty'}
            id={`${id}-file`}
            type="file"
            accept="image/png,image/webp"
            className="input-classic"
            onChange={(event) => {
              const candidate = event.target.files?.[0];
              if (!candidate) return;
              if (
                !['image/png', 'image/webp'].includes(candidate.type) ||
                candidate.size > 5 * 1024 * 1024
              ) {
                onMessage(
                  'Выберите PNG или WebP до 5 МБ. Для аккуратного стикера нужен прозрачный фон.',
                );
                event.target.value = '';
                return;
              }
              setFile(candidate);
            }}
          />
          <p className="text-sm text-gray-600">
            PNG или WebP с прозрачным фоном, до 5 МБ. Стикер будет доступен для всех товаров.
          </p>
          {preview && (
            <img
              src={preview}
              alt="Предпросмотр нового стикера"
              width="112"
              height="112"
              className="object-contain"
            />
          )}
          <button
            type="button"
            className="btn-outline min-h-11"
            disabled={!file || !name.trim()}
            onClick={() => void createSticker()}
          >
            Добавить стикер
          </button>
        </div>
      </details>
    </section>
  );
}

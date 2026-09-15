import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import Modal from './Modal';
import { request } from '../lib/api';
import { labelHex, LABEL_BACKGROUND } from '../lib/price-label';
import {
  labelProducts,
  batchLabel,
  type LabelMenu,
  type LabelProduct,
} from '../lib/price-label-batch';
import { loadPriceLabelSettings, savePriceLabelSettings } from '../lib/price-label-settings';
import './price-label.css';

export default function BulkPriceLabels({
  profileKey,
  disabled,
}: {
  profileKey?: string;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="btn-outline inline-flex min-h-11 items-center justify-center gap-2 px-4"
        disabled={disabled || !profileKey}
        onClick={() => setOpen(true)}
      >
        <Printer size={17} aria-hidden="true" /> Общая печать ценников
      </button>
      {open && profileKey && (
        <BulkPriceLabelsModal profileKey={profileKey} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function BulkPriceLabelsModal({
  profileKey,
  onClose,
}: {
  profileKey: string;
  onClose: () => void;
}) {
  const [background, setBackground] = useState(LABEL_BACKGROUND);
  const [includeQr, setIncludeQr] = useState(false);
  const [products, setProducts] = useState<LabelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void Promise.all([loadPriceLabelSettings(), request<LabelMenu>('/menu')])
      .then(([settings, menu]) => {
        if (!live) return;
        if (settings.profileKey !== profileKey || menu.profileKey !== profileKey)
          throw new Error('Город изменился. Откройте печать заново.');
        setBackground(settings.background);
        setIncludeQr(settings.includeQr);
        setProducts(labelProducts(menu));
      })
      .catch((reason) => {
        if (live) setError(reason.message);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [profileKey, retry]);
  let preview = '';
  try {
    if (products[0] && labelHex(background))
      preview = batchLabel(products[0], background, includeQr).svg;
  } catch {
    /* Full validation runs before PDF generation. */
  }
  const generate = async () => {
    const hex = labelHex(background);
    if (!hex) {
      setError('Введите HEX-код из 6 символов.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setDone(0);
    try {
      await savePriceLabelSettings({ profileKey, background: hex, includeQr });
      const menu = await request<LabelMenu>('/menu');
      if (menu.profileKey !== profileKey)
        throw new Error('Город изменился. Откройте печать заново.');
      if (menu.rawMenu?.isStale)
        throw new Error('iiko возвращает устаревшее меню. Обновите меню и повторите печать.');
      const current = labelProducts(menu);
      setProducts(current);
      const { generatePriceLabelsPdf } = await import('../lib/price-label-pdf');
      const result = await generatePriceLabelsPdf(current, hex, includeQr, setDone);
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], { type: 'application/pdf' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulka-price-labels-${profileKey}-${new Date().toISOString().slice(0, 10)}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      setNotice(
        `PDF готов: ${current.length} ценников, ${Math.ceil(current.length / 8)} стр. Настройки сохранены для всех ценников города.` +
          (result.shortened.length
            ? ` Длинный состав сокращён многоточием: ${result.shortened.join(', ')}.`
            : ''),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось создать PDF.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      title="Общая печать ценников"
      size="lg"
      onClose={() => {
        if (!busy) onClose();
      }}
      footer={
        <button
          type="button"
          className="btn-classic px-5 min-h-11"
          disabled={loading || busy || !products.length}
          onClick={() => void generate()}
        >
          {busy ? `Генерация ${done} / ${products.length}…` : 'Скачать PDF'}
        </button>
      }
    >
      <div className="modal-body price-label-controls">
        <p className="price-label-hint">
          Все товары меню выбранного города вне стоп-листа админки. Скрытые товары и категории не
          печатаются. Поиск и фильтр категорий не ограничивают общий PDF.
        </p>
        <p>
          10 × 6 см · A4 · 2 колонки · 8 ценников на странице. Зазоры 3 мм. Печать в масштабе 100%.
        </p>
        {loading ? (
          <p role="status">Загрузка настроек и товаров…</p>
        ) : (
          <>
            <p>К печати: {products.length}. Незаполненные переводы и состав не отображаются.</p>
            <div className="price-label-field">
              <label htmlFor="bulk-label-color">Фон всех ценников, HEX</label>
              <div className="price-label-color">
                <input
                  type="color"
                  aria-label="Выбрать общий фон"
                  disabled={busy}
                  value={labelHex(background) || LABEL_BACKGROUND}
                  onChange={(e) => setBackground(e.target.value)}
                />
                <input
                  id="bulk-label-color"
                  disabled={busy}
                  value={background}
                  maxLength={7}
                  onChange={(e) => setBackground(e.target.value)}
                />
              </div>
            </div>
            <label className="price-label-qr-toggle">
              <input
                type="checkbox"
                checked={includeQr}
                disabled={busy}
                onChange={(e) => setIncludeQr(e.target.checked)}
              />
              Включить QR-код на всех ценниках
            </label>
            {preview && (
              <div
                className="price-label-preview"
                style={{ maxWidth: 420 }}
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            )}
          </>
        )}
        {error && (
          <div role="alert">
            <p className="price-label-error">{error}</p>
            {!products.length && !busy && (
              <button
                type="button"
                className="btn-outline"
                onClick={() => setRetry((value) => value + 1)}
              >
                Повторить загрузку
              </button>
            )}
          </div>
        )}
        {notice && <p role="status">{notice}</p>}
      </div>
    </Modal>
  );
}

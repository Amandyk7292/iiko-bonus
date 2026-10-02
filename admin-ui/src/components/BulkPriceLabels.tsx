import { useEffect, useState } from 'react';
import { Printer } from 'lucide-react';
import Modal from './Modal';
import { getAdminBranchScope, request } from '../lib/api';
import {
  labelContrastColor,
  labelHex,
  LABEL_BACKGROUND,
  LABEL_TEXT_COLOR,
} from '../lib/price-label';
import {
  labelProducts,
  batchLabel,
  type LabelMenu,
  type LabelProduct,
} from '../lib/price-label-batch';
import { loadPriceLabelSettings, savePriceLabelSettings } from '../lib/price-label-settings';
import { LABELS_PER_SHEET } from '../lib/price-label-sheet';
import './price-label.css';

type ExportFormat = 'pdf' | 'corel';
const FORMAT_KEY = 'bulka-price-label-export-format';
function savedFormat(): ExportFormat {
  try {
    return localStorage.getItem(FORMAT_KEY) === 'corel' ? 'corel' : 'pdf';
  } catch {
    return 'pdf';
  }
}

export default function BulkPriceLabels({
  profileKey,
  cityName,
  branchId,
  disabled,
}: {
  profileKey?: string;
  cityName: string;
  branchId: string;
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
        <BulkPriceLabelsModal
          profileKey={profileKey}
          cityName={cityName}
          branchId={branchId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function BulkPriceLabelsModal({
  profileKey,
  cityName,
  branchId,
  onClose,
}: {
  profileKey: string;
  cityName: string;
  branchId: string;
  onClose: () => void;
}) {
  const [background, setBackground] = useState(LABEL_BACKGROUND);
  const [textColor, setTextColor] = useState(LABEL_TEXT_COLOR);
  const [includeQr, setIncludeQr] = useState(false);
  const [products, setProducts] = useState<LabelProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const [format, setFormat] = useState<ExportFormat>(savedFormat);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setError('');
    void Promise.all([loadPriceLabelSettings(), request<LabelMenu>('/menu')])
      .then(([settings, menu]) => {
        if (!live) return;
        if (
          getAdminBranchScope() !== branchId ||
          settings.profileKey !== profileKey ||
          menu.profileKey !== profileKey
        )
          throw new Error('Город изменился. Откройте печать заново.');
        setBackground(settings.background);
        setTextColor(settings.textColor || labelContrastColor(settings.background));
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
    if (products[0] && labelHex(background) && labelHex(textColor))
      preview = batchLabel(products[0], background, includeQr, textColor).svg;
  } catch {
    /* Full validation runs before exporting either format. */
  }
  const generate = async () => {
    const hex = labelHex(background);
    const textHex = labelHex(textColor);
    if (!hex || !textHex) {
      setError('Введите HEX-код из 6 символов.');
      return;
    }
    setBusy(true);
    setError('');
    setNotice('');
    setDone(0);
    try {
      if (getAdminBranchScope() !== branchId)
        throw new Error('Город изменился. Откройте печать заново.');
      await savePriceLabelSettings({
        profileKey,
        background: hex,
        textColor: textHex,
        includeQr,
      });
      const menu = await request<LabelMenu>('/menu');
      if (getAdminBranchScope() !== branchId || menu.profileKey !== profileKey)
        throw new Error('Город изменился. Откройте печать заново.');
      if (menu.rawMenu?.isStale)
        throw new Error('iiko возвращает устаревшее меню. Обновите меню и повторите печать.');
      const current = labelProducts(menu);
      setProducts(current);
      const generator =
        format === 'pdf'
          ? (await import('../lib/price-label-pdf')).generatePriceLabelsPdf
          : (await import('../lib/price-label-corel')).generatePriceLabelsCorel;
      const result = await generator(current, hex, includeQr, textHex, setDone);
      if (getAdminBranchScope() !== branchId)
        throw new Error('Город изменился во время генерации. Откройте печать заново.');
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(result.bytes)], {
          type: format === 'pdf' ? 'application/pdf' : 'application/zip',
        }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `bulka-price-labels-${cityName.trim().replace(/[^\p{L}\p{N}-]+/gu, '-') || profileKey}-${new Date().toISOString().slice(0, 10)}${format === 'corel' ? '-corel.zip' : '.pdf'}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
      try {
        localStorage.setItem(FORMAT_KEY, format);
      } catch {
        /* Downloads work without browser storage. */
      }
      setNotice(
        `${format === 'pdf' ? 'PDF готов' : 'Файл для CorelDRAW готов'} · ${cityName}: ${current.length} ценников, ${Math.ceil(current.length / LABELS_PER_SHEET)} стр.`,
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось подготовить ценники.');
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
          {busy
            ? `Подготовка ${done} / ${products.length}…`
            : format === 'pdf'
              ? 'Скачать PDF'
              : 'Скачать для CorelDRAW'}
        </button>
      }
    >
      <div className="modal-body price-label-controls">
        <p className="price-label-hint">
          Ценники города {cityName}. Скрытые товары и товары в стоп-листе не печатаются.
        </p>
        <p>10 × 6 см · A4 · 8 ценников на странице · Печать в масштабе 100%.</p>
        <fieldset className="price-label-format" disabled={loading || busy}>
          <legend>Формат файла</legend>
          <div className="price-label-format-options">
            {(['pdf', 'corel'] as const).map((value) => (
              <label key={value} className={format === value ? 'is-selected' : undefined}>
                <input
                  type="radio"
                  name="bulk-label-format"
                  value={value}
                  checked={format === value}
                  onChange={() => setFormat(value)}
                />
                {value === 'pdf' ? 'PDF' : 'CorelDRAW (SVG)'}
              </label>
            ))}
          </div>
          {format === 'corel' && (
            <p className="price-label-hint">
              Листы SVG в ZIP. Откройте в CorelDRAW для редактирования.
            </p>
          )}
        </fieldset>
        {loading ? (
          <p role="status">Загрузка настроек и товаров…</p>
        ) : (
          <>
            <p>К печати: {products.length}. Незаполненные переводы и состав не отображаются.</p>
            <div className="price-label-color-fields">
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
              <div className="price-label-field">
                <label htmlFor="bulk-label-text-color">Цвет текста, HEX</label>
                <div className="price-label-color">
                  <input
                    type="color"
                    aria-label="Выбрать цвет текста"
                    disabled={busy}
                    value={labelHex(textColor) || LABEL_TEXT_COLOR}
                    onChange={(e) => setTextColor(e.target.value)}
                  />
                  <input
                    id="bulk-label-text-color"
                    disabled={busy}
                    value={textColor}
                    maxLength={7}
                    onChange={(e) => setTextColor(e.target.value)}
                  />
                </div>
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

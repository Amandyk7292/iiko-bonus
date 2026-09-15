import { useMemo, useState, type FormEvent } from 'react';
import { Printer } from 'lucide-react';
import Modal from './Modal';
import {
  buildPriceLabel,
  browserLabelMeasure,
  labelHex,
  LABEL_BACKGROUND_KEY,
  printPriceLabel,
  type PriceLabelDraft,
} from '../lib/price-label';
import './price-label.css';

export default function PriceLabelModal({
  initial,
  onClose,
}: {
  initial: PriceLabelDraft;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(initial);
  const [submitted, setSubmitted] = useState(false);
  const [printError, setPrintError] = useState('');
  const measure = useMemo(browserLabelMeasure, []);
  const result = useMemo(() => buildPriceLabel(draft, measure), [draft, measure]);
  const update = (key: keyof PriceLabelDraft, value: string) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setPrintError('');
  };
  const print = (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    setPrintError('');
    if (!result.fits) {
      const field = Object.keys(result.errors)[0];
      document.getElementById(`price-label-${field}`)?.focus();
      return;
    }
    try {
      try {
        localStorage.setItem(LABEL_BACKGROUND_KEY, labelHex(draft.background)!);
      } catch {
        /* Printing works without browser storage. */
      }
      printPriceLabel(result.svg, draft.nameRu);
    } catch (error) {
      setPrintError(
        error instanceof Error ? error.message : 'Не удалось открыть печать. Повторите попытку.',
      );
    }
  };
  const field = (key: keyof PriceLabelDraft, label: string, multiline = false) => {
    const error = submitted ? result.errors[key] : undefined;
    const props = {
      id: `price-label-${key}`,
      value: draft[key],
      onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        update(key, event.target.value),
      'aria-invalid': Boolean(error),
      'aria-describedby': error ? `price-label-error-${key}` : undefined,
      maxLength: multiline ? 600 : key === 'price' ? 11 : 200,
    };
    return (
      <div className="price-label-field">
        <label htmlFor={props.id}>
          {label} <span aria-hidden="true">*</span>
        </label>
        {multiline ? (
          <textarea {...props} rows={3} lang={key.endsWith('Kk') ? 'kk' : 'ru'} />
        ) : (
          <input
            {...props}
            inputMode={key === 'price' ? 'decimal' : undefined}
            lang={key.endsWith('Kk') ? 'kk' : 'ru'}
          />
        )}
        {error && (
          <p id={`price-label-error-${key}`} role="alert" className="price-label-error">
            {error}
          </p>
        )}
      </div>
    );
  };
  return (
    <Modal
      open
      title="Ценник 10 × 6 см"
      onClose={onClose}
      size="xl"
      footer={
        <div className="price-label-footer">
          <span>Печать: масштаб 100%, без полей и колонтитулов.</span>
          <button className="btn-classic px-5" type="submit" form="price-label-form">
            <Printer size={18} aria-hidden="true" /> Печать
          </button>
        </div>
      }
    >
      <form
        id="price-label-form"
        className="modal-body price-label-editor"
        onSubmit={print}
        noValidate
      >
        <div className="price-label-controls">
          <p className="price-label-hint">
            Поля заполнены из карточки товара. Изменения здесь относятся только к печатному ценнику.
          </p>
          <div className="price-label-fields-row">
            {field('nameKk', 'Название на казахском')}
            {field('nameRu', 'Название на русском')}
          </div>
          <div className="price-label-fields-row">
            {field('price', 'Цена, ₸')}
            <div className="price-label-field">
              <label htmlFor="price-label-background">
                Цвет фона, HEX <span aria-hidden="true">*</span>
              </label>
              <div className="price-label-color">
                <input
                  type="color"
                  aria-label="Выбрать цвет фона"
                  value={labelHex(draft.background) || initial.background}
                  onChange={(event) => update('background', event.target.value.toUpperCase())}
                />
                <input
                  id="price-label-background"
                  value={draft.background}
                  maxLength={7}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="#792C14"
                  onChange={(event) => update('background', event.target.value)}
                  onBlur={() => {
                    const hex = labelHex(draft.background);
                    if (hex) update('background', hex);
                  }}
                  aria-invalid={submitted && Boolean(result.errors.background)}
                  aria-describedby={
                    submitted && result.errors.background
                      ? 'price-label-error-background'
                      : undefined
                  }
                />
              </div>
              {submitted && result.errors.background && (
                <p className="price-label-error" role="alert" id="price-label-error-background">
                  {result.errors.background}
                </p>
              )}
            </div>
          </div>
          {field('ingredientsRu', 'Состав на русском', true)}
          {field('ingredientsKk', 'Состав на казахском', true)}
        </div>
        <div className="price-label-preview-column">
          <p className="price-label-preview-title">Предварительный просмотр · 10 × 6 см</p>
          <div
            className="price-label-preview"
            data-testid="price-label-preview"
            dangerouslySetInnerHTML={{ __html: result.svg }}
          />
          {!result.fits &&
            Object.values(result.errors).some(
              (error) => error?.includes('помещается') || error?.includes('длинные'),
            ) && (
              <p className="price-label-error" role="alert">
                Текст не помещается в ценник. Сократите названия или состав перед печатью.
              </p>
            )}
          {printError && (
            <p className="price-label-error" role="alert">
              {printError}
            </p>
          )}
        </div>
      </form>
    </Modal>
  );
}

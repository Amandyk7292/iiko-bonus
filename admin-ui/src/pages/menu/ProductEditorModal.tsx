import { useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import Modal from '../../components/GuardedModal';
import ProductBadges, { type ProductBadgesHandle } from './ProductBadges';
import ProductInventoryUnit, { type ProductInventoryUnitHandle } from './ProductInventoryUnit';
import './ProductEditorModal.css';

const tabs = [
  { key: 'main', label: 'Основное' },
  { key: 'appearance', label: 'Оформление' },
  { key: 'facts', label: 'Сведения' },
] as const;
type EditorTab = (typeof tabs)[number]['key'];

export default function ProductEditorModal({
  name,
  productId,
  imageUrl,
  saving,
  onClose,
  onSubmit,
  onAppearanceSaved,
  main,
  facts,
  catalogValid = true,
}: {
  name: string;
  productId?: string;
  imageUrl?: string;
  saving: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent, saveAppearance?: () => Promise<boolean>) => Promise<void>;
  onAppearanceSaved: () => void;
  main: ReactNode;
  facts: ReactNode;
  catalogValid?: boolean;
}) {
  const id = useId();
  const [tab, setTab] = useState<EditorTab>('main');
  const [appearanceVisited, setAppearanceVisited] = useState(false);
  const [appearanceBusy, setAppearanceBusy] = useState(false);
  const [validation, setValidation] = useState('');
  const badges = useRef<ProductBadgesHandle>(null);
  const inventoryUnit = useRef<ProductInventoryUnitHandle>(null);
  const locked = saving || appearanceBusy;
  const selectTab = (next: EditorTab) => {
    setTab(next);
    if (next === 'appearance') setAppearanceVisited(true);
  };
  const saveAppearance = async () => {
    if (!((await inventoryUnit.current?.saveIfChanged()) ?? true)) {
      selectTab('main');
      return false;
    }
    const saved = (await badges.current?.saveIfChanged()) ?? true;
    if (!saved) selectTab('appearance');
    return saved;
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (locked) return;
    setValidation('');
    if (!event.currentTarget.checkValidity()) return;
    if (!catalogValid) {
      selectTab('main');
      const catalogs =
        event.currentTarget.querySelector<HTMLDetailsElement>('[data-catalog-settings]');
      if (catalogs) catalogs.open = true;
      setValidation('Выберите хотя бы один способ заказа в разделе «Где продавать».');
      return;
    }
    await onSubmit(event, saveAppearance);
  };
  return (
    <Modal
      open
      title={productId ? 'Редактирование товара' : 'Новый товар'}
      description={name || undefined}
      onClose={() => !locked && onClose()}
      dismissDisabled={locked}
      footer={
        <div className="modal-actions">
          <button
            type="button"
            data-modal-dismiss
            className="btn-outline"
            disabled={locked}
            onClick={onClose}
          >
            Отмена
          </button>
          <button type="submit" form={`${id}-form`} className="btn-classic" disabled={locked}>
            {saving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
            {saving ? 'Сохранение…' : 'Сохранить'}
          </button>
        </div>
      }
    >
      <form
        id={`${id}-form`}
        className="product-editor"
        noValidate
        onSubmit={submit}
        onInvalidCapture={(event) => {
          event.preventDefault();
          const field = event.target as HTMLInputElement;
          const panel = field.closest<HTMLElement>('[data-editor-tab]');
          if (panel) selectTab(panel.dataset.editorTab as EditorTab);
          let ancestor = field.parentElement;
          while (ancestor && ancestor !== event.currentTarget) {
            if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
            ancestor = ancestor.parentElement;
          }
          setValidation(field.validationMessage);
          requestAnimationFrame(() => field.focus());
        }}
      >
        <div
          className="segmented-control product-editor-tabs"
          role="tablist"
          aria-label="Настройки товара"
        >
          {tabs.map(({ key, label }, index) => (
            <button
              key={key}
              type="button"
              role="tab"
              id={`${id}-${key}-tab`}
              aria-controls={`${id}-${key}-panel`}
              aria-selected={tab === key}
              className={tab === key ? 'is-active' : undefined}
              tabIndex={tab === key ? 0 : -1}
              disabled={locked}
              onClick={() => selectTab(key)}
              onKeyDown={(event) => {
                const delta = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? tabs.length - 1
                      : delta
                        ? (index + delta + tabs.length) % tabs.length
                        : undefined;
                if (next === undefined) return;
                event.preventDefault();
                selectTab(tabs[next].key);
                document.getElementById(`${id}-${tabs[next].key}-tab`)?.focus();
              }}
            >
              {label}
            </button>
          ))}
        </div>
        {validation && (
          <p className="product-editor-validation" role="alert">
            {validation}
          </p>
        )}
        <fieldset className="product-editor-fields" disabled={locked}>
          {tabs.map(({ key }) => (
            <div
              key={key}
              id={`${id}-${key}-panel`}
              role="tabpanel"
              tabIndex={0}
              aria-labelledby={`${id}-${key}-tab`}
              data-editor-tab={key}
              hidden={tab !== key}
              inert={tab !== key}
              className="product-editor-panel"
            >
              {key === 'main' && (
                <>
                  {main}
                  {productId && (
                    <ProductInventoryUnit
                      ref={inventoryUnit}
                      productId={productId}
                      onSaved={onAppearanceSaved}
                    />
                  )}
                </>
              )}
              {key === 'facts' && facts}
              {key === 'appearance' &&
                (productId ? (
                  appearanceVisited && (
                    <ProductBadges
                      ref={badges}
                      productId={productId}
                      imageUrl={imageUrl}
                      integrated
                      onBusyChange={setAppearanceBusy}
                      onSaved={onAppearanceSaved}
                    />
                  )
                ) : (
                  <p className="field-hint">
                    Сохраните новый товар, затем выберите для него стикер и метки.
                  </p>
                ))}
            </div>
          ))}
        </fieldset>
      </form>
    </Modal>
  );
}

import { Copy } from '../../components/BulkaIcons';
import ProductEditorModal from './ProductEditorModal';
import { FulfillmentTypeFields, ProductFactsFields } from './menu-page.shared';
import type { MenuPageController } from './use-menu-page-controller';

export function IikoProductEditor({ controller }: { controller: MenuPageController }) {
  const {
    editForm: form,
    setEditForm: setForm,
    editLang: lang,
    setEditLang,
    editingProduct: product,
  } = controller;
  return (
    <ProductEditorModal
      productId={product?.id}
      name={form.name}
      saving={controller.editSaving}
      imageUrl={form.imageUrl || product?.imageLinks?.[0]}
      onClose={() => controller.setEditModalOpen(false)}
      onSubmit={controller.handleSaveProductEdit}
      onAppearanceSaved={() => void controller.fetchMenu(true)}
      catalogValid={form.fulfillment_types.length > 0}
      main={
        <>
          <div className="segmented-control" role="group" aria-label="Язык текста">
            {(['ru', 'kk'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={lang === value}
                className={lang === value ? 'is-active' : undefined}
                onClick={() => setEditLang(value)}
              >
                {value === 'ru' ? 'Русский' : 'Қазақша'}
              </button>
            ))}
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor={`edit-name-${lang}`}>
              Название ({lang.toUpperCase()})
            </label>
            <input
              id={`edit-name-${lang}`}
              className="input-classic"
              type="text"
              value={lang === 'ru' ? form.name : form.name_translations[lang] || ''}
              onChange={(event) =>
                setForm((current) =>
                  lang === 'ru'
                    ? { ...current, name: event.target.value }
                    : {
                        ...current,
                        name_translations: {
                          ...current.name_translations,
                          [lang]: event.target.value,
                        },
                      },
                )
              }
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor={`edit-description-${lang}`}>
              Описание ({lang.toUpperCase()})
            </label>
            <textarea
              id={`edit-description-${lang}`}
              rows={3}
              className="input-classic"
              value={lang === 'ru' ? form.description : form.description_translations[lang] || ''}
              onChange={(event) =>
                setForm((current) =>
                  lang === 'ru'
                    ? { ...current, description: event.target.value }
                    : {
                        ...current,
                        description_translations: {
                          ...current.description_translations,
                          [lang]: event.target.value,
                        },
                      },
                )
              }
            />
          </div>
          {lang === 'kk' && (
            <details className="product-editor-disclosure">
              <summary>Помощь с переводом</summary>
              <div className="flex flex-wrap items-center gap-3 pt-3">
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => void controller.handleCopyRussianDescription()}
                >
                  <Copy aria-hidden="true" size={16} /> Скопировать описание RU
                </button>
                <a
                  href="https://translate.yandex.ru/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm underline"
                >
                  Открыть переводчик
                </a>
              </div>
            </details>
          )}
          <div className="field-group">
            <label className="field-label" htmlFor="edit-price">
              Цена (₸)
            </label>
            <input
              id="edit-price"
              type="number"
              min="0"
              className="input-classic"
              value={form.price || ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, price: Number(event.target.value) }))
              }
            />
            <p className="field-hint">
              {form.price === (product?.price ?? 0)
                ? 'Цена обновляется из iiko.'
                : 'Своя цена для сайта и приложения.'}
            </p>
            {form.price !== (product?.price ?? 0) && (
              <button
                type="button"
                data-unsaved-change
                className="btn-outline"
                onClick={() => setForm((current) => ({ ...current, price: product?.price ?? 0 }))}
              >
                Вернуть цену iiko: {product?.price ?? 0} ₸
              </button>
            )}
          </div>
          <details className="product-editor-disclosure" data-catalog-settings>
            <summary>Где продавать</summary>
            <FulfillmentTypeFields
              idPrefix="edit-fulfillment"
              value={form.fulfillment_types}
              onChange={(fulfillment_types) =>
                setForm((current) => ({ ...current, fulfillment_types }))
              }
            />
          </details>
        </>
      }
      facts={
        <ProductFactsFields
          idPrefix="edit-product"
          value={form}
          grouped
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
        />
      }
    />
  );
}

export function CustomProductEditor({ controller }: { controller: MenuPageController }) {
  const { customForm: form, setCustomForm: setForm } = controller;
  return (
    <ProductEditorModal
      productId={form.id}
      name={form.name}
      imageUrl={form.image_url}
      saving={controller.submitting}
      onClose={() => controller.setModalOpen(false)}
      onSubmit={controller.handleSaveCustom}
      onAppearanceSaved={() => void controller.fetchMenu(true)}
      catalogValid={!form.fulfillment_types || form.fulfillment_types.length > 0}
      main={
        <>
          <div className="field-group">
            <label className="field-label" htmlFor="custom-name">
              Название блюда *
            </label>
            <input
              id="custom-name"
              type="text"
              required
              className="input-classic"
              value={form.name}
              onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="custom-description">
              Описание
            </label>
            <textarea
              id="custom-description"
              rows={3}
              className="input-classic"
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({ ...current, description: event.target.value }))
              }
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="custom-price">
              Цена (₸) *
            </label>
            <input
              id="custom-price"
              type="number"
              min="1"
              required
              className="input-classic"
              value={form.price || ''}
              onChange={(event) =>
                setForm((current) => ({ ...current, price: Number(event.target.value) }))
              }
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="custom-category">
              Категория
            </label>
            <input
              id="custom-category"
              type="text"
              className="input-classic"
              value={form.category_name}
              onChange={(event) =>
                setForm((current) => ({ ...current, category_name: event.target.value }))
              }
            />
          </div>
          <details className="product-editor-disclosure" data-catalog-settings>
            <summary>Где продавать</summary>
            <FulfillmentTypeFields
              idPrefix="custom-fulfillment"
              value={form.fulfillment_types}
              onChange={(fulfillment_types) =>
                setForm((current) => ({ ...current, fulfillment_types }))
              }
            />
          </details>
        </>
      }
      facts={
        <ProductFactsFields
          idPrefix="custom-product"
          value={form}
          grouped
          onChange={(key, value) => setForm((current) => ({ ...current, [key]: value }))}
        />
      }
    />
  );
}

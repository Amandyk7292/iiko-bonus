import { LoaderCircle, Plus, SlidersHorizontal, Trash2 } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import { CustomProductEditor, IikoProductEditor } from './ProductEditorForms';
import SelectControl from '../../components/SelectControl';
import {
  builderOptionSections,
  createModifierOption,
  menuLanguages,
  optionLanguages,
} from './menu-page.shared';
import type { MenuPageController } from './use-menu-page-controller';

export default function MenuEditorModals({ controller }: { controller: MenuPageController }) {
  const {
    categoryEditModalOpen,
    setCategoryEditModalOpen,
    editingCategory,
    categoryEditForm,
    setCategoryEditForm,
    categoryEditSaving,
    editModalOpen,
    modalOpen,
    optionsProduct,
    setOptionsProduct,
    optionsDraft,
    setOptionsDraft,
    optionsSaving,
    handleSaveCategoryEdit,
    updateBuilderOption,
    addBuilderOption,
    removeBuilderOption,
    updateModifierGroup,
    updateModifierOption,
    setModifierDefault,
    addModifierGroup,
    saveOptions,
  } = controller;

  return (
    <>
      <Modal
        open={categoryEditModalOpen}
        onClose={() => !categoryEditSaving && setCategoryEditModalOpen(false)}
        title={`Названия категории: ${editingCategory?.name || ''}`}
        description="Эти названия будут показываться в приложении при выборе соответствующего языка."
      >
        <form onSubmit={handleSaveCategoryEdit} className="modal-body form-stack">
          {menuLanguages.map(({ value, label }) => (
            <div className="field-group" key={value}>
              <label className="field-label" htmlFor={`category-name-${value}`}>
                {label} ({value.toUpperCase()})
              </label>
              <input
                id={`category-name-${value}`}
                type="text"
                maxLength={160}
                required={value === 'ru'}
                value={categoryEditForm[value]}
                onChange={(event) =>
                  setCategoryEditForm((current) => ({
                    ...current,
                    [value]: event.target.value,
                  }))
                }
                className="input-classic"
                placeholder={value === 'ru' ? 'Название категории' : 'Перевод названия'}
              />
            </div>
          ))}
          <p className="page-help">Если KZ не заполнен, приложение использует русское название.</p>
          <div className="modal-actions">
            <button
              type="button"
              onClick={() => setCategoryEditModalOpen(false)}
              className="btn-outline px-5"
              disabled={categoryEditSaving}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={categoryEditSaving}
              className="btn-classic px-5 inline-flex items-center gap-2"
            >
              {categoryEditSaving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {categoryEditSaving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>

      {editModalOpen && (
        <IikoProductEditor key={controller.editingProduct?.id} controller={controller} />
      )}

      <Modal
        open={Boolean(optionsProduct)}
        onClose={() => !optionsSaving && setOptionsProduct(null)}
        title={`Конструктор и опции: ${optionsProduct?.name || ''}`}
        description="Все названия и доплаты вводятся в отдельные поля. Итоговая цена всегда пересчитывается и проверяется сервером."
        size="xl"
      >
        <div className="modal-body form-stack product-options-modal">
          <fieldset className="form-section builder-section">
            <legend>Конструктор торта или выпечки</legend>
            <div className="builder-kind-row">
              <label className="field-group">
                <span className="field-label">Тип товара</span>
                <SelectControl
                  value={optionsDraft.configuration.productKind}
                  onChange={(value) =>
                    setOptionsDraft((current: any) => ({
                      ...current,
                      configuration: {
                        ...current.configuration,
                        productKind: value,
                      },
                    }))
                  }
                  options={[
                    { value: 'standard', label: 'Обычный товар' },
                    { value: 'cake', label: 'Торт на заказ' },
                    { value: 'bakery', label: 'Выпечка на заказ' },
                  ]}
                />
                <small className="field-hint">
                  Для обычного товара конструктор скрыт, но модификаторы ниже продолжат работать.
                </small>
              </label>
              <div className="options-explainer" role="note">
                <SlidersHorizontal aria-hidden="true" size={20} />
                <div>
                  <strong>Что увидит клиент</strong>
                  <p>
                    Вес, начинку, оформление, дату готовности и выбранные дополнительные услуги.
                  </p>
                </div>
              </div>
            </div>

            {optionsDraft.configuration.productKind !== 'standard' ? (
              <>
                <div className="form-grid form-grid-2 builder-schedule-grid">
                  <label className="field-group">
                    <span className="field-label">Сколько часов нужно на приготовление</span>
                    <input
                      type="number"
                      min="0"
                      max="720"
                      className="input-classic"
                      value={optionsDraft.configuration.minLeadHours}
                      onChange={(event) =>
                        setOptionsDraft((current: any) => ({
                          ...current,
                          configuration: {
                            ...current.configuration,
                            minLeadHours: Number(event.target.value),
                          },
                        }))
                      }
                    />
                    <small className="field-hint">
                      Например, 24 — заказать можно минимум за сутки.
                    </small>
                  </label>
                  <label className="field-group">
                    <span className="field-label">На сколько дней вперёд принимаем заказ</span>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      className="input-classic"
                      value={optionsDraft.configuration.maxAdvanceDays}
                      onChange={(event) =>
                        setOptionsDraft((current: any) => ({
                          ...current,
                          configuration: {
                            ...current.configuration,
                            maxAdvanceDays: Number(event.target.value),
                          },
                        }))
                      }
                    />
                    <small className="field-hint">
                      Например, 30 — доступна дата в пределах месяца.
                    </small>
                  </label>
                </div>

                <div className="builder-toggle-row" aria-label="Дополнительные возможности">
                  {(
                    [
                      ['allowInscription', 'Разрешить надпись'],
                      ['allowCandles', 'Добавить свечи'],
                      ['allowReferenceUpload', 'Загрузить пример оформления'],
                    ] as const
                  ).map(([field, label]) => (
                    <label className="switch-row builder-feature-toggle" key={field}>
                      <input
                        type="checkbox"
                        checked={Boolean(optionsDraft.configuration[field])}
                        onChange={(event) =>
                          setOptionsDraft((current: any) => ({
                            ...current,
                            configuration: {
                              ...current.configuration,
                              [field]: event.target.checked,
                            },
                          }))
                        }
                      />
                      <span className="switch-control" />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <div className="builder-options-grid">
                  {builderOptionSections.map((section) => {
                    const options = optionsDraft.configuration[section.key] || [];
                    return (
                      <section className="builder-option-card" key={section.key}>
                        <header>
                          <div>
                            <h4>{section.title}</h4>
                            <p>{section.description}</p>
                          </div>
                          <span className="option-count">{options.length}</span>
                        </header>
                        <div className="builder-option-list">
                          {options.length === 0 && (
                            <div className="compact-empty-state">Варианты ещё не добавлены</div>
                          )}
                          {options.map((option: any, optionIndex: number) => (
                            <div
                              className="builder-option-row"
                              key={option.id || option.code || optionIndex}
                            >
                              <div className="localized-option-fields">
                                {optionLanguages.map((language) => (
                                  <label className="field-group" key={language.code}>
                                    <span className="field-label">{language.label}</span>
                                    <input
                                      className="input-classic"
                                      value={option.title?.[language.code] || ''}
                                      placeholder={
                                        language.code === 'ru'
                                          ? section.placeholder
                                          : 'Обязательный перевод'
                                      }
                                      onChange={(event) =>
                                        updateBuilderOption(section.key, optionIndex, {
                                          title: {
                                            ...(option.title || {}),
                                            [language.code]: event.target.value,
                                          },
                                        })
                                      }
                                    />
                                  </label>
                                ))}
                              </div>
                              <label className="field-group">
                                <span className="field-label">Доплата, ₸</span>
                                <input
                                  type="number"
                                  min="0"
                                  step="1"
                                  className="input-classic"
                                  value={option.priceDelta || 0}
                                  onChange={(event) =>
                                    updateBuilderOption(section.key, optionIndex, {
                                      priceDelta: Number(event.target.value),
                                    })
                                  }
                                />
                              </label>
                              <button
                                type="button"
                                className="icon-button icon-button-danger builder-remove-button"
                                aria-label={`Удалить вариант ${section.title}`}
                                title={`Удалить вариант ${section.title}`}
                                onClick={() => removeBuilderOption(section.key, optionIndex)}
                              >
                                <Trash2 aria-hidden="true" size={17} />
                              </button>
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="btn-outline option-add-button inline-flex items-center justify-center gap-2"
                          onClick={() => addBuilderOption(section.key, section.prefix)}
                        >
                          <Plus aria-hidden="true" size={16} />
                          Добавить вариант
                        </button>
                      </section>
                    );
                  })}
                </div>
              </>
            ) : (
              <div className="builder-disabled-note">
                Выберите «Торт на заказ» или «Выпечка на заказ», чтобы добавить вес, начинку и
                оформление.
              </div>
            )}
          </fieldset>

          <section className="form-section modifiers-section">
            <div className="section-heading">
              <h3 className="content-heading">Модификаторы товара</h3>
              <p className="page-help">
                Дополнительные вопросы, которые клиент увидит перед добавлением товара в корзину.
              </p>
            </div>

            <div className="modifier-guide" role="note">
              <SlidersHorizontal aria-hidden="true" size={20} />
              <div>
                <strong>Пример</strong>
                <p>
                  <b>Группа:</b> «Размер». <b>Варианты:</b> «Маленький — 0 ₸», «Большой — +500 ₸».
                </p>
              </div>
            </div>

            <div className="modifier-template-row">
              <span>Быстро добавить:</span>
              <button
                type="button"
                className="modifier-template-button"
                onClick={() => addModifierGroup('Размер', 'single', true)}
              >
                Размер
              </button>
              <button
                type="button"
                className="modifier-template-button"
                onClick={() => addModifierGroup('Добавки', 'multiple', false)}
              >
                Добавки
              </button>
              <button
                type="button"
                className="modifier-template-button"
                onClick={() => addModifierGroup('Упаковка', 'single', false)}
              >
                Упаковка
              </button>
              <button
                type="button"
                className="btn-outline compact-button inline-flex items-center gap-2"
                onClick={() => addModifierGroup()}
              >
                <Plus aria-hidden="true" size={15} />
                Своя группа
              </button>
            </div>

            {optionsDraft.modifierGroups.length === 0 && (
              <div className="modifier-empty-state">
                <strong>Модификаторов пока нет</strong>
                <p>
                  Если товар продаётся без размеров, добавок и вариантов упаковки, этот раздел можно
                  оставить пустым.
                </p>
              </div>
            )}

            <div className="modifier-editor-list">
              {optionsDraft.modifierGroups.map((group: any, groupIndex: number) => (
                <article
                  className="modifier-editor"
                  key={`${group.id || group.code}-${groupIndex}`}
                >
                  <header className="modifier-editor-title">
                    <div>
                      <span>Группа {groupIndex + 1}</span>
                      <strong>{group.title?.ru || 'Без названия'}</strong>
                    </div>
                    <button
                      type="button"
                      className="icon-button icon-button-danger"
                      aria-label={`Удалить группу ${groupIndex + 1}`}
                      title={`Удалить группу ${groupIndex + 1}`}
                      onClick={() =>
                        setOptionsDraft((current: any) => ({
                          ...current,
                          modifierGroups: current.modifierGroups.filter(
                            (_: any, index: number) => index !== groupIndex,
                          ),
                        }))
                      }
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  </header>

                  <div className="modifier-group-settings">
                    <div className="localized-option-fields">
                      {optionLanguages.map((language) => (
                        <label className="field-group" key={language.code}>
                          <span className="field-label">
                            {language.code === 'ru' ? 'Название группы RU' : language.label}
                          </span>
                          <input
                            className="input-classic"
                            value={group.title?.[language.code] || ''}
                            placeholder={
                              language.code === 'ru' ? 'Например, Размер' : 'Обязательный перевод'
                            }
                            onChange={(event) =>
                              updateModifierGroup(groupIndex, {
                                title: {
                                  ...(group.title || {}),
                                  [language.code]: event.target.value,
                                },
                              })
                            }
                          />
                        </label>
                      ))}
                      <small className="field-hint">Это вопрос, который увидит клиент.</small>
                    </div>
                    <label className="field-group">
                      <span className="field-label">Сколько вариантов можно выбрать</span>
                      <SelectControl
                        value={group.selectionType || 'single'}
                        onChange={(value) =>
                          updateModifierGroup(groupIndex, {
                            selectionType: value,
                            maxSelected:
                              value === 'single' ? 1 : Math.max(1, group.maxSelected || 1),
                          })
                        }
                        options={[
                          { value: 'single', label: 'Только один' },
                          { value: 'multiple', label: 'Несколько' },
                        ]}
                      />
                      <small className="field-hint">
                        Для размера — один, для добавок — несколько.
                      </small>
                    </label>
                    <label className="modifier-required-card">
                      <span>
                        <strong>Обязательный выбор</strong>
                        <small>Без выбора товар нельзя добавить в корзину.</small>
                      </span>
                      <span className="switch-row">
                        <input
                          type="checkbox"
                          checked={group.required === true}
                          onChange={(event) =>
                            updateModifierGroup(groupIndex, {
                              required: event.target.checked,
                              minSelected: event.target.checked
                                ? Math.max(1, group.minSelected || 0)
                                : 0,
                            })
                          }
                        />
                        <span className="switch-control" />
                      </span>
                    </label>
                  </div>

                  {group.selectionType === 'multiple' && (
                    <div className="modifier-limits">
                      <label className="field-group">
                        <span className="field-label">Минимум вариантов</span>
                        <input
                          type="number"
                          min={group.required ? 1 : 0}
                          max="20"
                          className="input-classic"
                          value={group.minSelected || 0}
                          onChange={(event) =>
                            updateModifierGroup(groupIndex, {
                              minSelected: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                      <label className="field-group">
                        <span className="field-label">Максимум вариантов</span>
                        <input
                          type="number"
                          min="1"
                          max="20"
                          className="input-classic"
                          value={group.maxSelected || 1}
                          onChange={(event) =>
                            updateModifierGroup(groupIndex, {
                              maxSelected: Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    </div>
                  )}

                  <div className="modifier-options">
                    <div className="modifier-options-heading">
                      <div>
                        <strong>Варианты ответа</strong>
                        <p>Добавьте названия и, при необходимости, доплату.</p>
                      </div>
                      <button
                        type="button"
                        className="btn-outline compact-button inline-flex items-center gap-2"
                        onClick={() =>
                          updateModifierGroup(groupIndex, {
                            options: [...(group.options || []), createModifierOption()],
                          })
                        }
                      >
                        <Plus aria-hidden="true" size={15} />
                        Добавить вариант
                      </button>
                    </div>

                    {(group.options || []).map((option: any, optionIndex: number) => (
                      <div
                        className="modifier-option-row"
                        key={`${option.id || option.code}-${optionIndex}`}
                      >
                        <div className="localized-option-fields">
                          {optionLanguages.map((language) => (
                            <label className="field-group" key={language.code}>
                              <span className="field-label">
                                {language.code === 'ru' ? 'Вариант RU' : language.label}
                              </span>
                              <input
                                className="input-classic"
                                value={option.title?.[language.code] || ''}
                                onChange={(event) =>
                                  updateModifierOption(groupIndex, optionIndex, {
                                    title: {
                                      ...(option.title || {}),
                                      [language.code]: event.target.value,
                                    },
                                  })
                                }
                                placeholder={
                                  language.code === 'ru'
                                    ? 'Например, Большой'
                                    : 'Обязательный перевод'
                                }
                              />
                            </label>
                          ))}
                        </div>
                        <label className="field-group">
                          <span className="field-label">Доплата, ₸</span>
                          <input
                            type="number"
                            min="0"
                            step="1"
                            className="input-classic"
                            value={option.priceDelta || 0}
                            onChange={(event) =>
                              updateModifierOption(groupIndex, optionIndex, {
                                priceDelta: Number(event.target.value),
                              })
                            }
                          />
                        </label>
                        <label className="modifier-default-card">
                          <span>Выбран по умолчанию</span>
                          <span className="switch-row">
                            <input
                              type="checkbox"
                              checked={option.isDefault === true}
                              onChange={(event) =>
                                setModifierDefault(groupIndex, optionIndex, event.target.checked)
                              }
                            />
                            <span className="switch-control" />
                          </span>
                        </label>
                        <button
                          type="button"
                          className="icon-button icon-button-danger modifier-remove-button"
                          aria-label={`Удалить вариант ${optionIndex + 1}`}
                          title={`Удалить вариант ${optionIndex + 1}`}
                          onClick={() =>
                            updateModifierGroup(groupIndex, {
                              options: group.options.filter(
                                (_: any, index: number) => index !== optionIndex,
                              ),
                            })
                          }
                        >
                          <Trash2 aria-hidden="true" size={16} />
                        </button>
                      </div>
                    ))}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <div className="modal-actions sticky-modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={() => setOptionsProduct(null)}
              disabled={optionsSaving}
            >
              Отмена
            </button>
            <button
              type="button"
              className="btn-classic px-5 inline-flex items-center gap-2"
              onClick={() => void saveOptions()}
              disabled={optionsSaving}
            >
              {optionsSaving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {optionsSaving ? 'Сохранение…' : 'Сохранить настройки'}
            </button>
          </div>
        </div>
      </Modal>

      {modalOpen && (
        <CustomProductEditor key={controller.customForm.id || 'new'} controller={controller} />
      )}
    </>
  );
}

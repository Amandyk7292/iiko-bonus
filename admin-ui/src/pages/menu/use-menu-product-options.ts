import { useState } from 'react';
import { api } from '../../lib/api';
import {
  builderOptionSections,
  createBuilderOption,
  createModifierGroup,
  emptyProductOptions,
  optionLanguages,
  type BuilderOptionKey,
  type IikoProduct,
} from './menu-page.shared';

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

export function useMenuProductOptions(toast: Toast) {
  const [optionsProduct, setOptionsProduct] = useState<IikoProduct | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<any>(emptyProductOptions);
  const [optionsSaving, setOptionsSaving] = useState(false);

  const openOptionsModal = async (product: IikoProduct) => {
    setOptionsProduct(product);
    setOptionsDraft(emptyProductOptions);
    try {
      const result = await api.getProductOptions(product.id);
      const loaded = result.products?.[product.id] || emptyProductOptions;
      const configuration = loaded.configuration || emptyProductOptions.configuration;
      setOptionsDraft({ configuration, modifierGroups: loaded.modifierGroups || [] });
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось загрузить опции', 'error');
      setOptionsProduct(null);
    }
  };

  const updateBuilderOption = (
    field: BuilderOptionKey,
    index: number,
    patch: Record<string, unknown>,
  ) =>
    setOptionsDraft((current: any) => ({
      ...current,
      configuration: {
        ...current.configuration,
        [field]: (current.configuration[field] || []).map((option: any, optionIndex: number) =>
          optionIndex === index ? { ...option, ...patch } : option,
        ),
      },
    }));

  const addBuilderOption = (field: BuilderOptionKey, prefix: string) =>
    setOptionsDraft((current: any) => ({
      ...current,
      configuration: {
        ...current.configuration,
        [field]: [...(current.configuration[field] || []), createBuilderOption(prefix)],
      },
    }));

  const removeBuilderOption = (field: BuilderOptionKey, index: number) =>
    setOptionsDraft((current: any) => ({
      ...current,
      configuration: {
        ...current.configuration,
        [field]: (current.configuration[field] || []).filter(
          (_: any, optionIndex: number) => optionIndex !== index,
        ),
      },
    }));

  const updateModifierGroup = (index: number, patch: Record<string, unknown>) =>
    setOptionsDraft((current: any) => ({
      ...current,
      modifierGroups: current.modifierGroups.map((group: any, groupIndex: number) =>
        groupIndex === index ? { ...group, ...patch } : group,
      ),
    }));

  const updateModifierOption = (
    groupIndex: number,
    optionIndex: number,
    patch: Record<string, unknown>,
  ) =>
    setOptionsDraft((current: any) => ({
      ...current,
      modifierGroups: current.modifierGroups.map((group: any, currentGroup: number) =>
        currentGroup === groupIndex
          ? {
              ...group,
              options: group.options.map((option: any, currentOption: number) =>
                currentOption === optionIndex ? { ...option, ...patch } : option,
              ),
            }
          : group,
      ),
    }));

  const setModifierDefault = (groupIndex: number, optionIndex: number, checked: boolean) =>
    setOptionsDraft((current: any) => ({
      ...current,
      modifierGroups: current.modifierGroups.map((group: any, currentGroup: number) =>
        currentGroup === groupIndex
          ? {
              ...group,
              options: group.options.map((option: any, currentOption: number) => ({
                ...option,
                isDefault:
                  currentOption === optionIndex
                    ? checked
                    : group.selectionType === 'single' && checked
                      ? false
                      : option.isDefault,
              })),
            }
          : group,
      ),
    }));

  const addModifierGroup = (
    title = '',
    selectionType: 'single' | 'multiple' = 'single',
    required = false,
  ) =>
    setOptionsDraft((current: any) => ({
      ...current,
      modifierGroups: [
        ...current.modifierGroups,
        createModifierGroup(title, selectionType, required),
      ],
    }));

  const saveOptions = async () => {
    if (!optionsProduct) return;
    setOptionsSaving(true);
    try {
      const configuration = { ...optionsDraft.configuration };
      for (const section of builderOptionSections) {
        configuration[section.key] = (configuration[section.key] || []).map(
          (option: any, index: number) => {
            const title = {
              ru: String(option.title?.ru || option.name || '').trim(),
              kk: String(option.title?.kk || '').trim(),
              en: String(option.title?.en || '').trim(),
            };
            const priceDelta = Number(option.priceDelta || 0);
            const missingLanguage = optionLanguages.find(({ code }) => !title[code]);
            if (missingLanguage) {
              throw new Error(
                `Заполните ${missingLanguage.label}: «${section.title}», строка ${index + 1}`,
              );
            }
            if (!Number.isFinite(priceDelta) || priceDelta < 0) {
              throw new Error(`Некорректная доплата: «${section.title}», строка ${index + 1}`);
            }
            return {
              ...option,
              code: option.code || `${section.prefix}_${index + 1}`,
              title,
              priceDelta,
            };
          },
        );
      }

      const modifierGroups = optionsDraft.modifierGroups.map((group: any, index: number) => {
        const groupTitle = {
          ru: String(group.title?.ru || group.name || '').trim(),
          kk: String(group.title?.kk || '').trim(),
          en: String(group.title?.en || '').trim(),
        };
        const missingGroupLanguage = optionLanguages.find(({ code }) => !groupTitle[code]);
        if (missingGroupLanguage) {
          throw new Error(`Заполните ${missingGroupLanguage.label} для группы №${index + 1}`);
        }
        const groupName = groupTitle.ru;
        if (!(group.options || []).length) {
          throw new Error(`Добавьте хотя бы один вариант в группу «${groupName}»`);
        }
        const options = group.options.map((option: any, optionIndex: number) => {
          const optionTitle = {
            ru: String(option.title?.ru || option.name || '').trim(),
            kk: String(option.title?.kk || '').trim(),
            en: String(option.title?.en || '').trim(),
          };
          const missingOptionLanguage = optionLanguages.find(({ code }) => !optionTitle[code]);
          const priceDelta = Number(option.priceDelta || 0);
          if (missingOptionLanguage) {
            throw new Error(
              `Заполните ${missingOptionLanguage.label} для варианта №${optionIndex + 1} в группе «${groupName}»`,
            );
          }
          const optionName = optionTitle.ru;
          if (!Number.isFinite(priceDelta) || priceDelta < 0) {
            throw new Error(`Некорректная доплата у «${optionName}»`);
          }
          return {
            ...option,
            code: option.code || `option_${optionIndex + 1}`,
            title: optionTitle,
            priceDelta,
          };
        });
        const selectionType = group.selectionType === 'multiple' ? 'multiple' : 'single';
        const maxSelected =
          selectionType === 'single'
            ? 1
            : Math.min(options.length, Math.max(1, Number(group.maxSelected || 1)));
        const minSelected = group.required
          ? Math.max(1, Number(group.minSelected || 1))
          : Math.max(0, Number(group.minSelected || 0));
        if (minSelected > maxSelected) {
          throw new Error(`В группе «${groupName}» минимум не может быть больше максимума`);
        }
        return {
          ...group,
          code: group.code || `group_${index + 1}`,
          title: groupTitle,
          selectionType,
          minSelected,
          maxSelected,
          options,
        };
      });
      await api.saveProductOptions(optionsProduct.id, { configuration, modifierGroups });
      toast('Конструктор и модификаторы сохранены');
      setOptionsProduct(null);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Опции не сохранены', 'error');
    } finally {
      setOptionsSaving(false);
    }
  };

  return {
    optionsProduct,
    setOptionsProduct,
    optionsDraft,
    setOptionsDraft,
    optionsSaving,
    openOptionsModal,
    updateBuilderOption,
    addBuilderOption,
    removeBuilderOption,
    updateModifierGroup,
    updateModifierOption,
    setModifierDefault,
    addModifierGroup,
    saveOptions,
  };
}

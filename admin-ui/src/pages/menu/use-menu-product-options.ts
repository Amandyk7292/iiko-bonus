import { useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { productOptionsPayload } from './menu-product-options-payload';
import {
  createBuilderOption,
  createModifierGroup,
  emptyProductOptions,
  type BuilderOptionKey,
  type IikoProduct,
} from './menu-page.shared';

type Toast = (message: string, type?: 'success' | 'error' | 'info') => void;

export function useMenuProductOptions(toast: Toast) {
  const [optionsProduct, setOptionsProductState] = useState<IikoProduct | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<any>(emptyProductOptions);
  const [optionsLoading, setOptionsLoading] = useState(false);
  const [optionsSaving, setOptionsSaving] = useState(false);
  const generation = useRef(0);
  const activeLoad = useRef<AbortController | null>(null);
  const currentProduct = useRef<string | null>(null);
  const loadedProduct = useRef<string | null>(null);
  const saving = useRef(false);

  const setOptionsProduct = (product: IikoProduct | null) => {
    generation.current++;
    activeLoad.current?.abort();
    currentProduct.current = product?.id ?? null;
    loadedProduct.current = null;
    setOptionsProductState(product);
    setOptionsLoading(false);
  };

  useEffect(() => () => {
    generation.current++;
    activeLoad.current?.abort();
    currentProduct.current = null;
  }, []);

  const openOptionsModal = async (product: IikoProduct) => {
    setOptionsProduct(product);
    setOptionsDraft(emptyProductOptions);
    const version = generation.current;
    const controller = new AbortController();
    activeLoad.current = controller;
    const current = () => !controller.signal.aborted && version === generation.current;
    setOptionsLoading(true);
    try {
      const result = await api.getProductOptions(product.id, controller.signal);
      if (!current()) return;
      const loaded = result.products?.[product.id] || emptyProductOptions;
      const configuration = loaded.configuration || emptyProductOptions.configuration;
      setOptionsDraft({ configuration, modifierGroups: loaded.modifierGroups || [] });
      loadedProduct.current = product.id;
    } catch (caught) {
      if (!current()) return;
      toast(caught instanceof Error ? caught.message : 'Не удалось загрузить опции', 'error');
      setOptionsProduct(null);
    } finally {
      if (current()) setOptionsLoading(false);
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
    if (!optionsProduct || loadedProduct.current !== optionsProduct.id || saving.current) return;
    const productId = optionsProduct.id;
    saving.current = true;
    setOptionsSaving(true);
    try {
      await api.saveProductOptions(productId, productOptionsPayload(optionsDraft));
      toast('Конструктор и модификаторы сохранены');
      if (currentProduct.current === productId) setOptionsProduct(null);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Опции не сохранены', 'error');
    } finally {
      saving.current = false;
      setOptionsSaving(false);
    }
  };

  return {
    optionsProduct,
    setOptionsProduct,
    optionsDraft,
    setOptionsDraft,
    optionsLoading,
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

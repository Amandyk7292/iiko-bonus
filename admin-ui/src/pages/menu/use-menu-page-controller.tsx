import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useFeedback } from '../../components/Feedback';
import { api, type AdminScopeLocation } from '../../lib/api';
import { useI18n } from '../../lib/i18n';
import { useSearchParams } from '../../lib/router';
import { type MenuProfileStatus } from './MenuCityScope';
import { type MenuWorkspaceTab } from './MenuWorkspaceToolbar';
import { useMenuCitySelection } from './use-menu-city-selection';
import { useOptimisticMenuActions } from './use-optimistic-menu-actions';
import {
  builderOptionSections,
  categoryNameKeys,
  compareMenuNames,
  createBuilderOption,
  createModifierGroup,
  defaultFulfillmentTypes,
  emptyProductOptions,
  emptyTranslations,
  indexCategoryOverrides,
  indexProductOverrides,
  menuLanguages,
  normalizeFulfillmentTypes,
  normalizeTranslations,
  optionLanguages,
  resolveIikoProductPrices,
  resolvedCategoryName,
  resolvedProductName,
  sanitizeProductOverridePatch,
  type BuilderOptionKey,
  type CategoryOverride,
  type CustomProduct,
  type FulfillmentType,
  type IikoGroup,
  type IikoProduct,
  type MenuLanguage,
  type ProductOverride,
  type ProductStorageCondition,
} from './menu-page.shared';

export type MenuPageProps = {
  scopeLocations: AdminScopeLocation[];
  selectedBranchId: string;
  onBranchChange: (branchId: string) => void;
};

export function useMenuPageController({
  scopeLocations,
  selectedBranchId,
  onBranchChange,
}: MenuPageProps) {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();

  const requestedTab = params.get('tab');
  const activeTab: MenuWorkspaceTab =
    requestedTab === 'categories' || requestedTab === 'custom' ? requestedTab : 'products';
  const setActiveTab = (value: MenuWorkspaceTab) => {
    const next = new URLSearchParams(params);
    if (value === 'products') next.delete('tab');
    else next.set('tab', value);
    setParams(next);
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [rawProducts, setRawProducts] = useState<IikoProduct[]>([]);
  const [rawGroups, setRawGroups] = useState<IikoGroup[]>([]);
  const [productOverrides, setProductOverrides] = useState<Record<string, ProductOverride>>({});
  const [categoryOverrides, setCategoryOverrides] = useState<Record<string, CategoryOverride>>({});
  const [customProducts, setCustomProducts] = useState<CustomProduct[]>([]);
  const [activeProfileKey, setActiveProfileKey] = useState<string>();
  const [profileStatuses, setProfileStatuses] = useState<Record<string, MenuProfileStatus>>({});

  const [searchQuery, setSearchQuery] = useState(params.get('search') || '');
  const selectedCategory = params.get('category') || 'all';
  const setSelectedCategory = (value: string) => {
    const next = new URLSearchParams(params);
    if (value === 'all') next.delete('category');
    else next.set('category', value);
    setParams(next);
  };
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [syncingIiko, setSyncingIiko] = useState(false);
  const iikoSyncInFlight = useRef(false);
  const { handleToggleProductHidden, handleToggleStopList, handleToggleCategoryHidden } =
    useOptimisticMenuActions({
      setProductOverrides,
      setCategoryOverrides,
      selectedCategory,
      setSelectedCategory,
      toast,
    });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (searchQuery.trim()) next.set('search', searchQuery.trim());
      else next.delete('search');
      setParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery, setParams]);

  const [categoryEditModalOpen, setCategoryEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<IikoGroup | null>(null);
  const [categoryEditForm, setCategoryEditForm] =
    useState<Record<MenuLanguage, string>>(emptyTranslations);
  const [categoryEditSaving, setCategoryEditSaving] = useState(false);

  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingProduct, setEditingProduct] = useState<IikoProduct | null>(null);
  const [editForm, setEditForm] = useState({
    name: '',
    name_translations: { ru: '', kk: '', en: '' } as Record<string, string>,
    price: 0,
    description: '',
    description_translations: { ru: '', kk: '', en: '' } as Record<string, string>,
    imageUrl: '',
    ingredients: '',
    ingredients_translations: { ru: '', kk: '', en: '' } as Record<string, string>,
    allergens: '' as string | string[],
    dietary_tags: '' as string | string[],
    search_keywords: '' as string | string[],
    weight_grams: undefined as number | null | undefined,
    calories_kcal: undefined as number | null | undefined,
    protein_grams: undefined as number | null | undefined,
    fat_grams: undefined as number | null | undefined,
    carbs_grams: undefined as number | null | undefined,
    storage_conditions: [] as ProductStorageCondition[],
    fulfillment_types: [...defaultFulfillmentTypes] as FulfillmentType[],
  });
  const [editLang, setEditLang] = useState<'ru' | 'kk' | 'en'>('ru');
  const [editSaving, setEditSaving] = useState(false);

  const [modalOpen, setModalOpen] = useState(false);
  const [customForm, setCustomForm] = useState<CustomProduct>({
    name: '',
    description: '',
    price: 0,
    category_name: 'Фирменное',
    image_url: '',
    is_available: true,
    ingredients: '',
    allergens: [],
    dietary_tags: [],
    search_keywords: [],
    storage_conditions: [],
    fulfillment_types: [...defaultFulfillmentTypes],
  });
  const [submitting, setSubmitting] = useState(false);

  const [displayCount, setDisplayCount] = useState(30);
  const [optionsProduct, setOptionsProduct] = useState<IikoProduct | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<any>(emptyProductOptions);
  const [optionsSaving, setOptionsSaving] = useState(false);

  const fetchMenu = useCallback(async () => {
    if (!selectedBranchId) {
      setLoading(false);
      setError('');
      setRawProducts([]);
      setRawGroups([]);
      setProductOverrides({});
      setCategoryOverrides({});
      setCustomProducts([]);
      setActiveProfileKey(undefined);
      return;
    }
    setLoading(true);
    setError('');
    setDisplayCount(30);
    try {
      const data = await api.getAdminMenu();
      const raw = data.rawMenu || {};
      setRawProducts(resolveIikoProductPrices(raw.products));
      setRawGroups(raw.groups || []);
      setProductOverrides(indexProductOverrides(data.overrides?.products));
      setCategoryOverrides(indexCategoryOverrides(data.overrides?.categories));
      setCustomProducts(data.overrides?.customProducts || []);
      setActiveProfileKey(data.profileKey);
      setProfileStatuses(data.profiles || {});
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [selectedBranchId, t]);

  useEffect(() => {
    void fetchMenu();
  }, [fetchMenu]);

  const handleMenuBranchChange = useMenuCitySelection({
    locations: scopeLocations,
    selectedBranchId,
    setSearchParams: setParams,
    onBranchChange,
    hasOpenEditor: categoryEditModalOpen || editModalOpen || modalOpen || Boolean(optionsProduct),
    confirm,
  });

  const handleSyncIikoMenu = async () => {
    if (iikoSyncInFlight.current) return;
    iikoSyncInFlight.current = true;
    setSyncingIiko(true);
    try {
      const result = await api.syncIikoMenu();
      await fetchMenu();
      const selectedCity =
        scopeLocations.find((location) => location.id === selectedBranchId)?.city ||
        (result.profileKey === 'astana' ? 'Астана' : 'Основной профиль');
      toast(
        `${selectedCity}: синхронизировано ${result.productsCount} товаров и ${result.categoriesCount} категорий`,
        'success',
      );
    } catch (error) {
      toast(
        error instanceof Error ? error.message : 'Не удалось синхронизировать меню с iiko',
        'error',
      );
    } finally {
      iikoSyncInFlight.current = false;
      setSyncingIiko(false);
    }
  };

  const handleUploadPhoto = async (productId: string, file: File) => {
    setUploadingId(productId);
    try {
      const res = await api.uploadMenuPhoto(file);
      if (res.success && res.imageUrl) {
        const cur = productOverrides[productId] || { iiko_product_id: productId };
        const updated = { ...cur, custom_image_url: res.imageUrl };
        await api.setProductOverride(productId, { custom_image_url: res.imageUrl });
        setProductOverrides((prev) => ({ ...prev, [productId]: updated }));
        toast('Фотография блюда загружена и сохранена', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки фото', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const handleUploadCategoryPhoto = async (categoryId: string, file: File) => {
    setUploadingId(categoryId);
    try {
      const res = await api.uploadMenuPhoto(file);
      if (res.success && res.imageUrl) {
        const cur = categoryOverrides[categoryId] || { iiko_category_id: categoryId };
        const updated = { ...cur, custom_image_url: res.imageUrl };
        await api.setCategoryOverride(categoryId, { custom_image_url: res.imageUrl });
        setCategoryOverrides((prev) => ({ ...prev, [categoryId]: updated }));
        toast('Фотография категории загружена и сохранена', 'success');
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка загрузки фото', 'error');
    } finally {
      setUploadingId(null);
    }
  };

  const openCategoryEditModal = (category: IikoGroup) => {
    const override = categoryOverrides[category.id];
    const translations = normalizeTranslations(override?.name_translations);
    setEditingCategory(category);
    setCategoryEditForm({
      ...translations,
      ru: translations.ru || override?.custom_name || category.name || '',
    });
    setCategoryEditModalOpen(true);
  };

  const handleSaveCategoryEdit = async (event: FormEvent) => {
    event.preventDefault();
    if (!editingCategory) return;

    const translations = Object.fromEntries(
      menuLanguages.map(({ value }) => [value, categoryEditForm[value].trim()]),
    ) as Record<MenuLanguage, string>;
    if (!translations.ru) {
      toast('Укажите название категории на русском языке', 'error');
      return;
    }

    setCategoryEditSaving(true);
    try {
      const patch: Partial<CategoryOverride> = {
        custom_name: translations.ru === editingCategory.name ? null : translations.ru,
        name_translations: translations,
      };
      await api.setCategoryOverride(editingCategory.id, patch);
      setCategoryOverrides((previous) => ({
        ...previous,
        [editingCategory.id]: {
          ...(previous[editingCategory.id] || { iiko_category_id: editingCategory.id }),
          ...patch,
        },
      }));
      toast('Названия категории сохранены', 'success');
      setCategoryEditModalOpen(false);
    } catch (error) {
      toast(error instanceof Error ? error.message : 'Ошибка сохранения категории', 'error');
    } finally {
      setCategoryEditSaving(false);
    }
  };

  const handleSaveCustom = async (e: FormEvent) => {
    e.preventDefault();
    if (!customForm.name || !customForm.price) return;
    if (normalizeFulfillmentTypes(customForm.fulfillment_types).length === 0) {
      toast('Выберите хотя бы один каталог заказа', 'error');
      return;
    }
    setSubmitting(true);
    try {
      await api.upsertCustomProduct(customForm);
      toast('Блюдо успешно сохранено', 'success');
      setModalOpen(false);
      void fetchMenu();
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка сохранения', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (product: IikoProduct) => {
    const override = productOverrides[product.id];
    setEditingProduct(product);
    setEditForm({
      name: override?.custom_name || product.name || '',
      name_translations: override?.name_translations || { ru: '', kk: '', en: '' },
      price: override?.custom_price || product.price || 0,
      description: override?.custom_description || product.description || '',
      description_translations: override?.description_translations || { ru: '', kk: '', en: '' },
      imageUrl: override?.custom_image_url || '',
      ingredients: override?.ingredients || '',
      ingredients_translations: override?.ingredients_translations || { ru: '', kk: '', en: '' },
      allergens: override?.allergens || [],
      dietary_tags: override?.dietary_tags || [],
      search_keywords: override?.search_keywords || [],
      weight_grams: override?.weight_grams,
      calories_kcal: override?.calories_kcal,
      protein_grams: override?.protein_grams,
      fat_grams: override?.fat_grams,
      carbs_grams: override?.carbs_grams,
      storage_conditions: override?.storage_conditions || [],
      fulfillment_types: normalizeFulfillmentTypes(override?.fulfillment_types),
    });
    setEditModalOpen(true);
  };

  const handleSaveProductEdit = async (e: FormEvent) => {
    e.preventDefault();
    if (!editingProduct) return;
    if (editForm.fulfillment_types.length === 0) {
      toast('Выберите хотя бы один каталог заказа', 'error');
      return;
    }
    setEditSaving(true);
    try {
      const cur = productOverrides[editingProduct.id] || { iiko_product_id: editingProduct.id };
      const updated: ProductOverride = {
        ...cur,
        custom_name: editForm.name !== editingProduct.name ? editForm.name : undefined,
        name_translations: editForm.name_translations,
        custom_price: editForm.price !== (editingProduct.price || 0) ? editForm.price : undefined,
        custom_description:
          editForm.description !== (editingProduct.description || '')
            ? editForm.description.trim() || null
            : null,
        description_translations: editForm.description_translations,
        custom_image_url: editForm.imageUrl || cur.custom_image_url || undefined,
        ingredients: editForm.ingredients.trim() || null,
        ingredients_translations: editForm.ingredients_translations,
        allergens: editForm.allergens,
        dietary_tags: editForm.dietary_tags,
        search_keywords: editForm.search_keywords,
        weight_grams: editForm.weight_grams,
        calories_kcal: editForm.calories_kcal,
        protein_grams: editForm.protein_grams,
        fat_grams: editForm.fat_grams,
        carbs_grams: editForm.carbs_grams,
        storage_conditions: editForm.storage_conditions,
        fulfillment_types: editForm.fulfillment_types,
      };
      await api.setProductOverride(editingProduct.id, sanitizeProductOverridePatch(updated));
      setProductOverrides((prev) => ({ ...prev, [editingProduct.id]: updated }));
      toast('Изменения сохранены', 'success');
      setEditModalOpen(false);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ошибка сохранения', 'error');
    } finally {
      setEditSaving(false);
    }
  };

  const handleAutoTranslate = async (targetLang: 'kk' | 'en') => {
    try {
      const texts = [editForm.name, editForm.description, editForm.ingredients];
      if (!texts.some(Boolean)) return toast('Нет текста для перевода', 'info');

      const translate = async (text: string) => {
        if (!text) return '';
        const res = await api.translate(text, targetLang);
        return res.translated || '';
      };

      toast('Переводим…', 'info');
      const [transName, transDesc, transIngredients] = await Promise.all([
        translate(editForm.name),
        translate(editForm.description),
        translate(editForm.ingredients),
      ]);

      setEditForm((prev) => ({
        ...prev,
        name_translations: { ...prev.name_translations, [targetLang]: transName },
        description_translations: { ...prev.description_translations, [targetLang]: transDesc },
        ingredients_translations: {
          ...prev.ingredients_translations,
          [targetLang]: transIngredients,
        },
      }));
      toast(`Успешно переведено на ${targetLang.toUpperCase()}`, 'success');
    } catch (error) {
      toast('Ошибка автоматического перевода', 'error');
    }
  };

  const handleDeleteCustom = async (id: string) => {
    if (
      !(await confirm({
        title: 'Удалить блюдо?',
        body: 'Это блюдо исчезнет из мобильного приложения.',
        destructive: true,
      }))
    )
      return;
    try {
      await api.deleteCustomProduct(id);
      toast('Блюдо удалено', 'success');
      setCustomProducts((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      toast('Ошибка удаления', 'error');
    }
  };

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

  const hiddenCategoryNameKeys = useMemo(() => {
    const names = new Set<string>();
    for (const group of rawGroups) {
      const override = categoryOverrides[group.id];
      if (!override?.is_hidden) continue;
      for (const name of categoryNameKeys(group, override)) names.add(name);
    }
    return names;
  }, [rawGroups, categoryOverrides]);

  const hiddenCategoryIds = useMemo(
    () =>
      new Set(
        rawGroups
          .filter((group) =>
            categoryNameKeys(group, categoryOverrides[group.id]).some((name) =>
              hiddenCategoryNameKeys.has(name),
            ),
          )
          .map((group) => group.id),
      ),
    [rawGroups, categoryOverrides, hiddenCategoryNameKeys],
  );

  const visibleGroups = useMemo(
    () =>
      rawGroups
        .filter((group) => !hiddenCategoryIds.has(group.id))
        .sort((left, right) =>
          compareMenuNames(
            resolvedCategoryName(left, categoryOverrides[left.id]),
            resolvedCategoryName(right, categoryOverrides[right.id]),
          ),
        ),
    [rawGroups, hiddenCategoryIds, categoryOverrides],
  );

  const sortedAdminGroups = useMemo(
    () =>
      [...rawGroups].sort((left, right) => {
        const hiddenComparison =
          Number(hiddenCategoryIds.has(left.id)) - Number(hiddenCategoryIds.has(right.id));
        if (hiddenComparison !== 0) return hiddenComparison;
        return compareMenuNames(
          resolvedCategoryName(left, categoryOverrides[left.id]),
          resolvedCategoryName(right, categoryOverrides[right.id]),
        );
      }),
    [rawGroups, hiddenCategoryIds, categoryOverrides],
  );

  useEffect(() => {
    if (
      selectedCategory !== 'all' &&
      !visibleGroups.some((group) => group.id === selectedCategory)
    ) {
      setSelectedCategory('all');
    }
  }, [selectedCategory, visibleGroups]);

  const productsInVisibleCategories = useMemo(
    () => rawProducts.filter((product) => !hiddenCategoryIds.has(product.parentGroup || '')),
    [rawProducts, hiddenCategoryIds],
  );

  const filteredProducts = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLocaleLowerCase('ru-RU');
    return productsInVisibleCategories
      .filter((product) => {
        const displayName = resolvedProductName(product, productOverrides[product.id]);
        const matchesSearch = displayName.toLocaleLowerCase('ru-RU').includes(normalizedSearch);
        const matchesCategory =
          selectedCategory === 'all' || product.parentGroup === selectedCategory;
        return matchesSearch && matchesCategory;
      })
      .sort((left, right) => {
        const hiddenComparison =
          Number(Boolean(productOverrides[left.id]?.is_hidden)) -
          Number(Boolean(productOverrides[right.id]?.is_hidden));
        if (hiddenComparison !== 0) return hiddenComparison;
        return compareMenuNames(
          resolvedProductName(left, productOverrides[left.id]),
          resolvedProductName(right, productOverrides[right.id]),
        );
      });
  }, [productsInVisibleCategories, productOverrides, searchQuery, selectedCategory]);

  const sortedCustomProducts = useMemo(
    () => [...customProducts].sort((left, right) => compareMenuNames(left.name, right.name)),
    [customProducts],
  );

  return {
    scopeLocations,
    selectedBranchId,
    onBranchChange,
    activeTab,
    setActiveTab,
    loading,
    error,
    rawProducts,
    rawGroups,
    productOverrides,
    categoryOverrides,
    customProducts,
    activeProfileKey,
    profileStatuses,
    searchQuery,
    setSearchQuery,
    selectedCategory,
    setSelectedCategory,
    uploadingId,
    syncingIiko,
    categoryEditModalOpen,
    setCategoryEditModalOpen,
    editingCategory,
    categoryEditForm,
    setCategoryEditForm,
    categoryEditSaving,
    editModalOpen,
    setEditModalOpen,
    editingProduct,
    editForm,
    setEditForm,
    editLang,
    setEditLang,
    editSaving,
    modalOpen,
    setModalOpen,
    customForm,
    setCustomForm,
    submitting,
    displayCount,
    setDisplayCount,
    optionsProduct,
    setOptionsProduct,
    optionsDraft,
    setOptionsDraft,
    optionsSaving,
    fetchMenu,
    handleMenuBranchChange,
    handleSyncIikoMenu,
    handleUploadPhoto,
    handleUploadCategoryPhoto,
    handleToggleProductHidden,
    handleToggleStopList,
    handleToggleCategoryHidden,
    openCategoryEditModal,
    handleSaveCategoryEdit,
    handleSaveCustom,
    openEditModal,
    handleSaveProductEdit,
    handleAutoTranslate,
    handleDeleteCustom,
    openOptionsModal,
    updateBuilderOption,
    addBuilderOption,
    removeBuilderOption,
    updateModifierGroup,
    updateModifierOption,
    setModifierDefault,
    addModifierGroup,
    saveOptions,
    hiddenCategoryIds,
    visibleGroups,
    sortedAdminGroups,
    productsInVisibleCategories,
    filteredProducts,
    sortedCustomProducts,
  };
}

export type MenuPageController = ReturnType<typeof useMenuPageController>;

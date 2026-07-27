import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  Eye,
  EyeOff,
  Image as ImageIcon,
  Languages,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  ShieldX,
  SlidersHorizontal,
  Trash2,
  Upload,
  UtensilsCrossed,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useSearchParams } from '../lib/router';

import {
  FulfillmentTypeFields,
  ProductFactsFields,
  builderOptionSections,
  categoryNameKeys,
  compareMenuNames,
  createBuilderOption,
  createModifierGroup,
  createModifierOption,
  defaultFulfillmentTypes,
  emptyProductOptions,
  emptyTranslations,
  fulfillmentSummary,
  menuLanguages,
  normalizeFulfillmentTypes,
  normalizeTranslations,
  optionLanguages,
  resolvedCategoryName,
  resolvedProductName,
  type BuilderOptionKey,
  type CategoryOverride,
  type CustomProduct,
  type FulfillmentType,
  type IikoGroup,
  type IikoProduct,
  type MenuLanguage,
  type ProductOverride,
  type ProductStorageCondition,
} from './menu/menu-page.shared';

export default function MenuPage() {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [params, setParams] = useSearchParams();

  const requestedTab = params.get('tab');
  const activeTab: 'products' | 'categories' | 'custom' =
    requestedTab === 'categories' || requestedTab === 'custom' ? requestedTab : 'products';
  const setActiveTab = (value: 'products' | 'categories' | 'custom') => {
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

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(window.location.search);
      if (searchQuery.trim()) next.set('search', searchQuery.trim());
      else next.delete('search');
      setParams(next, { replace: true });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [searchQuery, setParams]);

  // Названия категории на трёх языках
  const [categoryEditModalOpen, setCategoryEditModalOpen] = useState(false);
  const [editingCategory, setEditingCategory] = useState<IikoGroup | null>(null);
  const [categoryEditForm, setCategoryEditForm] =
    useState<Record<MenuLanguage, string>>(emptyTranslations);
  const [categoryEditSaving, setCategoryEditSaving] = useState(false);

  // Модалка редактирования товара iiko
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
    weight_grams: undefined as number | undefined,
    calories_kcal: undefined as number | undefined,
    protein_grams: undefined as number | undefined,
    fat_grams: undefined as number | undefined,
    carbs_grams: undefined as number | undefined,
    storage_conditions: [] as ProductStorageCondition[],
    fulfillment_types: [...defaultFulfillmentTypes] as FulfillmentType[],
  });
  const [editLang, setEditLang] = useState<'ru' | 'kk' | 'en'>('ru');
  const [editSaving, setEditSaving] = useState(false);

  // Модалка для кастомного блюда
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

  // Пагинация — показывать по 30 товаров
  const [displayCount, setDisplayCount] = useState(30);
  const [optionsProduct, setOptionsProduct] = useState<IikoProduct | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<any>(emptyProductOptions);
  const [optionsSaving, setOptionsSaving] = useState(false);

  const fetchMenu = useCallback(async () => {
    setLoading(true);
    setError('');
    setDisplayCount(30);
    try {
      const data = await api.getAdminMenu();
      const raw = data.rawMenu || {};
      // Извлекаем цену из sizePrices
      const prods = (raw.products || []).map((p: IikoProduct) => ({
        ...p,
        price: p.price || (p.sizePrices?.[0]?.price?.currentPrice ?? 0),
      }));
      setRawProducts(prods);
      setRawGroups(raw.groups || []);

      const pMap: Record<string, ProductOverride> = {};
      (data.overrides?.products || []).forEach((o: ProductOverride) => {
        pMap[o.iiko_product_id] = o;
      });
      setProductOverrides(pMap);

      const cMap: Record<string, CategoryOverride> = {};
      (data.overrides?.categories || []).forEach((o: CategoryOverride) => {
        cMap[o.iiko_category_id] = o;
      });
      setCategoryOverrides(cMap);

      setCustomProducts(data.overrides?.customProducts || []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void fetchMenu();
  }, [fetchMenu]);

  const handleSyncIikoMenu = async () => {
    if (iikoSyncInFlight.current) return;
    iikoSyncInFlight.current = true;
    setSyncingIiko(true);
    try {
      const result = await api.syncIikoMenu();
      await fetchMenu();
      toast(
        `Синхронизация завершена: ${result.productsCount} товаров, ${result.categoriesCount} категорий`,
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

  // Загрузка фото для блюда iiko
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

  // Загрузка фото для категории
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

  // Переключение видимости товара
  const handleToggleProductHidden = async (productId: string, curHidden?: boolean) => {
    const cur = productOverrides[productId] || { iiko_product_id: productId };
    const updated = { ...cur, is_hidden: !curHidden };
    try {
      await api.setProductOverride(productId, { is_hidden: updated.is_hidden });
      setProductOverrides((prev) => ({ ...prev, [productId]: updated }));
      toast(updated.is_hidden ? 'Блюдо скрыто из приложения' : 'Блюдо снова отображается', 'info');
    } catch (err) {
      toast('Ошибка сохранения настроек', 'error');
    }
  };

  // Переключение стоп-листа вручную
  const handleToggleStopList = async (productId: string, curStop?: boolean) => {
    const cur = productOverrides[productId] || { iiko_product_id: productId };
    const updated = { ...cur, is_stop_listed: !curStop };
    try {
      await api.setProductOverride(productId, { is_stop_listed: updated.is_stop_listed });
      setProductOverrides((prev) => ({ ...prev, [productId]: updated }));
      toast(updated.is_stop_listed ? 'Добавлено в стоп-лист' : 'Убрано из стоп-листа', 'info');
    } catch (err) {
      toast('Ошибка сохранения настроек', 'error');
    }
  };

  // Переключение видимости категории
  const handleToggleCategoryHidden = async (categoryId: string, curHidden?: boolean) => {
    const cur = categoryOverrides[categoryId] || { iiko_category_id: categoryId };
    const updated = { ...cur, is_hidden: !curHidden };
    try {
      await api.setCategoryOverride(categoryId, { is_hidden: updated.is_hidden });
      setCategoryOverrides((prev) => ({ ...prev, [categoryId]: updated }));
      if (updated.is_hidden && selectedCategory === categoryId) setSelectedCategory('all');
      toast(updated.is_hidden ? 'Категория скрыта' : 'Категория включена', 'info');
    } catch (err) {
      toast('Ошибка сохранения настроек', 'error');
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

  // Сохранение кастомного блюда
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

  // Открытие модалки редактирования товара iiko
  // Открытие модалки редактирования товара iiko
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

  // Сохранение изменений товара iiko
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
            ? editForm.description
            : undefined,
        description_translations: editForm.description_translations,
        custom_image_url: editForm.imageUrl || cur.custom_image_url || undefined,
        ingredients: editForm.ingredients || undefined,
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
      await api.setProductOverride(editingProduct.id, updated);
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

  // Удаление кастомного блюда
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

  return (
    <div className="page-stack">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={() => void handleSyncIikoMenu()}
          disabled={syncingIiko || loading}
          className="btn-outline inline-flex min-h-11 items-center justify-center gap-2 px-4"
        >
          <RefreshCw aria-hidden="true" className={syncingIiko ? 'spin' : ''} size={17} />
          {syncingIiko ? 'Синхронизация…' : 'Синхронизировать с iiko'}
        </button>
        {/* Табы */}
        <div className="flex bg-gray-100 p-1 rounded-xl" role="tablist" aria-label="Разделы меню">
          <button
            type="button"
            id="menu-tab-products"
            role="tab"
            aria-selected={activeTab === 'products'}
            aria-controls="menu-panel-products"
            onClick={() => setActiveTab('products')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'products'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Блюда iiko ({productsInVisibleCategories.length})
          </button>
          <button
            type="button"
            id="menu-tab-categories"
            role="tab"
            aria-selected={activeTab === 'categories'}
            aria-controls="menu-panel-categories"
            onClick={() => setActiveTab('categories')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'categories'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Категории ({rawGroups.length})
          </button>
          <button
            type="button"
            id="menu-tab-custom"
            role="tab"
            aria-selected={activeTab === 'custom'}
            aria-controls="menu-panel-custom"
            onClick={() => setActiveTab('custom')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'custom'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            Свои блюда ({customProducts.length})
          </button>
        </div>
      </div>

      {loading ? (
        <PageState type="loading" />
      ) : error ? (
        <PageState type="error" description={error} onRetry={fetchMenu} />
      ) : activeTab === 'products' ? (
        <div
          id="menu-panel-products"
          role="tabpanel"
          aria-labelledby="menu-tab-products"
          className="space-y-4"
        >
          {/* Фильтры */}
          <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <div className="relative flex-1">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                size={18}
              />
              <input
                type="text"
                placeholder="Поиск блюда по названию…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-gray-50 rounded-xl border border-gray-200 focus:outline-none focus:ring-2 focus:ring-amber-500 text-sm"
              />
            </div>
            <SelectControl
              compact
              ariaLabel="Категория"
              value={selectedCategory}
              onChange={setSelectedCategory}
              className="menu-filter-select"
              options={[
                {
                  value: 'all',
                  label: `Все категории (${productsInVisibleCategories.length})`,
                },
                ...visibleGroups.map((group) => ({ value: group.id, label: group.name })),
              ]}
            />
          </div>

          {/* Список товаров — показываем по порциям */}
          {filteredProducts.length === 0 ? (
            <PageState
              type="empty"
              title={
                searchQuery || selectedCategory !== 'all' ? 'Ничего не найдено' : 'Блюд пока нет'
              }
              description={
                searchQuery || selectedCategory !== 'all'
                  ? 'Измените запрос или выберите другую категорию.'
                  : 'После синхронизации с iiko блюда появятся здесь.'
              }
            />
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filteredProducts.slice(0, displayCount).map((p) => {
                const override = productOverrides[p.id];
                const isHidden = Boolean(override?.is_hidden);
                const isStop = Boolean(override?.is_stop_listed);
                const imgUrl = override?.custom_image_url || (p.imageLinks?.[0] ?? '');
                const displayName = override?.custom_name || p.name;
                const displayPrice =
                  override?.custom_price && override.custom_price > 0
                    ? override.custom_price
                    : (p.price ?? 0);
                const groupName = rawGroups.find((g) => g.id === p.parentGroup)?.name || '';

                return (
                  <div
                    key={p.id}
                    className={`bg-white rounded-2xl border transition group ${
                      isHidden
                        ? 'opacity-50 border-dashed border-gray-300'
                        : 'border-gray-100 shadow-sm hover:shadow-lg hover:border-amber-200'
                    }`}
                  >
                    {/* Фото */}
                    <div className="relative h-32 bg-gradient-to-br from-amber-50 to-orange-50 rounded-t-2xl overflow-hidden">
                      {imgUrl ? (
                        <img
                          src={imgUrl}
                          alt={displayName}
                          className="w-full h-full object-cover"
                          width="160"
                          height="120"
                          loading="lazy"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <ImageIcon className="text-amber-200" size={36} />
                        </div>
                      )}
                      {/* Цена — бейдж в углу */}
                      <div className="absolute bottom-2 right-2 px-2.5 py-1 bg-white/90 backdrop-blur rounded-lg shadow text-sm font-bold text-amber-700">
                        {displayPrice > 0 ? `${displayPrice.toLocaleString()} ₸` : '—'}
                      </div>
                      {/* Загрузить фото */}
                      <label
                        className="absolute top-2 right-2 inline-flex h-11 w-11 cursor-pointer items-center justify-center rounded-xl bg-white/90 text-gray-600 shadow-sm backdrop-blur transition-colors hover:bg-white focus-within:outline focus-within:outline-3 focus-within:outline-amber-300"
                        aria-label={`Загрузить фото для ${displayName}`}
                        title="Загрузить фото"
                      >
                        {uploadingId === p.id ? (
                          <LoaderCircle className="spin text-amber-600" size={17} />
                        ) : (
                          <Upload aria-hidden="true" size={17} />
                        )}
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleUploadPhoto(p.id, file);
                          }}
                        />
                      </label>
                      {/* Статус badges */}
                      {isHidden && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-gray-800/70 text-white text-[10px] font-medium rounded-md">
                          Скрыт
                        </span>
                      )}
                      {isStop && !isHidden && (
                        <span className="absolute top-2 left-2 px-2 py-0.5 bg-red-600/80 text-white text-[10px] font-medium rounded-md">
                          Стоп
                        </span>
                      )}
                    </div>

                    {/* Контент */}
                    <div className="p-3">
                      <h3
                        className="font-semibold text-gray-900 text-sm leading-tight"
                        title={displayName}
                      >
                        {displayName}
                      </h3>
                      {groupName && (
                        <p className="text-[11px] text-gray-400 mt-0.5 truncate">{groupName}</p>
                      )}
                      <p className="mt-1 text-[10px] font-medium text-gray-500">
                        {fulfillmentSummary(override?.fulfillment_types)}
                      </p>

                      {/* Кнопки действий */}
                      <div className="mt-3 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => openEditModal(p)}
                          className="btn-outline compact-button flex-1 gap-1 text-[12px] text-amber-700"
                        >
                          <Pencil aria-hidden="true" size={14} />
                          Изменить
                        </button>
                        <button
                          type="button"
                          onClick={() => void openOptionsModal(p)}
                          className="icon-button bg-amber-50 text-amber-700"
                          aria-label={`Конструктор и опции ${displayName}`}
                          title="Конструктор и опции"
                        >
                          <SlidersHorizontal aria-hidden="true" size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleToggleProductHidden(p.id, isHidden)}
                          className={`icon-button ${isHidden ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-600'}`}
                          aria-label={isHidden ? 'Показать блюдо' : 'Скрыть блюдо'}
                          title={isHidden ? 'Показать' : 'Скрыть'}
                        >
                          {isHidden ? (
                            <EyeOff aria-hidden="true" size={17} />
                          ) : (
                            <Eye aria-hidden="true" size={17} />
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleToggleStopList(p.id, isStop)}
                          className={`icon-button ${isStop ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}
                          aria-label={isStop ? 'Убрать из стоп-листа' : 'Добавить в стоп-лист'}
                          title={isStop ? 'Убрать из стоп-листа' : 'В стоп-лист'}
                        >
                          <ShieldX aria-hidden="true" size={17} />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Кнопка «Показать ещё» */}
          {filteredProducts.length > displayCount && (
            <div className="text-center pt-2">
              <button
                type="button"
                onClick={() => setDisplayCount((prev) => prev + 30)}
                className="btn-classic px-6"
              >
                Показать ещё ({filteredProducts.length - displayCount} товаров)
              </button>
            </div>
          )}
        </div>
      ) : activeTab === 'categories' ? (
        <div
          id="menu-panel-categories"
          role="tabpanel"
          aria-labelledby="menu-tab-categories"
          className="grid grid-cols-1 md:grid-cols-2 gap-4"
        >
          {sortedAdminGroups.map((g) => {
            const override = categoryOverrides[g.id];
            const categoryDisplayName = resolvedCategoryName(g, override);
            const isDirectlyHidden = Boolean(override?.is_hidden);
            const isHidden = hiddenCategoryIds.has(g.id);
            const isHiddenByDuplicate = isHidden && !isDirectlyHidden;
            const count = rawProducts.filter((p) => p.parentGroup === g.id).length;

            return (
              <div
                key={g.id}
                className={`bg-white rounded-2xl p-4 border flex items-center justify-between gap-4 ${
                  isHidden
                    ? 'opacity-60 border-dashed border-gray-300'
                    : 'border-gray-100 shadow-sm'
                }`}
              >
                <div className="flex items-center gap-4 flex-1">
                  <div className="relative w-16 h-16 rounded-xl overflow-hidden bg-gray-100 shrink-0">
                    {override?.custom_image_url ? (
                      <img
                        src={override.custom_image_url}
                        alt={categoryDisplayName}
                        className="w-full h-full object-cover"
                        width="160"
                        height="120"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="text-gray-400" size={24} />
                      </div>
                    )}
                    <label
                      className="absolute inset-0 flex cursor-pointer items-center justify-center bg-black/45 text-white transition-opacity focus-within:outline focus-within:outline-3 focus-within:outline-amber-300"
                      aria-label={`Загрузить фото для категории ${categoryDisplayName}`}
                      title="Загрузить фото категории"
                    >
                      {uploadingId === g.id ? (
                        <LoaderCircle className="spin" size={20} />
                      ) : (
                        <Upload aria-hidden="true" size={20} />
                      )}
                      <input
                        type="file"
                        accept="image/*"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) void handleUploadCategoryPhoto(g.id, file);
                        }}
                      />
                    </label>
                  </div>

                  <div>
                    <h3 className="font-semibold text-gray-900 text-base">{categoryDisplayName}</h3>
                    <p className="text-xs text-gray-500 mt-0.5">Товаров в категории: {count}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => openCategoryEditModal(g)}
                    className="icon-button bg-amber-50 text-amber-700"
                    aria-label={`Изменить названия категории ${categoryDisplayName}`}
                    title="Изменить названия RU / KZ / EN"
                  >
                    <Pencil aria-hidden="true" size={17} />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleToggleCategoryHidden(g.id, isDirectlyHidden)}
                    disabled={isHiddenByDuplicate}
                    title={
                      isHiddenByDuplicate
                        ? 'Категория скрыта вместе с одноимённой категорией'
                        : undefined
                    }
                    className={`btn-outline compact-button inline-flex items-center gap-2 shrink-0 ${
                      isHidden ? 'text-gray-500' : 'text-green-700'
                    }`}
                  >
                    {isHidden ? (
                      <EyeOff aria-hidden="true" size={16} />
                    ) : (
                      <Eye aria-hidden="true" size={16} />
                    )}
                    <span>
                      {isHiddenByDuplicate
                        ? 'Скрыта как дубликат'
                        : isHidden
                          ? 'Категория скрыта'
                          : 'Включена'}
                    </span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Вкладка: Свои блюда (кастомные) */
        <div
          id="menu-panel-custom"
          role="tabpanel"
          aria-labelledby="menu-tab-custom"
          className="space-y-4"
        >
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => {
                setCustomForm({
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
                setModalOpen(true);
              }}
              className="btn-classic px-5 inline-flex items-center gap-2"
            >
              <Plus size={18} />
              <span>Добавить своё блюдо</span>
            </button>
          </div>

          {customProducts.length === 0 ? (
            <div className="bg-white rounded-2xl p-12 text-center border border-gray-100">
              <UtensilsCrossed className="mx-auto text-gray-300 mb-3" size={40} />
              <p className="text-gray-500 text-sm">Вы ещё не добавили свои блюда вручную</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedCustomProducts.map((cp) => (
                <div
                  key={cp.id}
                  className="bg-white rounded-2xl p-4 border border-gray-100 shadow-sm flex flex-col justify-between"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="w-16 h-16 rounded-xl bg-gray-100 overflow-hidden flex items-center justify-center shrink-0">
                          {cp.image_url ? (
                            <img
                              src={cp.image_url}
                              alt={cp.name}
                              className="w-full h-full object-cover"
                              width="160"
                              height="120"
                              loading="lazy"
                            />
                          ) : (
                            <ImageIcon className="text-gray-400" size={24} />
                          )}
                        </div>
                        <div>
                          <h3 className="font-semibold text-gray-900 text-sm">{cp.name}</h3>
                          <p className="text-xs text-amber-600 font-medium mt-0.5">{cp.price} ₸</p>
                          <span className="inline-block mt-1 text-[10px] bg-gray-100 px-2 py-0.5 rounded-md text-gray-600">
                            {cp.category_name}
                          </span>
                          <p className="mt-1 text-[10px] font-medium text-gray-500">
                            {fulfillmentSummary(cp.fulfillment_types)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setCustomForm({
                              ...cp,
                              allergens: cp.allergens || [],
                              dietary_tags: cp.dietary_tags || [],
                              search_keywords: cp.search_keywords || [],
                              storage_conditions: cp.storage_conditions || [],
                              fulfillment_types: normalizeFulfillmentTypes(cp.fulfillment_types),
                            });
                            setModalOpen(true);
                          }}
                          className="icon-button"
                          aria-label={`Редактировать ${cp.name}`}
                          title="Редактировать"
                        >
                          <Pencil aria-hidden="true" size={17} />
                        </button>
                        <button
                          type="button"
                          onClick={() => cp.id && handleDeleteCustom(cp.id)}
                          className="icon-button icon-button-danger"
                          aria-label={`Удалить ${cp.name}`}
                          title="Удалить"
                        >
                          <Trash2 aria-hidden="true" size={17} />
                        </button>
                      </div>
                    </div>
                    {cp.description && (
                      <p className="text-xs text-gray-500 mt-3">{cp.description}</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

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
          <p className="page-help">
            Если KZ или EN не заполнены, приложение использует русское название.
          </p>
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
              {categoryEditSaving && <LoaderCircle className="spin" size={17} />}
              {categoryEditSaving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>

      {/* Модальное окно РЕДАКТИРОВАНИЯ товара iiko */}
      <Modal
        open={editModalOpen}
        onClose={() => setEditModalOpen(false)}
        title={`Редактировать: ${editingProduct?.name || ''}`}
      >
        <form onSubmit={handleSaveProductEdit} className="modal-body form-stack">
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <h4 className="text-sm font-semibold text-gray-800">Тексты</h4>
              <div className="flex bg-gray-200 p-1 rounded-lg text-xs font-medium">
                {(['ru', 'kk', 'en'] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setEditLang(l)}
                    className={`px-3 py-1.5 rounded-md transition-colors ${editLang === l ? 'bg-white shadow text-amber-600' : 'text-gray-600 hover:text-gray-900'}`}
                  >
                    {l.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div className="p-4 space-y-4">
              {editLang !== 'ru' && (
                <button
                  type="button"
                  onClick={() => handleAutoTranslate(editLang as 'kk' | 'en')}
                  className="w-full flex justify-center items-center gap-2 px-3 py-2 bg-blue-50 hover:bg-blue-100 text-blue-600 text-sm font-medium rounded-lg transition-colors border border-blue-100"
                >
                  <Languages aria-hidden="true" size={16} />
                  Автоперевод с Русского (Google)
                </button>
              )}

              <div className="field-group">
                <label className="field-label" htmlFor={`edit-name-${editLang}`}>
                  Название ({editLang.toUpperCase()})
                </label>
                <input
                  id={`edit-name-${editLang}`}
                  type="text"
                  value={
                    editLang === 'ru' ? editForm.name : editForm.name_translations[editLang] || ''
                  }
                  onChange={(e) => {
                    if (editLang === 'ru') {
                      setEditForm({ ...editForm, name: e.target.value });
                    } else {
                      setEditForm({
                        ...editForm,
                        name_translations: {
                          ...editForm.name_translations,
                          [editLang]: e.target.value,
                        },
                      });
                    }
                  }}
                  className="input-classic"
                  placeholder={editLang === 'ru' ? 'Название товара' : 'Перевод названия'}
                />
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor={`edit-description-${editLang}`}>
                  Описание ({editLang.toUpperCase()})
                </label>
                <textarea
                  id={`edit-description-${editLang}`}
                  rows={3}
                  value={
                    editLang === 'ru'
                      ? editForm.description
                      : editForm.description_translations[editLang] || ''
                  }
                  onChange={(e) => {
                    if (editLang === 'ru') {
                      setEditForm({ ...editForm, description: e.target.value });
                    } else {
                      setEditForm({
                        ...editForm,
                        description_translations: {
                          ...editForm.description_translations,
                          [editLang]: e.target.value,
                        },
                      });
                    }
                  }}
                  className="input-classic"
                  placeholder={editLang === 'ru' ? 'Описание (необязательно)' : 'Перевод описания'}
                />
              </div>

              <div className="field-group">
                <label className="field-label" htmlFor={`edit-ingredients-${editLang}`}>
                  Состав ({editLang.toUpperCase()})
                </label>
                <textarea
                  id={`edit-ingredients-${editLang}`}
                  rows={3}
                  value={
                    editLang === 'ru'
                      ? editForm.ingredients
                      : editForm.ingredients_translations[editLang] || ''
                  }
                  onChange={(event) => {
                    if (editLang === 'ru') {
                      setEditForm({ ...editForm, ingredients: event.target.value });
                    } else {
                      setEditForm({
                        ...editForm,
                        ingredients_translations: {
                          ...editForm.ingredients_translations,
                          [editLang]: event.target.value,
                        },
                      });
                    }
                  }}
                  className="input-classic"
                  placeholder="Мука, масло, яйца..."
                />
              </div>
            </div>
          </div>

          <ProductFactsFields
            idPrefix="edit-product"
            value={editForm}
            onChange={(key, value) => setEditForm((current) => ({ ...current, [key]: value }))}
          />

          <FulfillmentTypeFields
            idPrefix="edit-fulfillment"
            value={editForm.fulfillment_types}
            onChange={(fulfillment_types) =>
              setEditForm((current) => ({ ...current, fulfillment_types }))
            }
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="field-group">
              <label className="field-label" htmlFor="edit-price">
                Цена (₸)
              </label>
              <input
                id="edit-price"
                type="number"
                value={editForm.price || ''}
                onChange={(e) => setEditForm({ ...editForm, price: Number(e.target.value) })}
                className="input-classic"
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="edit-image-url">
                Фото (URL)
              </label>
              <input
                id="edit-image-url"
                type="url"
                value={editForm.imageUrl}
                onChange={(e) => setEditForm({ ...editForm, imageUrl: e.target.value })}
                className="input-classic"
                placeholder="https://example.com/image.webp"
              />
            </div>
          </div>

          <div className="modal-actions">
            <button
              type="button"
              onClick={() => setEditModalOpen(false)}
              className="btn-outline px-5"
              disabled={editSaving}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={editSaving}
              className="btn-classic px-5 inline-flex items-center gap-2"
            >
              {editSaving && <LoaderCircle className="spin" size={17} />}
              {editSaving ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>

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
              {optionsSaving && <LoaderCircle className="spin" size={17} />}
              {optionsSaving ? 'Сохранение…' : 'Сохранить настройки'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Модальное окно добавления кастомного блюда */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={customForm.id ? `Редактировать: ${customForm.name}` : 'Добавить своё блюдо'}
        size="xl"
      >
        <form onSubmit={handleSaveCustom} className="modal-body form-stack">
          <div className="field-group">
            <label className="field-label" htmlFor="custom-name">
              Название блюда *
            </label>
            <input
              id="custom-name"
              type="text"
              required
              value={customForm.name}
              onChange={(e) => setCustomForm({ ...customForm, name: e.target.value })}
              className="input-classic"
              placeholder="Например: Спец-комбо Bulka"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="field-group">
              <label className="field-label" htmlFor="custom-price">
                Цена (₸) *
              </label>
              <input
                id="custom-price"
                type="number"
                required
                value={customForm.price || ''}
                onChange={(e) => setCustomForm({ ...customForm, price: Number(e.target.value) })}
                className="input-classic"
              />
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor="custom-category">
                Категория
              </label>
              <input
                id="custom-category"
                type="text"
                value={customForm.category_name}
                onChange={(e) => setCustomForm({ ...customForm, category_name: e.target.value })}
                className="input-classic"
              />
            </div>
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="custom-image-url">
              Ссылка на фото (URL)
            </label>
            <input
              id="custom-image-url"
              type="url"
              value={customForm.image_url}
              onChange={(e) => setCustomForm({ ...customForm, image_url: e.target.value })}
              className="input-classic"
              placeholder="https://example.com/image.webp"
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="custom-description">
              Описание
            </label>
            <textarea
              id="custom-description"
              rows={3}
              value={customForm.description}
              onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })}
              className="input-classic"
            />
          </div>

          <div className="field-group">
            <label className="field-label" htmlFor="custom-ingredients">
              Состав
            </label>
            <textarea
              id="custom-ingredients"
              rows={3}
              value={customForm.ingredients || ''}
              onChange={(event) =>
                setCustomForm({ ...customForm, ingredients: event.target.value })
              }
              className="input-classic"
              placeholder="Мука, масло, яйца..."
            />
          </div>

          <ProductFactsFields
            idPrefix="custom-product"
            value={customForm}
            onChange={(key, value) => setCustomForm((current) => ({ ...current, [key]: value }))}
          />

          <FulfillmentTypeFields
            idPrefix="custom-fulfillment"
            value={customForm.fulfillment_types}
            onChange={(fulfillment_types) =>
              setCustomForm((current) => ({ ...current, fulfillment_types }))
            }
          />

          <div className="modal-actions">
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="btn-outline px-5"
              disabled={submitting}
            >
              Отмена
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn-classic px-5 inline-flex items-center gap-2"
            >
              {submitting && <LoaderCircle className="spin" size={17} />}
              {submitting ? 'Сохранение…' : 'Сохранить'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

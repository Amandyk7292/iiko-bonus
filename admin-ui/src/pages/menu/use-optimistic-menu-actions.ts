import { useRef, type Dispatch, type SetStateAction } from 'react';
import { api } from '../../lib/api';
import type { CategoryOverride, ProductOverride } from './menu-page.shared';

type MenuActionTone = 'success' | 'error' | 'info';
type OverrideSetter<T> = Dispatch<SetStateAction<Record<string, T>>>;

type Options = {
  setProductOverrides: OverrideSetter<ProductOverride>;
  setCategoryOverrides: OverrideSetter<CategoryOverride>;
  selectedCategory: string;
  setSelectedCategory: (value: string) => void;
  toast: (message: string, tone?: MenuActionTone) => void;
};

export function useOptimisticMenuActions({
  setProductOverrides,
  setCategoryOverrides,
  selectedCategory,
  setSelectedCategory,
  toast,
}: Options) {
  const pendingRef = useRef<Set<string>>(new Set());

  const start = (key: string) => {
    if (pendingRef.current.has(key)) return false;
    pendingRef.current.add(key);
    return true;
  };

  const patchProduct = (
    productId: string,
    field: 'is_hidden' | 'is_stop_listed',
    pendingField: '_visibility_pending' | '_stop_list_pending',
    value: boolean,
    pending: boolean,
  ) =>
    setProductOverrides((current) => ({
      ...current,
      [productId]: {
        ...(current[productId] || { iiko_product_id: productId }),
        [field]: value,
        [pendingField]: pending,
      },
    }));

  const patchCategory = (categoryId: string, value: boolean, pending: boolean) =>
    setCategoryOverrides((current) => ({
      ...current,
      [categoryId]: {
        ...(current[categoryId] || { iiko_category_id: categoryId }),
        is_hidden: value,
        _visibility_pending: pending,
      },
    }));

  const run = async (
    key: string,
    apply: (success: boolean, pending: boolean) => void,
    save: () => Promise<unknown>,
  ) => {
    if (!start(key)) return;
    apply(true, true);
    try {
      await save();
      apply(true, false);
    } catch {
      apply(false, false);
      toast('Ошибка сохранения настроек', 'error');
    } finally {
      pendingRef.current.delete(key);
    }
  };

  const handleToggleProductHidden = async (productId: string, curHidden?: boolean) => {
    const previous = Boolean(curHidden);
    const next = !previous;
    await run(
      `visibility:${productId}`,
      (success, pending) =>
        patchProduct(
          productId,
          'is_hidden',
          '_visibility_pending',
          success ? next : previous,
          pending,
        ),
      () => api.setProductOverride(productId, { is_hidden: next }),
    );
  };

  const handleToggleStopList = async (productId: string, curStop?: boolean) => {
    const previous = Boolean(curStop);
    const next = !previous;
    await run(
      `stop:${productId}`,
      (success, pending) =>
        patchProduct(
          productId,
          'is_stop_listed',
          '_stop_list_pending',
          success ? next : previous,
          pending,
        ),
      () => api.setProductOverride(productId, { is_stop_listed: next }),
    );
  };

  const handleToggleCategoryHidden = async (categoryId: string, curHidden?: boolean) => {
    const previous = Boolean(curHidden);
    const next = !previous;
    const key = `category:${categoryId}`;
    if (!start(key)) return;

    patchCategory(categoryId, next, true);
    if (next && selectedCategory === categoryId) setSelectedCategory('all');
    try {
      await api.setCategoryOverride(categoryId, { is_hidden: next });
      patchCategory(categoryId, next, false);
    } catch {
      patchCategory(categoryId, previous, false);
      toast('Ошибка сохранения настроек', 'error');
    } finally {
      pendingRef.current.delete(key);
    }
  };

  return {
    handleToggleProductHidden,
    handleToggleStopList,
    handleToggleCategoryHidden,
  };
}

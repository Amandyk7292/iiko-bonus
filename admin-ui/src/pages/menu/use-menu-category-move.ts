import { useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { moveMenuProducts } from './menu-category-api';
import { useFeedback } from '../../components/Feedback';
import type { ProductOverride } from './menu-page.shared';

export function useMenuCategoryMove(
  scope: string,
  profileKey: string | undefined,
  setOverrides: Dispatch<SetStateAction<Record<string, ProductOverride>>>,
) {
  const { toast } = useFeedback();
  const currentScope = useRef(scope);
  currentScope.current = scope;
  const [selection, setSelection] = useState({ scope, ids: [] as string[] });
  const [target, setTarget] = useState({ scope, id: '' });
  if (selection.scope !== scope) setSelection({ scope, ids: [] });
  if (target.scope !== scope) setTarget({ scope, id: '' });
  const [moving, setMoving] = useState(false);
  const inFlight = useRef(false);
  const selectedIds = selection.scope === scope ? selection.ids : [];
  const targetCategory = target.scope === scope ? target.id : '';
  const selectProducts = (ids: string[]) => setSelection({ scope, ids });
  const toggleProduct = (id: string) =>
    selectProducts(
      selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id],
    );
  const moveProducts = async (categoryId: string | null) => {
    if (inFlight.current || !profileKey || !selectedIds.length) return;
    if (selectedIds.length > 500) {
      toast('Выберите не более 500 товаров за один перенос', 'error');
      return;
    }
    inFlight.current = true;
    setMoving(true);
    try {
      const result = await moveMenuProducts(selectedIds, categoryId, profileKey);
      if (currentScope.current !== scope) return;
      setOverrides((previous) => {
        const next = { ...previous };
        for (const id of result.productIds)
          next[id] = {
            ...next[id],
            iiko_product_id: id,
            custom_category_id: categoryId,
          };
        return next;
      });
      selectProducts([]);
      toast(
        categoryId
          ? `Перемещено товаров: ${result.productIds.length}`
          : 'Исходные категории восстановлены',
        'success',
      );
    } catch (error) {
      if (currentScope.current === scope)
        toast(error instanceof Error ? error.message : 'Не удалось переместить товары', 'error');
    } finally {
      inFlight.current = false;
      setMoving(false);
    }
  };
  return {
    selectedIds,
    selectProducts,
    toggleProduct,
    targetCategory,
    setTargetCategory: (id: string) => setTarget({ scope, id }),
    moving,
    moveProducts,
  };
}

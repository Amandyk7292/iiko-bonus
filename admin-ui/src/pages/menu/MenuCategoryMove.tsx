import SelectControl from '../../components/SelectControl';
import type { MenuPageController } from './use-menu-page-controller';
import { resolvedCategoryName } from './menu-page.shared';

export default function MenuCategoryMove({ controller }: { controller: MenuPageController }) {
  const {
    categoryMove: move,
    filteredProducts,
    visibleGroups,
    rawGroups,
    categoryOverrides,
  } = controller;
  const targets = visibleGroups.filter(
    (group) => !rawGroups.some((g) => g.isIncludedInMenu) || group.isIncludedInMenu,
  );
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-gray-200 bg-white p-4 text-sm">
      <button
        type="button"
        className="btn-outline"
        disabled={move.moving || !filteredProducts.length}
        onClick={() =>
          move.selectProducts([
            ...new Set([...move.selectedIds, ...filteredProducts.map((p) => p.id)]),
          ])
        }
      >
        Выбрать все по фильтру
      </button>
      <span role="status">Выбрано: {move.selectedIds.length}</span>
      {move.selectedIds.length > 0 && (
        <>
          <SelectControl
            ariaLabel="Переместить в категорию"
            disabled={move.moving}
            value={move.targetCategory}
            onChange={move.setTargetCategory}
            options={[
              { value: '', label: 'Куда переместить' },
              ...targets.map((g) => ({
                value: g.id,
                label: resolvedCategoryName(g, categoryOverrides[g.id]),
              })),
            ]}
          />
          <button
            type="button"
            className="btn-classic btn-primary"
            disabled={move.moving || !move.targetCategory}
            onClick={() => void move.moveProducts(move.targetCategory)}
          >
            {move.moving ? 'Сохранение…' : 'Переместить'}
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={move.moving}
            onClick={() => void move.moveProducts(null)}
          >
            Вернуть категории iiko
          </button>
          <button
            type="button"
            className="btn-outline"
            disabled={move.moving}
            onClick={() => move.selectProducts([])}
          >
            Снять выбор
          </button>
        </>
      )}
      <p className="w-full text-gray-500">
        Выберите товары из одной или нескольких категорий и перенесите в общую. Перенос сохраняется
        при синхронизации с iiko.
      </p>
    </div>
  );
}

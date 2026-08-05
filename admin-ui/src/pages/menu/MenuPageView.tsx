import {
  Eye,
  EyeOff,
  Image as ImageIcon,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  ShieldX,
  SlidersHorizontal,
  Trash2,
  Upload,
  UtensilsCrossed,
} from 'lucide-react';
import PageState from '../../components/PageState';
import SelectControl from '../../components/SelectControl';
import MenuCityScope from './MenuCityScope';
import MenuWorkspaceToolbar from './MenuWorkspaceToolbar';
import {
  defaultFulfillmentTypes,
  fulfillmentSummary,
  normalizeFulfillmentTypes,
  resolvedCategoryName,
} from './menu-page.shared';
import type { MenuPageController } from './use-menu-page-controller';
import MenuEditorModals from './MenuEditorModals';

export default function MenuPageView({ controller }: { controller: MenuPageController }) {
  const {
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
    setModalOpen,
    setCustomForm,
    displayCount,
    setDisplayCount,
    fetchMenu,
    handleMenuBranchChange,
    handleSyncIikoMenu,
    handleUploadPhoto,
    handleUploadCategoryPhoto,
    handleToggleProductHidden,
    handleToggleStopList,
    handleToggleCategoryHidden,
    openCategoryEditModal,
    openEditModal,
    handleDeleteCustom,
    openOptionsModal,
    hiddenCategoryIds,
    visibleGroups,
    sortedAdminGroups,
    productsInVisibleCategories,
    filteredProducts,
    sortedCustomProducts,
  } = controller;

  return (
    <div className="page-stack">
      <MenuCityScope
        locations={scopeLocations}
        selectedBranchId={selectedBranchId}
        onBranchChange={handleMenuBranchChange}
        activeProfileKey={activeProfileKey}
        profiles={profileStatuses}
        loading={loading}
        hasError={Boolean(error)}
        productsCount={productsInVisibleCategories.length}
        categoriesCount={rawGroups.length}
      />

      {selectedBranchId && (
        <MenuWorkspaceToolbar
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onSync={() => void handleSyncIikoMenu()}
          syncing={syncingIiko}
          loading={loading}
          productsCount={productsInVisibleCategories.length}
          categoriesCount={rawGroups.length}
          customProductsCount={customProducts.length}
        />
      )}

      {!selectedBranchId ? (
        <PageState
          type="empty"
          title="Выберите город"
          description="После выбора откроется именно его ассортимент и цены. Так изменения не попадут в меню другого города."
        />
      ) : loading ? (
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
          <div className="flex flex-col sm:flex-row gap-4 bg-white p-4 rounded-2xl border border-gray-100 shadow-sm">
            <div className="relative flex-1">
              <label className="sr-only" htmlFor="menu-product-search">
                Поиск блюда по названию
              </label>
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                size={18}
                aria-hidden="true"
              />
              <input
                id="menu-product-search"
                name="menuProductSearch"
                type="search"
                placeholder="Поиск блюда по названию…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                autoComplete="off"
                spellCheck="false"
                className="w-full pl-10 pr-4 py-2 bg-gray-50 rounded-xl border border-gray-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 text-sm"
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
                const visibilityPending = Boolean(override?._visibility_pending);
                const stopListPending = Boolean(override?._stop_list_pending);
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
                          disabled={visibilityPending}
                          aria-busy={visibilityPending}
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
                          disabled={stopListPending}
                          aria-busy={stopListPending}
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
            const visibilityPending = Boolean(override?._visibility_pending);
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
                    disabled={isHiddenByDuplicate || visibilityPending}
                    aria-busy={visibilityPending}
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
                              id: cp.id,
                              name: cp.name,
                              description: cp.description || '',
                              price: Number(cp.price || 0),
                              category_name: cp.category_name,
                              image_url: cp.image_url || '',
                              is_available: cp.is_available !== false,
                              sort_order: cp.sort_order,
                              preparation_minutes: cp.preparation_minutes,
                              ingredients: cp.ingredients || '',
                              ingredients_translations: cp.ingredients_translations,
                              allergens: cp.allergens || [],
                              dietary_tags: cp.dietary_tags || [],
                              search_keywords: cp.search_keywords || [],
                              weight_grams: cp.weight_grams,
                              calories_kcal: cp.calories_kcal,
                              protein_grams: cp.protein_grams,
                              fat_grams: cp.fat_grams,
                              carbs_grams: cp.carbs_grams,
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

      <MenuEditorModals controller={controller} />
    </div>
  );
}

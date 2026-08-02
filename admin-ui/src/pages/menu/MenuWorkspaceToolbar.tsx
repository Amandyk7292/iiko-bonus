import { RefreshCw } from 'lucide-react';

export type MenuWorkspaceTab = 'products' | 'categories' | 'custom';

export default function MenuWorkspaceToolbar({
  activeTab,
  onTabChange,
  onSync,
  syncing,
  loading,
  productsCount,
  categoriesCount,
  customProductsCount,
}: {
  activeTab: MenuWorkspaceTab;
  onTabChange: (tab: MenuWorkspaceTab) => void;
  onSync: () => void;
  syncing: boolean;
  loading: boolean;
  productsCount: number;
  categoriesCount: number;
  customProductsCount: number;
}) {
  const tabs: Array<{ value: MenuWorkspaceTab; label: string; count: number }> = [
    { value: 'products', label: 'Блюда iiko', count: productsCount },
    { value: 'categories', label: 'Категории', count: categoriesCount },
    { value: 'custom', label: 'Свои блюда', count: customProductsCount },
  ];

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <button
        type="button"
        onClick={onSync}
        disabled={syncing || loading}
        className="btn-outline inline-flex min-h-11 items-center justify-center gap-2 px-4"
      >
        <RefreshCw aria-hidden="true" className={syncing ? 'spin' : ''} size={17} />
        {syncing ? 'Синхронизация…' : 'Синхронизировать выбранный город'}
      </button>
      <div
        className="grid grid-cols-1 gap-1 rounded-xl bg-gray-100 p-1 sm:flex"
        role="tablist"
        aria-label="Разделы меню"
      >
        {tabs.map((tab) => (
          <button
            type="button"
            key={tab.value}
            id={`menu-tab-${tab.value}`}
            role="tab"
            aria-selected={activeTab === tab.value}
            aria-controls={`menu-panel-${tab.value}`}
            onClick={() => onTabChange(tab.value)}
            className={`min-h-11 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.value
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label} ({tab.count})
          </button>
        ))}
      </div>
    </div>
  );
}

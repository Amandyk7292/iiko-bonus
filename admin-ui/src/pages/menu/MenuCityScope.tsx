import { Building2, CheckCircle2, CircleAlert, MapPin } from 'lucide-react';
import type { AdminScopeLocation } from '../../lib/api';

export interface MenuProfileStatus {
  key: string;
  configured: boolean;
  city?: string;
}

export interface MenuCityGroup {
  key: string;
  name: string;
  branches: AdminScopeLocation[];
}

const normalizeCity = (value: string) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

export const groupMenuLocationsByCity = (locations: AdminScopeLocation[]): MenuCityGroup[] => {
  const groups = new Map<string, MenuCityGroup>();
  for (const location of locations) {
    if (location.active === false) continue;
    const name = String(location.city || '').trim() || 'Без города';
    const key = normalizeCity(name);
    const current = groups.get(key);
    if (current) current.branches.push(location);
    else groups.set(key, { key, name, branches: [location] });
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      branches: [...group.branches].sort((left, right) =>
        left.name.localeCompare(right.name, 'ru'),
      ),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
};

export const branchCountLabel = (count: number) => {
  const lastTwo = count % 100;
  const last = count % 10;
  if (last === 1 && lastTwo !== 11) return `${count} филиал`;
  if (last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14)) return `${count} филиала`;
  return `${count} филиалов`;
};

const storedBranchKey = (cityKey: string) => `adminMenuBranch:${cityKey}`;

const preferredBranch = (group: MenuCityGroup) => {
  const remembered =
    typeof window === 'undefined' ? '' : window.localStorage.getItem(storedBranchKey(group.key));
  return group.branches.find((branch) => branch.id === remembered) || group.branches[0];
};

const profileForCity = (
  cityName: string,
  profiles: Record<string, MenuProfileStatus>,
): MenuProfileStatus | undefined => {
  const normalized = normalizeCity(cityName);
  return (
    Object.values(profiles).find(
      (profile) => profile.city && normalizeCity(profile.city) === normalized,
    ) || profiles.default
  );
};

export default function MenuCityScope({
  locations,
  selectedBranchId,
  onBranchChange,
  activeProfileKey,
  profiles,
  loading,
  hasError,
  productsCount,
  categoriesCount,
}: {
  locations: AdminScopeLocation[];
  selectedBranchId: string;
  onBranchChange: (branchId: string) => void | Promise<void>;
  activeProfileKey?: string;
  profiles: Record<string, MenuProfileStatus>;
  loading: boolean;
  hasError: boolean;
  productsCount: number;
  categoriesCount: number;
}) {
  const cities = groupMenuLocationsByCity(locations);
  const selectedBranch = locations.find((branch) => branch.id === selectedBranchId);
  const selectedCity = cities.find(
    (city) => selectedBranch && city.key === normalizeCity(selectedBranch.city),
  );
  const activeProfile = activeProfileKey ? profiles[activeProfileKey] : undefined;

  const chooseCity = (city: MenuCityGroup) => {
    const branch = preferredBranch(city);
    if (!branch) return;
    window.localStorage.setItem(storedBranchKey(city.key), branch.id);
    void onBranchChange(branch.id);
  };

  return (
    <section
      className="rounded-3xl border border-amber-200 bg-white p-4 shadow-sm sm:p-5"
      aria-labelledby="menu-city-scope-title"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mb-1 text-xs font-bold uppercase tracking-[0.14em] text-amber-700">
            Область редактирования
          </p>
          <h2 id="menu-city-scope-title" className="text-xl font-bold text-stone-900">
            Меню по городам
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-stone-600">
            Выберите город: меню, цены и ручные блюда изолированы от других городов.
          </p>
        </div>
        {selectedCity && (
          <div
            className={`inline-flex min-h-10 items-center gap-2 self-start rounded-full px-3 py-2 text-sm font-semibold ${
              hasError || activeProfile?.configured === false
                ? 'bg-red-50 text-red-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}
            role="status"
          >
            {hasError || activeProfile?.configured === false ? (
              <CircleAlert aria-hidden="true" size={18} />
            ) : (
              <CheckCircle2 aria-hidden="true" size={18} />
            )}
            {loading
              ? 'Проверяем iiko…'
              : hasError
                ? 'Не удалось загрузить меню'
                : activeProfile?.configured === false
                  ? 'Используется основной профиль iiko'
                  : 'Профиль iiko подключён'}
          </div>
        )}
      </div>

      {cities.length === 0 ? (
        <div className="mt-4 rounded-2xl border border-dashed border-stone-300 p-4 text-sm text-stone-600">
          Нет доступных филиалов. Добавьте активную точку в разделе «Локации».
        </div>
      ) : (
        <div
          className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
          role="group"
          aria-label="Выбор города для редактирования меню"
        >
          {cities.map((city) => {
            const isSelected = city.key === selectedCity?.key;
            const cityProfile = profileForCity(city.name, profiles);
            return (
              <button
                type="button"
                key={city.key}
                aria-label={`Редактировать меню города ${city.name}, ${branchCountLabel(city.branches.length)}`}
                aria-pressed={isSelected}
                onClick={() => chooseCity(city)}
                className={`flex min-h-20 items-center gap-3 rounded-2xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2 ${
                  isSelected
                    ? 'border-amber-500 bg-amber-50'
                    : 'border-stone-200 bg-white hover:border-amber-300 hover:bg-amber-50/40'
                }`}
              >
                <span
                  className={`grid size-11 shrink-0 place-items-center rounded-xl ${
                    isSelected ? 'bg-amber-500 text-white' : 'bg-stone-100 text-stone-700'
                  }`}
                >
                  <MapPin aria-hidden="true" size={21} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-base font-bold text-stone-900">
                    {city.name}
                  </span>
                  <span className="mt-0.5 block text-sm text-stone-500">
                    {branchCountLabel(city.branches.length)}
                  </span>
                </span>
                {cityProfile?.configured === false && (
                  <CircleAlert
                    aria-label="Профиль iiko не настроен"
                    className="shrink-0 text-red-600"
                    size={19}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {selectedCity && selectedBranch && (
        <div className="mt-4 grid gap-3 rounded-2xl bg-stone-50 p-4 sm:grid-cols-3">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-amber-700 shadow-sm">
              <MapPin aria-hidden="true" size={20} />
            </span>
            <div className="min-w-0">
              <span className="block text-xs font-semibold uppercase tracking-wide text-stone-500">
                Сейчас редактируется
              </span>
              <strong className="mt-0.5 block truncate text-base text-stone-900">
                Меню города {selectedCity.name}
              </strong>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
            <Building2 aria-hidden="true" className="shrink-0 text-amber-700" size={18} />
            <div>
              <span className="block text-xs font-semibold text-stone-500">Область применения</span>
              <strong className="mt-0.5 block text-sm text-stone-900">
                Все доступные филиалы города
              </strong>
            </div>
          </div>
          <div className="rounded-xl border border-stone-200 bg-white px-3 py-2.5">
            <span className="block text-xs font-semibold text-stone-500">Состав меню</span>
            <strong className="mt-0.5 block text-sm text-stone-900">
              {loading ? 'Загружаем…' : hasError ? 'Не загружено' : `${productsCount} блюд · ${categoriesCount} категорий`}
            </strong>
          </div>
        </div>
      )}
    </section>
  );
}

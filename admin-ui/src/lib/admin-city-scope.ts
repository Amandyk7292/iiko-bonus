import type { AdminScopeLocation } from './api';

export type AdminCityScope = {
  key: string;
  name: string;
  branches: AdminScopeLocation[];
};

export const normalizeAdminCity = (value: string) =>
  String(value || '')
    .trim()
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ');

export function getAdminCityScopes(locations: AdminScopeLocation[]): AdminCityScope[] {
  const groups = new Map<string, AdminCityScope>();
  for (const branch of locations) {
    if (branch.active === false) continue;
    const name = String(branch.city || '').trim();
    if (!name) continue;
    const key = normalizeAdminCity(name);
    const current = groups.get(key);
    if (current) current.branches.push(branch);
    else groups.set(key, { key, name, branches: [branch] });
  }

  return [...groups.values()]
    .map((city) => ({
      ...city,
      branches: [...city.branches].sort((left, right) => left.name.localeCompare(right.name, 'ru')),
    }))
    .sort((left, right) => left.name.localeCompare(right.name, 'ru'));
}

export function cityScopeForBranch(cities: AdminCityScope[], branchId: string) {
  const normalizedBranchId = String(branchId || '').trim();
  return cities.find((city) =>
    city.branches.some((branch) => String(branch.id) === normalizedBranchId),
  );
}

import type { AdminScopeLocation } from './api-types';

export type AdminCityScope = {
  key: string;
  name: string;
  branches: AdminScopeLocation[];
};

export type AdminScopeSelection =
  | { kind: 'all'; branchIds: [] }
  | { kind: 'branch'; branchId: string; branchIds: [string] }
  | { kind: 'city'; cityKey: string; branchIds: string[] };

const CITY_SCOPE_PREFIX = 'city:';

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

export function adminCityScopeValue(city: AdminCityScope) {
  const branchIds = city.branches.map((branch) => String(branch.id || '').trim()).filter(Boolean);
  return `${CITY_SCOPE_PREFIX}${encodeURIComponent(city.key)}|${branchIds.join(',')}`;
}

export function parseAdminScopeSelection(value: string): AdminScopeSelection {
  const normalized = String(value || '').trim();
  if (!normalized) return { kind: 'all', branchIds: [] };
  if (!normalized.startsWith(CITY_SCOPE_PREFIX)) {
    return { kind: 'branch', branchId: normalized, branchIds: [normalized] };
  }

  const payload = normalized.slice(CITY_SCOPE_PREFIX.length);
  const separator = payload.indexOf('|');
  const encodedCityKey = separator >= 0 ? payload.slice(0, separator) : payload;
  const rawBranchIds = separator >= 0 ? payload.slice(separator + 1) : '';
  let cityKey = '';
  try {
    cityKey = decodeURIComponent(encodedCityKey);
  } catch {
    cityKey = '';
  }
  const branchIds = Array.from(
    new Set(
      rawBranchIds
        .split(',')
        .map((branchId) => branchId.trim())
        .filter(Boolean),
    ),
  );
  return { kind: 'city', cityKey, branchIds };
}

export function cityScopeForSelection(cities: AdminCityScope[], value: string) {
  const selection = parseAdminScopeSelection(value);
  if (selection.kind === 'city') {
    return cities.find((city) => city.key === selection.cityKey);
  }
  return selection.kind === 'branch'
    ? cityScopeForBranch(cities, selection.branchId)
    : undefined;
}

export function primaryBranchIdForAdminScope(value: string) {
  return parseAdminScopeSelection(value).branchIds[0] || '';
}

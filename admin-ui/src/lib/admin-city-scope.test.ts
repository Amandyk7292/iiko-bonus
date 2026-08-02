import { describe, expect, it } from 'vitest';
import { cityScopeForBranch, getAdminCityScopes } from './admin-city-scope';

const locations = [
  { id: 'astana-2', name: 'Улы Дала', address: '', city: 'Астана', active: true },
  { id: 'aktau-1', name: 'Дукат', address: '', city: 'Актау', active: true },
  { id: 'astana-1', name: 'Кабанбай', address: '', city: ' астана ', active: true },
  { id: 'aktau-off', name: 'Закрыт', address: '', city: 'Актау', active: false },
];

describe('admin city scope', () => {
  it('groups only active branches by normalized city', () => {
    expect(
      getAdminCityScopes(locations).map((city) => [
        city.name,
        city.branches.map((branch) => branch.id),
      ]),
    ).toEqual([
      ['Актау', ['aktau-1']],
      ['Астана', ['astana-1', 'astana-2']],
    ]);
  });

  it('resolves the selected city through a technical branch', () => {
    const cities = getAdminCityScopes(locations);
    expect(cityScopeForBranch(cities, 'astana-2')?.name).toBe('Астана');
    expect(cityScopeForBranch(cities, 'missing')).toBeUndefined();
  });
});

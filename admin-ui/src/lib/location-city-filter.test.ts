import { describe, expect, it } from 'vitest';
import {
  ALL_CITY_FILTER,
  filterLocationsByCity,
  getLocationCityCounts,
  resolveLocationCityFilter,
} from './location-city-filter';

const locations = [
  { id: 'astana-1', city: 'Астана' },
  { id: 'aktau-1', city: 'Актау' },
  { id: 'astana-2', city: ' Астана ' },
  { id: 'aktau-2', city: 'Актау' },
];

describe('location city filter', () => {
  it('keeps backend city order and counts every branch', () => {
    expect(getLocationCityCounts(locations)).toEqual([
      { name: 'Астана', count: 2 },
      { name: 'Актау', count: 2 },
    ]);
  });

  it('keeps registered cities that do not have branches yet', () => {
    expect(getLocationCityCounts(locations, ['Астана', 'Актау', 'Алматы'])).toEqual([
      { name: 'Астана', count: 2 },
      { name: 'Актау', count: 2 },
      { name: 'Алматы', count: 0 },
    ]);
  });

  it('opens the first available city and preserves an explicit all-cities choice', () => {
    const cities = getLocationCityCounts(locations);
    expect(resolveLocationCityFilter('', cities)).toBe('Астана');
    expect(resolveLocationCityFilter('Несуществующий', cities)).toBe('Астана');
    expect(resolveLocationCityFilter(ALL_CITY_FILTER, cities)).toBe(ALL_CITY_FILTER);
  });

  it('returns only branches from the selected city', () => {
    expect(filterLocationsByCity(locations, 'Актау').map((location) => location.id)).toEqual([
      'aktau-1',
      'aktau-2',
    ]);
    expect(filterLocationsByCity(locations, ALL_CITY_FILTER)).toHaveLength(4);
  });
});

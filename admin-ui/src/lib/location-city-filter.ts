export const ALL_CITY_FILTER = 'all';

export type LocationCityCount = {
  name: string;
  count: number;
};

export function getLocationCityCounts<T extends { city: string }>(
  locations: T[],
  registeredCities: string[] = [],
): LocationCityCount[] {
  const counts = new Map<string, number>(
    registeredCities
      .map((city) => city.trim())
      .filter(Boolean)
      .map((city): [string, number] => [city, 0]),
  );
  for (const location of locations) {
    const city = location.city.trim();
    if (!city) continue;
    counts.set(city, (counts.get(city) ?? 0) + 1);
  }
  return [...counts].map(([name, count]) => ({ name, count }));
}

export function resolveLocationCityFilter(
  requestedCity: string,
  cities: LocationCityCount[],
): string {
  if (requestedCity === ALL_CITY_FILTER) return ALL_CITY_FILTER;
  if (cities.some((city) => city.name === requestedCity)) return requestedCity;
  return cities[0]?.name ?? ALL_CITY_FILTER;
}

export function filterLocationsByCity<T extends { city: string }>(
  locations: T[],
  selectedCity: string,
): T[] {
  if (selectedCity === ALL_CITY_FILTER) return locations;
  return locations.filter((location) => location.city.trim() === selectedCity);
}

import { useId, useMemo, useState } from 'react';
import { Building2, Search } from 'lucide-react';
import SelectControl from './SelectControl';
import { useI18n } from '../lib/i18n';

export interface AccessBranch {
  id: string;
  name?: string;
  address?: string;
  city?: string | null;
}

interface Props {
  locations: AccessBranch[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  single?: boolean;
}

const normalize = (value: string) => value.trim().normalize('NFKC').toLocaleLowerCase('ru-RU');
const cityKey = (location: AccessBranch) => normalize(location.city || '') || '__missing__';

export default function BranchAccessPicker({
  locations,
  selectedIds,
  onChange,
  single = false,
}: Props) {
  const { t } = useI18n();
  const id = useId();
  const [city, setCity] = useState('');
  const [search, setSearch] = useState('');
  const [onlySelected, setOnlySelected] = useState(false);
  const selected = new Set(selectedIds);
  const cities = useMemo(() => {
    const names = new Map<string, string>();
    for (const location of locations) {
      names.set(cityKey(location), location.city?.trim() || t('branchPicker.noCity'));
    }
    return [...names].sort((a, b) => a[1].localeCompare(b[1], 'ru'));
  }, [locations, t]);
  const query = normalize(search);
  const visible = locations.filter(
    (location) =>
      (!city || cityKey(location) === city) &&
      (!onlySelected || selected.has(location.id)) &&
      (!query ||
        normalize(
          `${location.name || ''} ${location.address || ''} ${location.city || ''}`,
        ).includes(query)),
  );
  const groups = cities
    .map(([key, name]) => ({
      key,
      name,
      branches: visible.filter((branch) => cityKey(branch) === key),
    }))
    .filter((group) => group.branches.length > 0);
  const resetFilters = () => {
    setCity('');
    setSearch('');
    setOnlySelected(false);
  };

  return (
    <fieldset className="branch-picker">
      <legend>
        <span>
          <Building2 size={18} aria-hidden="true" />
          {t('access.availableBranches')}
        </span>
      </legend>
      {locations.length ? (
        <>
          <div className="branch-picker-filters">
            <div className="field-group">
              <label className="field-label" htmlFor={`${id}-city`}>
                {t('branchPicker.city')}
              </label>
              <SelectControl
                id={`${id}-city`}
                value={city}
                onChange={setCity}
                options={[
                  { value: '', label: t('branchPicker.allCities') },
                  ...cities.map(([value, label]) => ({ value, label })),
                ]}
              />
            </div>
            <label className="field-group">
              <span className="field-label">{t('branchPicker.search')}</span>
              <span className="input-with-icon">
                <Search size={18} aria-hidden="true" />
                <input
                  className="input-classic"
                  type="search"
                  value={search}
                  placeholder={t('branchPicker.searchHint')}
                  onChange={(event) => setSearch(event.target.value)}
                />
              </span>
            </label>
          </div>
          <div className="branch-picker-summary">
            <span aria-live="polite">
              {t('branchPicker.selectedCount', { count: selectedIds.length })}
            </span>
            {selectedIds.length > 0 && (
              <button
                type="button"
                className="branch-picker-selected"
                aria-pressed={onlySelected}
                onClick={() => {
                  setOnlySelected(!onlySelected);
                  setCity('');
                  setSearch('');
                }}
              >
                {onlySelected ? t('branchPicker.showAll') : t('branchPicker.showSelected')}
              </button>
            )}
          </div>
          {groups.length ? (
            groups.map((group) => (
              <div className="branch-picker-group" key={group.key}>
                <h4>
                  {group.name}
                  <span>{group.branches.length}</span>
                </h4>
                <div className="branch-picker-options">
                  {group.branches.map((location) => (
                    <label
                      key={location.id}
                      className={`branch-picker-option ${selected.has(location.id) ? 'is-selected' : ''}`}
                    >
                      <input
                        type={single ? 'radio' : 'checkbox'}
                        name={single ? `${id}-branch` : undefined}
                        checked={selected.has(location.id)}
                        onChange={(event) =>
                          onChange(
                            single
                              ? [location.id]
                              : event.target.checked
                                ? [...selectedIds, location.id]
                                : selectedIds.filter((value) => value !== location.id),
                          )
                        }
                      />
                      <span>
                        <strong>{location.name || location.address}</strong>
                        {location.address && location.address !== location.name && (
                          <span>{location.address}</span>
                        )}
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="branch-picker-empty" role="status">
              <p>{t('branchPicker.noResults')}</p>
              <button type="button" className="btn-outline" onClick={resetFilters}>
                {t('branchPicker.reset')}
              </button>
            </div>
          )}
        </>
      ) : (
        <p className="page-help">{t('access.noBranches')}</p>
      )}
    </fieldset>
  );
}

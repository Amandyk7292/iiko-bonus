import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import {
  Building2,
  Clock3,
  Layers3,
  LoaderCircle,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import YandexLocationMap, {
  type DeliveryMapZone,
  type MapPointDetails,
} from '../components/YandexLocationMap';
import { useFeedback } from '../components/Feedback';
import { api, type AdminLocationCity, type AdminUser } from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
import {
  ALL_CITY_FILTER,
  filterLocationsByCity,
  getLocationCityCounts,
  resolveLocationCityFilter,
} from '../lib/location-city-filter';
import { useSearchParams } from '../lib/router';

type Hours = Record<string, unknown> & { daily?: { open?: string; close?: string } };

type FulfillmentLocation = {
  id: string;
  cityId?: string | null;
  twoGisId?: string | null;
  name: string;
  address: string;
  city: string;
  latitude: number | null;
  longitude: number | null;
  hours?: Hours;
  active: boolean;
  pickupEnabled: boolean;
  preorderEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryRadiusKm: number | null;
  deliveryFee: number | null;
  deliveryMinOrder: number | null;
  deliveryZones?: DeliveryMapZone[];
  slotMinutes: number;
  pickupSlotCapacity: number;
  preorderSlotCapacity: number;
  deliverySlotCapacity: number;
};

type CityDraft = {
  name: string;
  latitude: string;
  longitude: string;
  pointSelected: boolean;
};

type PointDraft = {
  cityId: string;
  name: string;
  address: string;
  latitude: string;
  longitude: string;
  pointSelected: boolean;
  active: boolean;
  pickupEnabled: boolean;
  preorderEnabled: boolean;
  deliveryEnabled: boolean;
  open: string;
  close: string;
};

type ZoneDraft = { id: string; radiusKm: string; fee: string; minOrder: string; color: string };
type ZoneValue = { id: string; radiusKm: number; fee: number; minOrder: number; color: string };
type Draft = {
  active: boolean;
  pickupEnabled: boolean;
  preorderEnabled: boolean;
  deliveryEnabled: boolean;
  latitude: string;
  longitude: string;
  deliveryZones: ZoneDraft[];
  open: string;
  close: string;
  slotMinutes: string;
  pickupSlotCapacity: string;
  preorderSlotCapacity: string;
  deliverySlotCapacity: string;
};

const zoneColors = ['#66BB6A', '#29B6F6', '#FFD54F', '#EC407A', '#7E57C2', '#FF8A65'];
const defaultZone = (): ZoneDraft => ({ id: `zone-${Date.now()}`, radiusKm: '5', fee: '700', minOrder: '3000', color: zoneColors[0] });
const emptyDraft: Draft = {
  active: true, pickupEnabled: true, preorderEnabled: true, deliveryEnabled: false,
  latitude: '', longitude: '', deliveryZones: [defaultZone()], open: '08:00', close: '21:00',
  slotMinutes: '60', pickupSlotCapacity: '20', preorderSlotCapacity: '10', deliverySlotCapacity: '15',
};
const emptyCityDraft = (): CityDraft => ({
  name: '',
  latitude: '',
  longitude: '',
  pointSelected: false,
});
const emptyPointDraft = (cityId = ''): PointDraft => ({
  cityId,
  name: '',
  address: '',
  latitude: '',
  longitude: '',
  pointSelected: false,
  active: true,
  pickupEnabled: true,
  preorderEnabled: true,
  deliveryEnabled: false,
  open: '08:00',
  close: '21:00',
});

const validClock = (value: string) => /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(value);
const clockMinutes = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
const numeric = (value: string) => value.trim() === '' ? Number.NaN : Number(value);

const parsedZones = (drafts: ZoneDraft[]): ZoneValue[] | null => {
  const zones = drafts.map((zone) => ({
    id: zone.id,
    radiusKm: numeric(zone.radiusKm),
    fee: numeric(zone.fee),
    minOrder: numeric(zone.minOrder),
    color: zone.color,
  })).sort((first, second) => first.radiusKm - second.radiusKm);
  const invalid = zones.some(zone => !Number.isFinite(zone.radiusKm) || zone.radiusKm <= 0 || zone.radiusKm > 100 || !Number.isSafeInteger(zone.fee) || zone.fee < 0 || !Number.isSafeInteger(zone.minOrder) || zone.minOrder < 0 || !/^#[0-9a-f]{6}$/i.test(zone.color));
  const duplicateRadius = new Set(zones.map(zone => zone.radiusKm.toFixed(3))).size !== zones.length;
  return invalid || duplicateRadius || zones.length === 0 || zones.length > 8 ? null : zones;
};

const appendZone = (zones: ZoneDraft[]) => {
  const last = zones[zones.length - 1];
  const nextRadius = Number.isFinite(numeric(last?.radiusKm || '')) ? numeric(last.radiusKm) + 2 : 5;
  const nextFee = Number.isFinite(numeric(last?.fee || '')) ? numeric(last.fee) + 300 : 700;
  return [...zones, {
    id: `zone-${Date.now()}`,
    radiusKm: String(nextRadius),
    fee: String(nextFee),
    minOrder: last?.minOrder || '3000',
    color: zoneColors[zones.length % zoneColors.length],
  }];
};

const zonesForLocation = (location: FulfillmentLocation): ZoneDraft[] => {
  const zones = Array.isArray(location.deliveryZones) ? location.deliveryZones : [];
  if (zones.length > 0) return zones.map((zone, index) => ({
    id: zone.id || `zone-${index + 1}`,
    radiusKm: String(zone.radiusKm), fee: String(zone.fee), minOrder: String(zone.minOrder),
    color: zone.color || zoneColors[index % zoneColors.length],
  }));
  if (location.deliveryRadiusKm != null && location.deliveryFee != null && location.deliveryMinOrder != null) {
    return [{ id: 'zone-1', radiusKm: String(location.deliveryRadiusKm), fee: String(location.deliveryFee), minOrder: String(location.deliveryMinOrder), color: zoneColors[0] }];
  }
  return [defaultZone()];
};

function DeliveryZonesEditor({
  zones,
  idPrefix,
  t,
  onUpdate,
  onAdd,
  onRemove,
}: {
  zones: ZoneDraft[];
  idPrefix: string;
  t: (key: string) => string;
  onUpdate: (id: string, patch: Partial<ZoneDraft>) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
}) {
  return <>
    <div className="zone-editor-heading"><p className="page-help">{t('locations.deliveryZonesHint')}</p><button type="button" className="btn-outline compact-button" onClick={onAdd} disabled={zones.length >= 8}><Plus aria-hidden="true" size={16} />{t('locations.addZone')}</button></div>
    <div className="delivery-zone-list">{zones.map((zone, index) => <div className="delivery-zone-card" key={zone.id} style={{ '--zone-color': zone.color } as CSSProperties}>
      <div className="delivery-zone-number"><span>{index + 1}</span><strong>{t('locations.zone')} {index + 1}</strong></div>
      <div className="delivery-zone-fields"><div className="field-group"><label className="field-label" htmlFor={`${idPrefix}-radius-${zone.id}`}>{t('locations.deliveryRadius')}</label><input id={`${idPrefix}-radius-${zone.id}`} type="number" min="0.1" max="100" step="0.1" className="input-classic" value={zone.radiusKm} onChange={event => onUpdate(zone.id, { radiusKm: event.target.value })} required /></div><div className="field-group"><label className="field-label" htmlFor={`${idPrefix}-fee-${zone.id}`}>{t('locations.deliveryFee')}</label><input id={`${idPrefix}-fee-${zone.id}`} type="number" min="0" max="100000" step="1" className="input-classic" value={zone.fee} onChange={event => onUpdate(zone.id, { fee: event.target.value })} required /></div><div className="field-group"><label className="field-label" htmlFor={`${idPrefix}-min-${zone.id}`}>{t('locations.deliveryMinimum')}</label><input id={`${idPrefix}-min-${zone.id}`} type="number" min="0" max="10000000" step="1" className="input-classic" value={zone.minOrder} onChange={event => onUpdate(zone.id, { minOrder: event.target.value })} required /></div><div className="field-group zone-color-field"><label className="field-label" htmlFor={`${idPrefix}-color-${zone.id}`}>{t('locations.zoneColor')}</label><input id={`${idPrefix}-color-${zone.id}`} type="color" value={zone.color} onChange={event => onUpdate(zone.id, { color: event.target.value.toUpperCase() })} /></div></div>
      <button type="button" className="icon-button icon-button-danger" onClick={() => onRemove(zone.id)} disabled={zones.length === 1} aria-label={t('locations.removeZone')}><Trash2 aria-hidden="true" size={18} /></button>
    </div>)}</div>
  </>;
}

export default function LocationsPage({ user }: { user: AdminUser | null }) {
  const { t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [searchParams, setSearchParams] = useSearchParams();
  const [locations, setLocations] = useState<FulfillmentLocation[]>([]);
  const [cities, setCities] = useState<AdminLocationCity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  const [cityDraft, setCityDraft] = useState<CityDraft>(emptyCityDraft);
  const [citySubmitting, setCitySubmitting] = useState(false);
  const [cityError, setCityError] = useState('');
  const [pointOpen, setPointOpen] = useState(false);
  const [pointDraft, setPointDraft] = useState<PointDraft>(emptyPointDraft);
  const [pointSubmitting, setPointSubmitting] = useState(false);
  const [pointError, setPointError] = useState('');
  const [editing, setEditing] = useState<FulfillmentLocation | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkZones, setBulkZones] = useState<ZoneDraft[]>([defaultZone()]);
  const [bulkEnableDelivery, setBulkEnableDelivery] = useState(false);
  const [bulkSubmitting, setBulkSubmitting] = useState(false);
  const [bulkError, setBulkError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const [locationsResult, citiesResult] = await Promise.all([
        api.getFulfillmentLocations(),
        api.getLocationCities(),
      ]);
      setLocations(locationsResult.locations ?? []);
      setCities(citiesResult.cities ?? []);
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally { if (!silent) setLoading(false); }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 300_000);
    return () => window.clearInterval(timer);
  }, [load]);

  useAdminRealtimeEvents(
    ['locations.updated'],
    () => document.visibilityState === 'visible' && void load(true),
    [load],
  );

  const openEditor = (location: FulfillmentLocation) => {
    const daily = location.hours?.daily;
    setEditing(location);
    setDraft({
      active: location.active,
      pickupEnabled: location.pickupEnabled,
      preorderEnabled: location.preorderEnabled,
      deliveryEnabled: location.deliveryEnabled,
      latitude: location.latitude == null ? '' : String(location.latitude),
      longitude: location.longitude == null ? '' : String(location.longitude),
      deliveryZones: zonesForLocation(location),
      open: daily?.open || '08:00', close: daily?.close || '21:00',
      slotMinutes: String(location.slotMinutes || 60),
      pickupSlotCapacity: String(location.pickupSlotCapacity || 20),
      preorderSlotCapacity: String(location.preorderSlotCapacity || 10),
      deliverySlotCapacity: String(location.deliverySlotCapacity || 15),
    });
    setFormError('');
  };

  const canManageStructure = ['owner', 'admin'].includes(String(user?.role || ''));
  const activeLocations = useMemo(() => locations.filter(location => location.active), [locations]);
  const cityCounts = useMemo(
    () => getLocationCityCounts(locations, cities.map((city) => city.name)),
    [cities, locations],
  );
  const requestedCity = searchParams.get('city')?.trim() ?? '';
  const selectedCity = useMemo(
    () => resolveLocationCityFilter(requestedCity, cityCounts),
    [cityCounts, requestedCity],
  );
  const visibleLocations = useMemo(
    () => filterLocationsByCity(locations, selectedCity),
    [locations, selectedCity],
  );
  const selectedCityRecord = useMemo(
    () => cities.find((city) => city.name === selectedCity) ?? null,
    [cities, selectedCity],
  );
  const pointCity = useMemo(
    () => cities.find((city) => city.id === pointDraft.cityId) ?? null,
    [cities, pointDraft.cityId],
  );

  const selectCity = useCallback((city: string, replace = false) => {
    const next = new URLSearchParams(searchParams);
    next.set('city', city);
    setSearchParams(next, { replace });
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (loading || cityCounts.length === 0 || requestedCity === selectedCity) return;
    selectCity(selectedCity, true);
  }, [cityCounts.length, loading, requestedCity, selectCity, selectedCity]);

  const openCityCreator = () => {
    setCityDraft(emptyCityDraft());
    setCityError('');
    setCityOpen(true);
  };

  const openPointCreator = (city: AdminLocationCity | null = selectedCityRecord) => {
    const targetCity = city ?? cities[0] ?? null;
    if (!targetCity) {
      openCityCreator();
      return;
    }
    setPointDraft(emptyPointDraft(targetCity.id));
    setPointError('');
    setPointOpen(true);
  };

  const selectCityPoint = (
    latitude: number,
    longitude: number,
    details?: MapPointDetails,
  ) => {
    setCityDraft((current) => ({
      ...current,
      name: current.name || details?.city || '',
      latitude: latitude.toFixed(7),
      longitude: longitude.toFixed(7),
      pointSelected: true,
    }));
  };

  const selectBranchPoint = (
    latitude: number,
    longitude: number,
    details?: MapPointDetails,
  ) => {
    setPointDraft((current) => ({
      ...current,
      address: current.address || details?.address || '',
      latitude: latitude.toFixed(7),
      longitude: longitude.toFixed(7),
      pointSelected: true,
    }));
  };

  const saveCity = async (event: FormEvent) => {
    event.preventDefault();
    if (citySubmitting) return;
    const latitude = numeric(cityDraft.latitude);
    const longitude = numeric(cityDraft.longitude);
    if (cityDraft.name.trim().length < 2) {
      setCityError(t('locations.cityValidation'));
      return;
    }
    if (
      !cityDraft.pointSelected ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      setCityError(t('locations.cityCoordinatesRequired'));
      return;
    }
    setCitySubmitting(true);
    setCityError('');
    try {
      const result = await api.createLocationCity({
        name: cityDraft.name.trim(),
        latitude,
        longitude,
      });
      const city = { ...result.city, branchCount: 0 };
      setCities((current) => [...current, city]);
      setCityOpen(false);
      selectCity(city.name);
      toast(t('locations.cityCreated'));
      openPointCreator(city);
    } catch (caught) {
      setCityError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setCitySubmitting(false);
    }
  };

  const savePoint = async (event: FormEvent) => {
    event.preventDefault();
    if (pointSubmitting) return;
    const latitude = numeric(pointDraft.latitude);
    const longitude = numeric(pointDraft.longitude);
    if (!pointDraft.cityId || pointDraft.name.trim().length < 2 || pointDraft.address.trim().length < 3) {
      setPointError(t('locations.pointValidation'));
      return;
    }
    if (
      !pointDraft.pointSelected ||
      !Number.isFinite(latitude) ||
      !Number.isFinite(longitude)
    ) {
      setPointError(t('locations.coordinatesInvalid'));
      return;
    }
    if (
      !validClock(pointDraft.open) ||
      !validClock(pointDraft.close) ||
      clockMinutes(pointDraft.open) >= clockMinutes(pointDraft.close)
    ) {
      setPointError(t('locations.hoursInvalid'));
      return;
    }
    setPointSubmitting(true);
    setPointError('');
    try {
      const result = await api.createFulfillmentLocation({
        cityId: pointDraft.cityId,
        name: pointDraft.name.trim(),
        address: pointDraft.address.trim(),
        latitude,
        longitude,
        active: pointDraft.active,
        pickupEnabled: pointDraft.pickupEnabled,
        preorderEnabled: pointDraft.preorderEnabled,
        deliveryEnabled: pointDraft.deliveryEnabled,
        deliveryZones: [{
          id: 'zone-1',
          radiusKm: 5,
          fee: 700,
          minOrder: 3000,
          color: zoneColors[0],
        }],
        hours: { daily: { open: pointDraft.open, close: pointDraft.close } },
        slotMinutes: 60,
        pickupSlotCapacity: 20,
        preorderSlotCapacity: 10,
        deliverySlotCapacity: 15,
      });
      const location = result.location as FulfillmentLocation;
      setLocations((current) => [...current, location]);
      setCities((current) =>
        current.map((city) =>
          city.id === pointDraft.cityId
            ? { ...city, branchCount: (city.branchCount || 0) + 1 }
            : city,
        ),
      );
      setPointOpen(false);
      selectCity(location.city);
      toast(t('locations.pointCreated'));
    } catch (caught) {
      setPointError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setPointSubmitting(false);
    }
  };

  const openBulkEditor = () => {
    const source = activeLocations.find(location => (location.deliveryZones?.length || 0) > 0) ?? activeLocations[0];
    setBulkZones(source ? zonesForLocation(source) : [defaultZone()]);
    setBulkEnableDelivery(false);
    setBulkError('');
    setBulkOpen(true);
  };

  const previewZones = useMemo<DeliveryMapZone[]>(() => draft.deliveryZones.map((zone) => ({
    id: zone.id, radiusKm: numeric(zone.radiusKm), fee: numeric(zone.fee), minOrder: numeric(zone.minOrder), color: zone.color,
  })).filter((zone) => Number.isFinite(zone.radiusKm) && zone.radiusKm > 0), [draft.deliveryZones]);

  const updateZone = (id: string, patch: Partial<ZoneDraft>) => setDraft(current => ({
    ...current,
    deliveryZones: current.deliveryZones.map(zone => zone.id === id ? { ...zone, ...patch } : zone),
  }));

  const addZone = () => setDraft(current => ({ ...current, deliveryZones: appendZone(current.deliveryZones) }));

  const removeZone = (id: string) => setDraft(current => ({
    ...current,
    deliveryZones: current.deliveryZones.length > 1 ? current.deliveryZones.filter(zone => zone.id !== id) : current.deliveryZones,
  }));

  const updateBulkZone = (id: string, patch: Partial<ZoneDraft>) => setBulkZones(current => current.map(zone => zone.id === id ? { ...zone, ...patch } : zone));
  const removeBulkZone = (id: string) => setBulkZones(current => current.length > 1 ? current.filter(zone => zone.id !== id) : current);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || submitting) return;
    const latitude = numeric(draft.latitude);
    const longitude = numeric(draft.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setFormError(t('locations.coordinatesInvalid')); return;
    }
    const zones = parsedZones(draft.deliveryZones);
    if (!zones) {
      setFormError(t('locations.deliveryValuesInvalid')); return;
    }
    if (!validClock(draft.open) || !validClock(draft.close) || clockMinutes(draft.open) >= clockMinutes(draft.close)) {
      setFormError(t('locations.hoursInvalid')); return;
    }
    const slotMinutes = numeric(draft.slotMinutes);
    const pickupSlotCapacity = numeric(draft.pickupSlotCapacity);
    const preorderSlotCapacity = numeric(draft.preorderSlotCapacity);
    const deliverySlotCapacity = numeric(draft.deliverySlotCapacity);
    if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 240 || [pickupSlotCapacity, preorderSlotCapacity, deliverySlotCapacity].some(value => !Number.isInteger(value) || value < 1 || value > 500)) {
      setFormError(t('locations.capacityInvalid')); return;
    }
    setSubmitting(true); setFormError('');
    try {
      const outer = zones[zones.length - 1];
      const result = await api.updateFulfillmentLocation(editing.id, {
        active: draft.active, pickupEnabled: draft.pickupEnabled, preorderEnabled: draft.preorderEnabled,
        deliveryEnabled: draft.deliveryEnabled, latitude, longitude, deliveryZones: zones,
        deliveryRadiusKm: outer.radiusKm, deliveryFee: outer.fee, deliveryMinOrder: outer.minOrder,
        hours: { ...(editing.hours ?? {}), daily: { open: draft.open, close: draft.close } },
        slotMinutes, pickupSlotCapacity, preorderSlotCapacity, deliverySlotCapacity,
      });
      setLocations(current => current.map(item => item.id === editing.id ? result.location : item));
      setEditing(null); toast(t('locations.saved'));
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : t('common.error')); }
    finally { setSubmitting(false); }
  };

  const saveBulk = async (event: FormEvent) => {
    event.preventDefault();
    if (bulkSubmitting || activeLocations.length === 0) return;
    const zones = parsedZones(bulkZones);
    if (!zones) {
      setBulkError(t('locations.deliveryValuesInvalid'));
      return;
    }
    const accepted = await confirm({
      title: t('locations.bulkConfirmTitle'),
      body: t('locations.bulkConfirmBody', { count: activeLocations.length }),
      confirmLabel: t('locations.bulkApply', { count: activeLocations.length }),
      destructive: true,
    });
    if (!accepted) return;
    setBulkSubmitting(true);
    setBulkError('');
    try {
      const result = await api.updateAllFulfillmentDeliveryZones({ deliveryZones: zones, enableDelivery: bulkEnableDelivery });
      const updated = new Map<string, FulfillmentLocation>(result.locations.map(location => [location.id, location]));
      setLocations(current => current.map(location => updated.get(location.id) ?? location));
      setBulkOpen(false);
      toast(t('locations.bulkSaved', { count: result.updatedCount }));
    } catch (caught) {
      setBulkError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setBulkSubmitting(false);
    }
  };

  if (loading && locations.length === 0 && cities.length === 0) return <PageState type="loading" />;
  if (error && locations.length === 0 && cities.length === 0) return <PageState type="error" description={error} onRetry={() => load()} />;

  return <div className="page-stack">
    <div className="page-actions-row">
      <div><h2 className="content-heading">{t('locations.heading')}</h2><p className="page-help">{t('locations.fulfillmentIntro')}</p></div>
      <div className="action-cluster">
        {canManageStructure && <><button type="button" className="btn-classic px-5 inline-flex items-center gap-2" onClick={() => openPointCreator()} disabled={cities.length === 0}><Plus aria-hidden="true" size={17} />{t('locations.addPoint')}</button><button type="button" className="btn-outline px-5 inline-flex items-center gap-2" onClick={openCityCreator}><Building2 aria-hidden="true" size={17} />{t('locations.newCity')}</button></>}
        <button type="button" className="btn-outline px-5 inline-flex items-center gap-2" onClick={openBulkEditor} disabled={activeLocations.length === 0}><Layers3 aria-hidden="true" size={17} />{t('locations.commonZones')}</button>
        <button type="button" className="btn-outline px-5 inline-flex items-center gap-2" onClick={() => load()} disabled={loading}><RefreshCw aria-hidden="true" size={17} />{t('common.refresh')}</button>
      </div>
    </div>
    {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
    {cityCounts.length === 0 ? <PageState type="empty" title={t('locations.empty')} description={t('locations.emptyHint')} action={canManageStructure ? <button type="button" className="btn-classic px-5 inline-flex items-center gap-2" onClick={openCityCreator}><Building2 aria-hidden="true" size={17} />{t('locations.addCity')}</button> : undefined} /> : <>
      <section className="location-city-filter" aria-labelledby="locations-city-filter-title">
        <div className="location-city-filter-copy">
          <h3 id="locations-city-filter-title">{t('locations.cityFilter')}</h3>
          <p aria-live="polite">{t('locations.cityFilterSummary', { shown: visibleLocations.length, total: locations.length })}</p>
        </div>
        <div className="segmented-control location-city-tabs" role="group" aria-label={t('locations.cityFilter')}>
          <button type="button" className={selectedCity === ALL_CITY_FILTER ? 'is-active' : ''} aria-pressed={selectedCity === ALL_CITY_FILTER} onClick={() => selectCity(ALL_CITY_FILTER)}>
            <span>{t('locations.allCities')}</span><span className="location-city-count" aria-hidden="true">{locations.length}</span>
          </button>
          {cityCounts.map(city => <button type="button" key={city.name} className={selectedCity === city.name ? 'is-active' : ''} aria-pressed={selectedCity === city.name} onClick={() => selectCity(city.name)}>
            <span>{city.name}</span><span className="location-city-count" aria-hidden="true">{city.count}</span>
          </button>)}
        </div>
      </section>
      {visibleLocations.length === 0 ? <PageState compact type="empty" title={t('locations.noPoints')} description={t('locations.noPointsHint', { city: selectedCity === ALL_CITY_FILTER ? t('locations.allCities') : selectedCity })} action={canManageStructure ? <button type="button" className="btn-classic px-5 inline-flex items-center gap-2" onClick={() => openPointCreator()}><Plus aria-hidden="true" size={17} />{t('locations.addPoint')}</button> : undefined} /> : <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table locations-table">
        <thead><tr><th>{t('locations.cityBranch')}</th><th>{t('locations.address')}</th><th>{t('locations.services')}</th><th>{t('locations.deliveryRules')}</th><th>{t('locations.hours')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
        <tbody>{visibleLocations.map(location => <tr key={location.id}>
          <td data-label={t('locations.cityBranch')}><div className="location-name"><MapPin aria-hidden="true" size={18} /><div><strong>{location.name}</strong><small className="location-meta">{location.city}</small></div></div></td>
          <td data-label={t('locations.address')}>{location.address}<small className="location-meta">{location.latitude != null && location.longitude != null ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : '—'}</small></td>
          <td data-label={t('locations.services')}><div className="location-statuses"><span className={`status-pill ${location.active ? 'status-active' : 'status-inactive'}`}>{location.active ? t('common.active') : t('common.inactive')}</span>{location.pickupEnabled && <span className="status-pill status-info">{t('locations.pickup')}</span>}{location.preorderEnabled && <span className="status-pill status-info">{t('locations.preorder')}</span>}{location.deliveryEnabled && <span className="status-pill status-warning">{t('locations.delivery')}</span>}</div></td>
          <td data-label={t('locations.deliveryRules')}><span className="inline-flex items-center gap-2"><Layers3 aria-hidden="true" size={16} />{(location.deliveryZones?.length || (location.deliveryRadiusKm ? 1 : 0))} · {location.deliveryRadiusKm ?? '—'} км</span></td>
          <td data-label={t('locations.hours')}><span className="inline-flex items-center gap-2"><Clock3 aria-hidden="true" size={16} />{location.hours?.daily?.open || '—'}–{location.hours?.daily?.close || '—'}</span><small className="location-meta">{t('locations.slotSummary', { minutes: location.slotMinutes || 60, capacity: location.pickupSlotCapacity || 20 })}</small></td>
          <td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="icon-button" onClick={() => openEditor(location)} aria-label={t('common.edit')}><Pencil aria-hidden="true" size={17} /></button></div></td>
        </tr>)}</tbody>
      </table></div></section>}
    </>}

    <Modal open={cityOpen} onClose={() => !citySubmitting && setCityOpen(false)} title={t('locations.newCity')} size="lg">
      <form className="modal-body form-stack" onSubmit={saveCity}>
        {cityError && <div className="inline-alert inline-alert-error" role="alert">{cityError}</div>}
        <div className="location-creation-intro"><Building2 aria-hidden="true" size={22} /><div><strong>{t('locations.cityCreateStep')}</strong><p>{t('locations.cityCreateHint')}</p></div></div>
        <div className="field-group">
          <label className="field-label" htmlFor="new-city-name">{t('locations.cityName')}</label>
          <input id="new-city-name" className="input-classic" value={cityDraft.name} onChange={event => setCityDraft(current => ({ ...current, name: event.target.value }))} autoComplete="address-level2" autoFocus required />
        </div>
        <fieldset className="form-section location-map-section">
          <legend>{t('locations.cityMapTitle')}</legend>
          <p className="page-help">{t('locations.cityMapHint')}</p>
          <YandexLocationMap
            name={cityDraft.name || t('locations.newCity')}
            address=""
            latitude={cityDraft.pointSelected ? numeric(cityDraft.latitude) : null}
            longitude={cityDraft.pointSelected ? numeric(cityDraft.longitude) : null}
            zoom={5}
            zones={[]}
            title={t('locations.cityMapTitle')}
            onPointChange={selectCityPoint}
          />
          <div className={`location-map-selection ${cityDraft.pointSelected ? 'is-selected' : ''}`} role="status">
            <MapPin aria-hidden="true" size={18} />
            <span>{cityDraft.pointSelected ? t('locations.mapPointSelected') : t('locations.mapPointRequired')}</span>
          </div>
          <div className="form-grid form-grid-2 location-coordinate-grid">
            <div className="field-group"><label className="field-label" htmlFor="new-city-latitude">{t('locations.latitude')}</label><input id="new-city-latitude" type="number" step="0.0000001" className="input-classic" value={cityDraft.latitude} onChange={event => setCityDraft(current => ({ ...current, latitude: event.target.value, pointSelected: Boolean(event.target.value && current.longitude) }))} required /></div>
            <div className="field-group"><label className="field-label" htmlFor="new-city-longitude">{t('locations.longitude')}</label><input id="new-city-longitude" type="number" step="0.0000001" className="input-classic" value={cityDraft.longitude} onChange={event => setCityDraft(current => ({ ...current, longitude: event.target.value, pointSelected: Boolean(current.latitude && event.target.value) }))} required /></div>
          </div>
        </fieldset>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setCityOpen(false)} disabled={citySubmitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={citySubmitting}>{citySubmitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}{citySubmitting ? t('common.saving') : t('locations.createCity')}</button></div>
      </form>
    </Modal>

    <Modal open={pointOpen} onClose={() => !pointSubmitting && setPointOpen(false)} title={t('locations.newPoint')} size="xl">
      <form className="modal-body form-stack" onSubmit={savePoint}>
        {pointError && <div className="inline-alert inline-alert-error" role="alert">{pointError}</div>}
        <div className="location-creation-intro"><MapPin aria-hidden="true" size={22} /><div><strong>{t('locations.pointCreateStep')}</strong><p>{t('locations.pointCreateHint')}</p></div></div>
        <div className="form-grid form-grid-2">
          <div className="field-group">
            <label className="field-label" htmlFor="new-point-city">{t('locations.cityName')}</label>
            <select id="new-point-city" className="input-classic" value={pointDraft.cityId} onChange={event => setPointDraft(current => ({ ...current, cityId: event.target.value, latitude: '', longitude: '', pointSelected: false }))} required>
              {cities.map(city => <option key={city.id} value={city.id}>{city.name}</option>)}
            </select>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="new-point-name">{t('locations.pointName')}</label>
            <input id="new-point-name" className="input-classic" value={pointDraft.name} onChange={event => setPointDraft(current => ({ ...current, name: event.target.value }))} autoComplete="organization" required />
          </div>
          <div className="field-group location-form-wide">
            <label className="field-label" htmlFor="new-point-address">{t('locations.exactAddress')}</label>
            <input id="new-point-address" className="input-classic" value={pointDraft.address} onChange={event => setPointDraft(current => ({ ...current, address: event.target.value }))} autoComplete="street-address" required />
          </div>
        </div>
        <fieldset className="form-section location-map-section">
          <legend>{t('locations.mapManagement')}</legend>
          <p className="page-help">{t('locations.pointMapHint', { city: pointCity?.name || '' })}</p>
          <YandexLocationMap
            name={pointDraft.name || t('locations.newPoint')}
            address={pointDraft.address}
            latitude={pointDraft.pointSelected ? numeric(pointDraft.latitude) : null}
            longitude={pointDraft.pointSelected ? numeric(pointDraft.longitude) : null}
            centerLatitude={pointCity?.latitude}
            centerLongitude={pointCity?.longitude}
            zoom={12}
            zones={[]}
            title={t('locations.mapManagement')}
            onPointChange={selectBranchPoint}
          />
          <div className={`location-map-selection ${pointDraft.pointSelected ? 'is-selected' : ''}`} role="status">
            <MapPin aria-hidden="true" size={18} />
            <span>{pointDraft.pointSelected ? t('locations.mapPointSelected') : t('locations.mapPointRequired')}</span>
          </div>
          <div className="form-grid form-grid-2 location-coordinate-grid">
            <div className="field-group"><label className="field-label" htmlFor="new-point-latitude">{t('locations.latitude')}</label><input id="new-point-latitude" type="number" step="0.0000001" className="input-classic" value={pointDraft.latitude} onChange={event => setPointDraft(current => ({ ...current, latitude: event.target.value, pointSelected: Boolean(event.target.value && current.longitude) }))} required /></div>
            <div className="field-group"><label className="field-label" htmlFor="new-point-longitude">{t('locations.longitude')}</label><input id="new-point-longitude" type="number" step="0.0000001" className="input-classic" value={pointDraft.longitude} onChange={event => setPointDraft(current => ({ ...current, longitude: event.target.value, pointSelected: Boolean(current.latitude && event.target.value) }))} required /></div>
          </div>
        </fieldset>
        <fieldset className="form-section"><legend>{t('locations.availability')}</legend><div className="form-grid form-grid-2">
          {([['active','common.active'],['pickupEnabled','locations.pickup'],['preorderEnabled','locations.preorder'],['deliveryEnabled','locations.delivery']] as const).map(([key,label]) => <label className="switch-row" key={key}><input type="checkbox" checked={pointDraft[key]} onChange={event => setPointDraft(current => ({ ...current, [key]: event.target.checked }))} /><span className="switch-control" aria-hidden="true" /><span>{t(label)}</span></label>)}
        </div>{pointDraft.deliveryEnabled && <p className="page-help location-default-zone-hint">{t('locations.defaultZoneHint')}</p>}</fieldset>
        <fieldset className="form-section"><legend>{t('locations.hours')}</legend><div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor="new-point-open">{t('locations.opensAt')}</label><input id="new-point-open" className="input-classic" inputMode="numeric" value={pointDraft.open} onChange={event => setPointDraft(current => ({ ...current, open: event.target.value }))} placeholder="08:00" required /></div><div className="field-group"><label className="field-label" htmlFor="new-point-close">{t('locations.closesAt')}</label><input id="new-point-close" className="input-classic" inputMode="numeric" value={pointDraft.close} onChange={event => setPointDraft(current => ({ ...current, close: event.target.value }))} placeholder="21:00" required /></div></div></fieldset>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setPointOpen(false)} disabled={pointSubmitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={pointSubmitting}>{pointSubmitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}{pointSubmitting ? t('common.saving') : t('locations.createPoint')}</button></div>
      </form>
    </Modal>

    <Modal open={bulkOpen} onClose={() => !bulkSubmitting && setBulkOpen(false)} title={t('locations.commonZones')} size="lg">
      <form className="modal-body form-stack" onSubmit={saveBulk}>
        {bulkError && <div className="inline-alert inline-alert-error" role="alert">{bulkError}</div>}
        <div className="bulk-zone-scope"><Layers3 aria-hidden="true" size={22} /><div><strong>{t('locations.activeBranchesCount', { count: activeLocations.length })}</strong><p>{t('locations.bulkOverwriteHint')}</p></div></div>
        <fieldset className="form-section"><legend>{t('locations.deliveryZones')}</legend><DeliveryZonesEditor zones={bulkZones} idPrefix="bulk-zone" t={t} onUpdate={updateBulkZone} onAdd={() => setBulkZones(current => appendZone(current))} onRemove={removeBulkZone} /></fieldset>
        <label className="switch-row bulk-delivery-switch"><input type="checkbox" checked={bulkEnableDelivery} onChange={event => setBulkEnableDelivery(event.target.checked)} /><span className="switch-control" aria-hidden="true" /><span><strong>{t('locations.bulkEnableDelivery')}</strong><small>{t('locations.bulkEnableDeliveryHint')}</small></span></label>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setBulkOpen(false)} disabled={bulkSubmitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={bulkSubmitting || activeLocations.length === 0}>{bulkSubmitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}{bulkSubmitting ? t('common.saving') : t('locations.bulkApply', { count: activeLocations.length })}</button></div>
      </form>
    </Modal>

    <Modal open={Boolean(editing)} onClose={() => !submitting && setEditing(null)} title={editing ? `${t('locations.settings')}: ${editing.name}` : t('locations.settings')} size="xl">
      <form className="modal-body form-stack" onSubmit={save}>
        {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
        {editing && <>
          <div className="location-summary"><MapPin aria-hidden="true" size={20} /><div><strong>{editing.address}</strong><small>{editing.city} · {draft.latitude}, {draft.longitude}</small></div></div>
          <fieldset className="form-section location-map-section"><legend>{t('locations.mapManagement')}</legend><p className="page-help">{t('locations.mapManagementHint')}</p>
            <YandexLocationMap name={editing.name} address={editing.address} latitude={numeric(draft.latitude)} longitude={numeric(draft.longitude)} zones={previewZones} onPointChange={(latitude, longitude) => setDraft(current => ({ ...current, latitude: latitude.toFixed(7), longitude: longitude.toFixed(7) }))} />
            <div className="form-grid form-grid-2 location-coordinate-grid"><div className="field-group"><label className="field-label" htmlFor="location-latitude">{t('locations.latitude')}</label><input id="location-latitude" type="number" step="0.0000001" className="input-classic" value={draft.latitude} onChange={event => setDraft(current => ({ ...current, latitude: event.target.value }))} required /></div><div className="field-group"><label className="field-label" htmlFor="location-longitude">{t('locations.longitude')}</label><input id="location-longitude" type="number" step="0.0000001" className="input-classic" value={draft.longitude} onChange={event => setDraft(current => ({ ...current, longitude: event.target.value }))} required /></div></div>
          </fieldset>
        </>}
        <fieldset className="form-section"><legend>{t('locations.availability')}</legend><div className="form-grid form-grid-2">
          {([['active','common.active'],['pickupEnabled','locations.pickup'],['preorderEnabled','locations.preorder'],['deliveryEnabled','locations.delivery']] as const).map(([key,label]) => <label className="switch-row" key={key}><input type="checkbox" checked={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked }))} /><span className="switch-control" aria-hidden="true" /><span>{t(label)}</span></label>)}
        </div></fieldset>
        <fieldset className="form-section"><legend>{t('locations.hours')}</legend><div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor="location-open">{t('locations.opensAt')}</label><input id="location-open" className="input-classic" inputMode="numeric" value={draft.open} onChange={event => setDraft(current => ({ ...current, open: event.target.value }))} placeholder="08:00" required /></div><div className="field-group"><label className="field-label" htmlFor="location-close">{t('locations.closesAt')}</label><input id="location-close" className="input-classic" inputMode="numeric" value={draft.close} onChange={event => setDraft(current => ({ ...current, close: event.target.value }))} placeholder="21:00" required /></div></div></fieldset>
        <fieldset className="form-section"><legend>{t('locations.slotCapacity')}</legend><p className="page-help">{t('locations.slotCapacityHint')}</p><div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor="slot-minutes">{t('locations.slotMinutes')}</label><input id="slot-minutes" type="number" min="15" max="240" step="15" className="input-classic" value={draft.slotMinutes} onChange={event => setDraft(current => ({ ...current, slotMinutes: event.target.value }))} required /></div>{([['pickupSlotCapacity','locations.pickupCapacity'],['preorderSlotCapacity','locations.preorderCapacity'],['deliverySlotCapacity','locations.deliveryCapacity']] as const).map(([key, label]) => <div className="field-group" key={key}><label className="field-label" htmlFor={key}>{t(label)}</label><input id={key} type="number" min="1" max="500" step="1" className="input-classic" value={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.value }))} required /></div>)}</div></fieldset>
        <fieldset className="form-section"><legend>{t('locations.deliveryZones')}</legend><DeliveryZonesEditor zones={draft.deliveryZones} idPrefix="branch-zone" t={t} onUpdate={updateZone} onAdd={addZone} onRemove={removeZone} /></fieldset>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setEditing(null)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>
  </div>;
}

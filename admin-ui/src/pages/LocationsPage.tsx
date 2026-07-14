import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Clock3, Layers3, LoaderCircle, MapPin, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import YandexLocationMap, { type DeliveryMapZone } from '../components/YandexLocationMap';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

type Hours = Record<string, unknown> & { daily?: { open?: string; close?: string } };

type FulfillmentLocation = {
  id: string;
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
};

type ZoneDraft = { id: string; radiusKm: string; fee: string; minOrder: string; color: string };
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
};

const zoneColors = ['#66BB6A', '#29B6F6', '#FFD54F', '#EC407A', '#7E57C2', '#FF8A65'];
const defaultZone = (): ZoneDraft => ({ id: `zone-${Date.now()}`, radiusKm: '5', fee: '700', minOrder: '3000', color: zoneColors[0] });
const emptyDraft: Draft = {
  active: true, pickupEnabled: true, preorderEnabled: true, deliveryEnabled: false,
  latitude: '', longitude: '', deliveryZones: [defaultZone()], open: '08:00', close: '21:00',
};

const validClock = (value: string) => /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(value);
const clockMinutes = (value: string) => { const [hours, minutes] = value.split(':').map(Number); return hours * 60 + minutes; };
const numeric = (value: string) => value.trim() === '' ? Number.NaN : Number(value);

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

export default function LocationsPage() {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [locations, setLocations] = useState<FulfillmentLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<FulfillmentLocation | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const result = await api.getFulfillmentLocations();
      setLocations(result.locations ?? []);
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally { if (!silent) setLoading(false); }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void load(true); }, 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

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
    });
    setFormError('');
  };

  const previewZones = useMemo<DeliveryMapZone[]>(() => draft.deliveryZones.map((zone) => ({
    id: zone.id, radiusKm: numeric(zone.radiusKm), fee: numeric(zone.fee), minOrder: numeric(zone.minOrder), color: zone.color,
  })).filter((zone) => Number.isFinite(zone.radiusKm) && zone.radiusKm > 0), [draft.deliveryZones]);

  const updateZone = (id: string, patch: Partial<ZoneDraft>) => setDraft(current => ({
    ...current,
    deliveryZones: current.deliveryZones.map(zone => zone.id === id ? { ...zone, ...patch } : zone),
  }));

  const addZone = () => setDraft(current => {
    const last = current.deliveryZones[current.deliveryZones.length - 1];
    const nextRadius = Number.isFinite(numeric(last?.radiusKm || '')) ? numeric(last.radiusKm) + 2 : 5;
    const nextFee = Number.isFinite(numeric(last?.fee || '')) ? numeric(last.fee) + 300 : 700;
    return { ...current, deliveryZones: [...current.deliveryZones, {
      id: `zone-${Date.now()}`, radiusKm: String(nextRadius), fee: String(nextFee),
      minOrder: last?.minOrder || '3000', color: zoneColors[current.deliveryZones.length % zoneColors.length],
    }] };
  });

  const removeZone = (id: string) => setDraft(current => ({
    ...current,
    deliveryZones: current.deliveryZones.length > 1 ? current.deliveryZones.filter(zone => zone.id !== id) : current.deliveryZones,
  }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || submitting) return;
    const latitude = numeric(draft.latitude);
    const longitude = numeric(draft.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      setFormError(t('locations.coordinatesInvalid')); return;
    }
    const zones = draft.deliveryZones.map((zone) => ({
      id: zone.id, radiusKm: numeric(zone.radiusKm), fee: numeric(zone.fee), minOrder: numeric(zone.minOrder), color: zone.color,
    })).sort((first, second) => first.radiusKm - second.radiusKm);
    const invalidZone = zones.some(zone => !Number.isFinite(zone.radiusKm) || zone.radiusKm <= 0 || zone.radiusKm > 100 || !Number.isSafeInteger(zone.fee) || zone.fee < 0 || !Number.isSafeInteger(zone.minOrder) || zone.minOrder < 0 || !/^#[0-9a-f]{6}$/i.test(zone.color));
    const duplicateRadius = new Set(zones.map(zone => zone.radiusKm.toFixed(3))).size !== zones.length;
    if (invalidZone || duplicateRadius || zones.length === 0 || zones.length > 8) {
      setFormError(t('locations.deliveryValuesInvalid')); return;
    }
    if (!validClock(draft.open) || !validClock(draft.close) || clockMinutes(draft.open) >= clockMinutes(draft.close)) {
      setFormError(t('locations.hoursInvalid')); return;
    }
    setSubmitting(true); setFormError('');
    try {
      const outer = zones[zones.length - 1];
      const result = await api.updateFulfillmentLocation(editing.id, {
        active: draft.active, pickupEnabled: draft.pickupEnabled, preorderEnabled: draft.preorderEnabled,
        deliveryEnabled: draft.deliveryEnabled, latitude, longitude, deliveryZones: zones,
        deliveryRadiusKm: outer.radiusKm, deliveryFee: outer.fee, deliveryMinOrder: outer.minOrder,
        hours: { ...(editing.hours ?? {}), daily: { open: draft.open, close: draft.close } },
      });
      setLocations(current => current.map(item => item.id === editing.id ? result.location : item));
      setEditing(null); toast(t('locations.saved'));
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : t('common.error')); }
    finally { setSubmitting(false); }
  };

  if (loading && locations.length === 0) return <PageState type="loading" />;
  if (error && locations.length === 0) return <PageState type="error" description={error} onRetry={() => load()} />;

  return <div className="page-stack">
    <div className="page-actions-row">
      <div><h2 className="content-heading">{t('locations.heading')}</h2><p className="page-help">{t('locations.fulfillmentIntro')}</p></div>
      <button type="button" className="btn-outline px-5 inline-flex items-center gap-2" onClick={() => load()} disabled={loading}><RefreshCw aria-hidden="true" size={17} />{t('common.refresh')}</button>
    </div>
    {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
    {locations.length === 0 ? <PageState type="empty" title={t('locations.empty')} description={t('locations.syncHint')} /> :
      <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table locations-table">
        <thead><tr><th>{t('locations.cityBranch')}</th><th>{t('locations.address')}</th><th>{t('locations.services')}</th><th>{t('locations.deliveryRules')}</th><th>{t('locations.hours')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
        <tbody>{locations.map(location => <tr key={location.id}>
          <td data-label={t('locations.cityBranch')}><div className="location-name"><MapPin aria-hidden="true" size={18} /><div><strong>{location.name}</strong><small className="location-meta">{location.city}</small></div></div></td>
          <td data-label={t('locations.address')}>{location.address}<small className="location-meta">{location.latitude != null && location.longitude != null ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : '—'}</small></td>
          <td data-label={t('locations.services')}><div className="location-statuses"><span className={`status-pill ${location.active ? 'status-active' : 'status-inactive'}`}>{location.active ? t('common.active') : t('common.inactive')}</span>{location.pickupEnabled && <span className="status-pill status-info">{t('locations.pickup')}</span>}{location.preorderEnabled && <span className="status-pill status-info">{t('locations.preorder')}</span>}{location.deliveryEnabled && <span className="status-pill status-warning">{t('locations.delivery')}</span>}</div></td>
          <td data-label={t('locations.deliveryRules')}><span className="inline-flex items-center gap-2"><Layers3 aria-hidden="true" size={16} />{(location.deliveryZones?.length || (location.deliveryRadiusKm ? 1 : 0))} · {location.deliveryRadiusKm ?? '—'} км</span></td>
          <td data-label={t('locations.hours')}><span className="inline-flex items-center gap-2"><Clock3 aria-hidden="true" size={16} />{location.hours?.daily?.open || '—'}–{location.hours?.daily?.close || '—'}</span></td>
          <td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="icon-button" onClick={() => openEditor(location)} aria-label={t('common.edit')}><Pencil aria-hidden="true" size={17} /></button></div></td>
        </tr>)}</tbody>
      </table></div></section>}

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
        <fieldset className="form-section"><legend>{t('locations.deliveryZones')}</legend><div className="zone-editor-heading"><p className="page-help">{t('locations.deliveryZonesHint')}</p><button type="button" className="btn-outline compact-button" onClick={addZone} disabled={draft.deliveryZones.length >= 8}><Plus aria-hidden="true" size={16} />{t('locations.addZone')}</button></div>
          <div className="delivery-zone-list">{draft.deliveryZones.map((zone, index) => <div className="delivery-zone-card" key={zone.id} style={{ '--zone-color': zone.color } as CSSProperties}>
            <div className="delivery-zone-number"><span>{index + 1}</span><strong>{t('locations.zone')} {index + 1}</strong></div>
            <div className="delivery-zone-fields"><div className="field-group"><label className="field-label" htmlFor={`zone-radius-${zone.id}`}>{t('locations.deliveryRadius')}</label><input id={`zone-radius-${zone.id}`} type="number" min="0.1" max="100" step="0.1" className="input-classic" value={zone.radiusKm} onChange={event => updateZone(zone.id, { radiusKm: event.target.value })} required /></div><div className="field-group"><label className="field-label" htmlFor={`zone-fee-${zone.id}`}>{t('locations.deliveryFee')}</label><input id={`zone-fee-${zone.id}`} type="number" min="0" max="100000" step="1" className="input-classic" value={zone.fee} onChange={event => updateZone(zone.id, { fee: event.target.value })} required /></div><div className="field-group"><label className="field-label" htmlFor={`zone-min-${zone.id}`}>{t('locations.deliveryMinimum')}</label><input id={`zone-min-${zone.id}`} type="number" min="0" max="10000000" step="1" className="input-classic" value={zone.minOrder} onChange={event => updateZone(zone.id, { minOrder: event.target.value })} required /></div><div className="field-group zone-color-field"><label className="field-label" htmlFor={`zone-color-${zone.id}`}>{t('locations.zoneColor')}</label><input id={`zone-color-${zone.id}`} type="color" value={zone.color} onChange={event => updateZone(zone.id, { color: event.target.value.toUpperCase() })} /></div></div>
            <button type="button" className="icon-button icon-button-danger" onClick={() => removeZone(zone.id)} disabled={draft.deliveryZones.length === 1} aria-label={t('locations.removeZone')}><Trash2 aria-hidden="true" size={18} /></button>
          </div>)}</div>
        </fieldset>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setEditing(null)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>
  </div>;
}

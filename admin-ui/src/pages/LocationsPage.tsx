import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Clock3, LoaderCircle, MapPin, Pencil, RefreshCw } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
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
};

type Draft = {
  active: boolean;
  pickupEnabled: boolean;
  preorderEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryRadiusKm: string;
  deliveryFee: string;
  deliveryMinOrder: string;
  open: string;
  close: string;
};

const emptyDraft: Draft = {
  active: true,
  pickupEnabled: true,
  preorderEnabled: true,
  deliveryEnabled: false,
  deliveryRadiusKm: '',
  deliveryFee: '',
  deliveryMinOrder: '',
  open: '08:00',
  close: '21:00',
};

const optionalNumber = (value: string) => value.trim() === '' ? null : Number(value);
const validClock = (value: string) => /^(?:(?:[01]\d|2[0-3]):[0-5]\d|24:00)$/.test(value);
const clockMinutes = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
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
    } finally {
      if (!silent) setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 30_000);
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
      deliveryRadiusKm: location.deliveryRadiusKm == null ? '' : String(location.deliveryRadiusKm),
      deliveryFee: location.deliveryFee == null ? '' : String(location.deliveryFee),
      deliveryMinOrder: location.deliveryMinOrder == null ? '' : String(location.deliveryMinOrder),
      open: daily?.open || '08:00',
      close: daily?.close || '21:00',
    });
    setFormError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!editing || submitting) return;
    const radius = optionalNumber(draft.deliveryRadiusKm);
    const fee = optionalNumber(draft.deliveryFee);
    const minimum = optionalNumber(draft.deliveryMinOrder);
    if ([radius, fee, minimum].some(value => value != null && (!Number.isFinite(value) || value < 0))) {
      setFormError(t('locations.deliveryValuesInvalid'));
      return;
    }
    if (draft.deliveryEnabled && (radius == null || radius <= 0 || fee == null || minimum == null)) {
      setFormError(t('locations.deliveryRulesRequired'));
      return;
    }
    if (!validClock(draft.open) || !validClock(draft.close) || clockMinutes(draft.open) >= clockMinutes(draft.close)) {
      setFormError(t('locations.hoursInvalid'));
      return;
    }
    setSubmitting(true);
    setFormError('');
    try {
      const result = await api.updateFulfillmentLocation(editing.id, {
        active: draft.active,
        pickupEnabled: draft.pickupEnabled,
        preorderEnabled: draft.preorderEnabled,
        deliveryEnabled: draft.deliveryEnabled,
        deliveryRadiusKm: radius,
        deliveryFee: fee,
        deliveryMinOrder: minimum,
        hours: { ...(editing.hours ?? {}), daily: { open: draft.open, close: draft.close } },
      });
      setLocations(current => current.map(item => item.id === editing.id ? result.location : item));
      setEditing(null);
      toast(t('locations.saved'));
    } catch (caught) {
      setFormError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSubmitting(false);
    }
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
        <thead><tr><th>{t('locations.cityBranch')}</th><th>{t('locations.address')}</th><th>{t('locations.services')}</th><th>{t('locations.hours')}</th><th className="text-right">{t('common.actions')}</th></tr></thead>
        <tbody>{locations.map(location => <tr key={location.id}>
          <td data-label={t('locations.cityBranch')}><div className="location-name"><MapPin aria-hidden="true" size={18} /><div><strong>{location.name}</strong><small className="location-meta">{location.city}</small></div></div></td>
          <td data-label={t('locations.address')}>{location.address}<small className="location-meta">{location.latitude != null && location.longitude != null ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}` : '—'}</small></td>
          <td data-label={t('locations.services')}><div className="location-statuses"><span className={`status-pill ${location.active ? 'status-active' : 'status-inactive'}`}>{location.active ? t('common.active') : t('common.inactive')}</span>{location.pickupEnabled && <span className="status-pill status-info">{t('locations.pickup')}</span>}{location.preorderEnabled && <span className="status-pill status-info">{t('locations.preorder')}</span>}{location.deliveryEnabled && <span className="status-pill status-warning">{t('locations.delivery')}</span>}</div></td>
          <td data-label={t('locations.hours')}><span className="inline-flex items-center gap-2"><Clock3 aria-hidden="true" size={16} />{location.hours?.daily?.open || '—'}–{location.hours?.daily?.close || '—'}</span></td>
          <td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="icon-button" onClick={() => openEditor(location)} aria-label={t('common.edit')}><Pencil aria-hidden="true" size={17} /></button></div></td>
        </tr>)}</tbody>
      </table></div></section>}

    <Modal open={Boolean(editing)} onClose={() => !submitting && setEditing(null)} title={editing ? `${t('locations.settings')}: ${editing.name}` : t('locations.settings')} size="lg">
      <form className="modal-body form-stack" onSubmit={save}>
        {formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
        {editing && <div className="location-summary"><MapPin aria-hidden="true" size={20} /><div><strong>{editing.address}</strong><small>{editing.city} · {editing.latitude}, {editing.longitude}</small></div></div>}
        <fieldset className="form-section"><legend>{t('locations.availability')}</legend><div className="form-grid form-grid-2">
          {([
            ['active', 'common.active'],
            ['pickupEnabled', 'locations.pickup'],
            ['preorderEnabled', 'locations.preorder'],
            ['deliveryEnabled', 'locations.delivery'],
          ] as const).map(([key, label]) => <label className="switch-row" key={key}><input type="checkbox" checked={draft[key]} onChange={event => setDraft(current => ({ ...current, [key]: event.target.checked }))} /><span className="switch-control" aria-hidden="true" /><span>{t(label)}</span></label>)}
        </div></fieldset>
        <fieldset className="form-section"><legend>{t('locations.hours')}</legend><div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor="location-open">{t('locations.opensAt')}</label><input id="location-open" className="input-classic" inputMode="numeric" value={draft.open} onChange={event => setDraft(current => ({ ...current, open: event.target.value }))} placeholder="08:00" required /></div><div className="field-group"><label className="field-label" htmlFor="location-close">{t('locations.closesAt')}</label><input id="location-close" className="input-classic" inputMode="numeric" value={draft.close} onChange={event => setDraft(current => ({ ...current, close: event.target.value }))} placeholder="21:00" required /></div></div></fieldset>
        <fieldset className="form-section"><legend>{t('locations.deliveryRules')}</legend><p className="page-help">{t('locations.deliveryRulesHint')}</p><div className="form-grid form-grid-3"><div className="field-group"><label className="field-label" htmlFor="delivery-radius">{t('locations.deliveryRadius')}</label><input id="delivery-radius" type="number" min="0" max="100" step="0.1" className="input-classic" value={draft.deliveryRadiusKm} onChange={event => setDraft(current => ({ ...current, deliveryRadiusKm: event.target.value }))} /></div><div className="field-group"><label className="field-label" htmlFor="delivery-fee">{t('locations.deliveryFee')}</label><input id="delivery-fee" type="number" min="0" max="100000" step="1" className="input-classic" value={draft.deliveryFee} onChange={event => setDraft(current => ({ ...current, deliveryFee: event.target.value }))} /></div><div className="field-group"><label className="field-label" htmlFor="delivery-minimum">{t('locations.deliveryMinimum')}</label><input id="delivery-minimum" type="number" min="0" max="10000000" step="1" className="input-classic" value={draft.deliveryMinOrder} onChange={event => setDraft(current => ({ ...current, deliveryMinOrder: event.target.value }))} /></div></div></fieldset>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setEditing(null)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle aria-hidden="true" className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>
  </div>;
}

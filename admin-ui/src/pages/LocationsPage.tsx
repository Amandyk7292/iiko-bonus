import { Fragment, useCallback, useEffect, useState, type FormEvent } from 'react';
import { Building2, Languages, LoaderCircle, MapPin, Pencil, Plus, Trash2 } from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { contentLanguage, useI18n } from '../lib/i18n';

type ContentLanguage = 'ru' | 'kz' | 'en';
type CityTranslations = Record<ContentLanguage, { name: string }>;
type PointTranslations = Record<ContentLanguage, { name: string; address: string }>;
const languages: ContentLanguage[] = ['ru', 'kz', 'en'];
const localeKey = (language: ContentLanguage) => language === 'kz' ? 'kk' : language;
const blankCities = (): CityTranslations => ({ ru: { name: '' }, kz: { name: '' }, en: { name: '' } });
const blankPoints = (): PointTranslations => ({ ru: { name: '', address: '' }, kz: { name: '', address: '' }, en: { name: '', address: '' } });

export default function LocationsPage() {
  const { locale, t } = useI18n();
  const { toast, confirm } = useFeedback();
  const [cities, setCities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeLanguage, setActiveLanguage] = useState<ContentLanguage>('ru');
  const [cityOpen, setCityOpen] = useState(false);
  const [editingCity, setEditingCity] = useState<any | null>(null);
  const [cityI18n, setCityI18n] = useState<CityTranslations>(blankCities);
  const [pointOpen, setPointOpen] = useState(false);
  const [editingPoint, setEditingPoint] = useState<any | null>(null);
  const [targetCityId, setTargetCityId] = useState('');
  const [pointI18n, setPointI18n] = useState<PointTranslations>(blankPoints);
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [translating, setTranslating] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const fetchCities = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getCities();
      setCities(data.cities ?? []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally { setLoading(false); }
  }, [t]);
  useEffect(() => { void fetchCities(); }, [fetchCities]);

  const translateText = async (text: string, to: 'kk' | 'en') => {
    if (!text.trim()) return '';
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text.trim())}&langpair=ru|${to}`);
    if (!response.ok) throw new Error(t('locations.translationError'));
    const data = await response.json();
    return String(data?.responseData?.translatedText || text);
  };

  const openCity = (city?: any) => {
    const i18n = city?.i18n ?? {};
    setEditingCity(city ?? null);
    setCityI18n({ ru: { name: i18n.ru?.name || city?.name || '' }, kz: { name: i18n.kz?.name || '' }, en: { name: i18n.en?.name || '' } });
    setActiveLanguage('ru'); setFormError(''); setCityOpen(true);
  };

  const openPoint = (cityId: string, point?: any) => {
    const i18n = point?.i18n ?? {};
    setTargetCityId(cityId); setEditingPoint(point ?? null);
    setPointI18n({
      ru: { name: i18n.ru?.name || point?.name || '', address: i18n.ru?.address || point?.address || '' },
      kz: { name: i18n.kz?.name || '', address: i18n.kz?.address || '' },
      en: { name: i18n.en?.name || '', address: i18n.en?.address || '' },
    });
    setLatitude(point?.latitude == null ? '' : String(point.latitude)); setLongitude(point?.longitude == null ? '' : String(point.longitude));
    setActiveLanguage('ru'); setFormError(''); setPointOpen(true);
  };

  const translateCity = async () => {
    if (!cityI18n.ru.name.trim()) return;
    setTranslating(true); setFormError('');
    try {
      const [kk, en] = await Promise.all([translateText(cityI18n.ru.name, 'kk'), translateText(cityI18n.ru.name, 'en')]);
      setCityI18n(current => ({ ...current, kz: { name: kk }, en: { name: en } }));
    } catch { setFormError(t('locations.translationError')); }
    finally { setTranslating(false); }
  };

  const translatePoint = async () => {
    if (!pointI18n.ru.name.trim() || !pointI18n.ru.address.trim()) return;
    setTranslating(true); setFormError('');
    try {
      const [kkName, enName, kkAddress, enAddress] = await Promise.all([
        translateText(pointI18n.ru.name, 'kk'), translateText(pointI18n.ru.name, 'en'), translateText(pointI18n.ru.address, 'kk'), translateText(pointI18n.ru.address, 'en'),
      ]);
      setPointI18n(current => ({ ...current, kz: { name: kkName, address: kkAddress }, en: { name: enName, address: enAddress } }));
    } catch { setFormError(t('locations.translationError')); }
    finally { setTranslating(false); }
  };

  const saveCity = async (event: FormEvent) => {
    event.preventDefault();
    if (languages.some(language => !cityI18n[language].name.trim())) { setFormError(t('locations.allLanguagesValidation')); return; }
    setSubmitting(true); setFormError('');
    try {
      const payload = { name: cityI18n.ru.name.trim(), i18n: cityI18n };
      if (editingCity) await api.updateCity(editingCity.id, payload); else await api.addCity(payload);
      setCityOpen(false); toast(t('locations.saved')); await fetchCities();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : t('common.error')); }
    finally { setSubmitting(false); }
  };

  const savePoint = async (event: FormEvent) => {
    event.preventDefault();
    if (languages.some(language => !pointI18n[language].name.trim() || !pointI18n[language].address.trim())) { setFormError(t('locations.allLanguagesValidation')); return; }
    setSubmitting(true); setFormError('');
    try {
      const payload = {
        name: pointI18n.ru.name.trim(), address: pointI18n.ru.address.trim(),
        latitude: latitude === '' ? undefined : Number(latitude), longitude: longitude === '' ? undefined : Number(longitude), i18n: pointI18n,
      };
      if (editingPoint) await api.updatePoint(editingPoint.id, payload); else await api.addPoint(targetCityId, payload);
      setPointOpen(false); toast(t('locations.saved')); await fetchCities();
    } catch (caught) { setFormError(caught instanceof Error ? caught.message : t('common.error')); }
    finally { setSubmitting(false); }
  };

  const deleteCity = async (city: any) => {
    if (!await confirm({ title: t('locations.deleteCityTitle'), body: t('locations.deleteCityBody'), confirmLabel: t('common.delete'), destructive: true })) return;
    setBusyId(city.id);
    try { await api.deleteCity(city.id); setCities(current => current.filter(item => item.id !== city.id)); toast(t('common.deleted')); }
    catch (caught) { toast(caught instanceof Error ? caught.message : t('common.error'), 'error'); }
    finally { setBusyId(null); }
  };

  const deletePoint = async (point: any) => {
    if (!await confirm({ title: t('locations.deletePointTitle'), body: t('locations.deletePointBody'), confirmLabel: t('common.delete'), destructive: true })) return;
    setBusyId(point.id);
    try { await api.deletePoint(point.id); await fetchCities(); toast(t('common.deleted')); }
    catch (caught) { toast(caught instanceof Error ? caught.message : t('common.error'), 'error'); }
    finally { setBusyId(null); }
  };

  const tabs = (completed: (language: ContentLanguage) => boolean) => <div className="language-tabs" role="tablist" aria-label={t('language.label')}>{languages.map(language => <button key={language} type="button" role="tab" aria-selected={activeLanguage === language} className={activeLanguage === language ? 'language-tab language-tab-active' : 'language-tab'} onClick={() => setActiveLanguage(language)}>{t(`language.${localeKey(language)}`)}{completed(language) && <span className="tab-complete" aria-hidden="true" />}</button>)}</div>;
  const displayKey = contentLanguage(locale);

  if (loading && cities.length === 0) return <PageState type="loading" />;
  if (error && cities.length === 0) return <PageState type="error" description={error} onRetry={fetchCities} />;

  return <div className="page-stack">
    <div className="page-actions-row"><div><h2 className="content-heading">{t('locations.heading')}</h2><p className="page-help">{t('locations.intro')}</p></div><button type="button" className="btn-classic px-5 inline-flex items-center gap-2" onClick={() => openCity()}><Plus aria-hidden="true" size={18} />{t('locations.addCity')}</button></div>
    {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}
    {cities.length === 0 ? <PageState type="empty" title={t('locations.empty')} description={t('locations.emptyHint')} action={<button type="button" className="btn-classic px-5" onClick={() => openCity()}>{t('locations.addCity')}</button>} /> : (
      <section className="card table-card"><div className="responsive-table-wrap"><table className="data-table locations-table"><thead><tr><th>{t('locations.cityBranch')}</th><th>{t('locations.address')}</th><th className="text-right">{t('common.actions')}</th></tr></thead><tbody>{cities.map(city => <Fragment key={city.id}>
        <tr className="city-row"><td data-label={t('locations.cityBranch')}><div className="location-name"><Building2 aria-hidden="true" size={18} /><strong>{city.i18n?.[displayKey]?.name || city.i18n?.ru?.name || city.name}</strong></div></td><td data-label={t('locations.address')}>—</td><td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="btn-outline compact-button inline-flex items-center gap-1" onClick={() => openPoint(city.id)}><Plus size={15} />{t('locations.addPoint')}</button><button type="button" className="icon-button" onClick={() => openCity(city)} aria-label={t('common.edit')}><Pencil size={17} /></button><button type="button" className="icon-button icon-button-danger" onClick={() => deleteCity(city)} disabled={Boolean(busyId)} aria-label={t('common.delete')}>{busyId === city.id ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}</button></div></td></tr>
        {!Array.isArray(city.points) || city.points.length === 0 ? <tr><td colSpan={3}><div className="nested-empty">{t('locations.noPoints')}</div></td></tr> : city.points.map((point: any) => <tr key={point.id}><td data-label={t('locations.cityBranch')}><div className="location-name location-point"><MapPin aria-hidden="true" size={16} /><span>{point.i18n?.[displayKey]?.name || point.i18n?.ru?.name || point.name}</span></div></td><td data-label={t('locations.address')}>{point.i18n?.[displayKey]?.address || point.i18n?.ru?.address || point.address}</td><td data-label={t('common.actions')}><div className="row-actions justify-end"><button type="button" className="icon-button" onClick={() => openPoint(city.id, point)} aria-label={t('common.edit')}><Pencil size={17} /></button><button type="button" className="icon-button icon-button-danger" onClick={() => deletePoint(point)} disabled={Boolean(busyId)} aria-label={t('common.delete')}>{busyId === point.id ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />}</button></div></td></tr>)}
      </Fragment>)}</tbody></table></div></section>
    )}

    <Modal open={cityOpen} onClose={() => !submitting && setCityOpen(false)} title={editingCity ? t('locations.editCity') : t('locations.newCity')} size="md">
      <form className="modal-body form-stack" onSubmit={saveCity}>{formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
        <div className="tabs-with-action">{tabs(language => Boolean(cityI18n[language].name.trim()))}<button type="button" className="btn-outline compact-button inline-flex items-center gap-2" onClick={translateCity} disabled={translating || !cityI18n.ru.name.trim()}><Languages size={16} />{translating ? t('locations.translating') : t('locations.translate')}</button></div>
        <div className="field-group"><label className="field-label" htmlFor={`city-name-${activeLanguage}`}>{t('locations.cityName')} ({t(`content.${localeKey(activeLanguage)}`)}) *</label><input id={`city-name-${activeLanguage}`} className="input-classic" value={cityI18n[activeLanguage].name} onChange={event => setCityI18n(current => ({ ...current, [activeLanguage]: { name: event.target.value } }))} required /></div>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setCityOpen(false)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>

    <Modal open={pointOpen} onClose={() => !submitting && setPointOpen(false)} title={editingPoint ? t('locations.editPoint') : t('locations.newPoint')} size="lg">
      <form className="modal-body form-stack" onSubmit={savePoint}>{formError && <div className="inline-alert inline-alert-error" role="alert">{formError}</div>}
        <div className="tabs-with-action">{tabs(language => Boolean(pointI18n[language].name.trim() && pointI18n[language].address.trim()))}<button type="button" className="btn-outline compact-button inline-flex items-center gap-2" onClick={translatePoint} disabled={translating || !pointI18n.ru.name.trim() || !pointI18n.ru.address.trim()}><Languages size={16} />{translating ? t('locations.translating') : t('locations.translate')}</button></div>
        <div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor={`point-name-${activeLanguage}`}>{t('locations.pointName')} ({t(`content.${localeKey(activeLanguage)}`)}) *</label><input id={`point-name-${activeLanguage}`} className="input-classic" value={pointI18n[activeLanguage].name} onChange={event => setPointI18n(current => ({ ...current, [activeLanguage]: { ...current[activeLanguage], name: event.target.value } }))} required /></div><div className="field-group"><label className="field-label" htmlFor={`point-address-${activeLanguage}`}>{t('locations.exactAddress')} ({t(`content.${localeKey(activeLanguage)}`)}) *</label><input id={`point-address-${activeLanguage}`} className="input-classic" value={pointI18n[activeLanguage].address} onChange={event => setPointI18n(current => ({ ...current, [activeLanguage]: { ...current[activeLanguage], address: event.target.value } }))} required /></div></div>
        <div className="form-grid form-grid-2"><div className="field-group"><label className="field-label" htmlFor="point-latitude">{t('locations.latitude')}</label><input id="point-latitude" type="number" min="-90" max="90" step="any" className="input-classic" value={latitude} onChange={event => setLatitude(event.target.value)} /></div><div className="field-group"><label className="field-label" htmlFor="point-longitude">{t('locations.longitude')}</label><input id="point-longitude" type="number" min="-180" max="180" step="any" className="input-classic" value={longitude} onChange={event => setLongitude(event.target.value)} /></div></div>
        <div className="modal-actions"><button type="button" className="btn-outline px-5" onClick={() => setPointOpen(false)} disabled={submitting}>{t('common.cancel')}</button><button type="submit" className="btn-classic px-5 inline-flex items-center gap-2" disabled={submitting}>{submitting && <LoaderCircle className="spin" size={17} />}{submitting ? t('common.saving') : t('common.save')}</button></div>
      </form>
    </Modal>
  </div>;
}

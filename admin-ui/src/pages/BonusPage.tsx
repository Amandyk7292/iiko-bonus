import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Plus, Save, Trash2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface BonusSettings {
  base_cashback_percent: number;
  max_discount_percent: number;
  bonus_expiration: { enabled: boolean; expiration_days: number; notify_before_days: number };
  bonus_promocodes: PromoCode[];
  [key: string]: unknown;
}

interface PromoCode {
  code: string;
  type: 'percent' | 'fixed';
  value: number;
  min_order: number;
  active: boolean;
}

export default function BonusPage() {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [settings, setSettings] = useState<BonusSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getSettings();
      setSettings({
        ...data,
        base_cashback_percent: Number(data.base_cashback_percent ?? 0),
        max_discount_percent: Number(data.max_discount_percent ?? 0),
        bonus_expiration: {
          enabled: Boolean(data.bonus_expiration?.enabled),
          expiration_days: Number(data.bonus_expiration?.expiration_days ?? 90),
          notify_before_days: Number(data.bonus_expiration?.notify_before_days ?? 30),
        },
        bonus_promocodes: Array.isArray(data.bonus_promocodes) ? data.bonus_promocodes : [],
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

  const updatePromo = (index: number, updates: Partial<PromoCode>) => {
    setSettings(current => current && ({
      ...current,
      bonus_promocodes: current.bonus_promocodes.map((promo, promoIndex) => promoIndex === index ? { ...promo, ...updates } : promo),
    }));
  };

  const addPromo = () => setSettings(current => current && ({
    ...current,
    bonus_promocodes: [...current.bonus_promocodes, { code: '', type: 'percent', value: 10, min_order: 0, active: true }],
  }));

  const removePromo = (index: number) => setSettings(current => current && ({
    ...current,
    bonus_promocodes: current.bonus_promocodes.filter((_, promoIndex) => promoIndex !== index),
  }));

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.updateSettings(settings);
      toast(t('bonus.saved'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageState type="loading" />;
  if (!settings) return <PageState type="error" description={error} onRetry={fetchSettings} />;

  return (
    <div className="page-stack page-narrow">
      <div className="card feature-callout">
        <div>
          <h2>{t('page.tiers.title')}</h2>
          <p>{t('page.tiers.subtitle')}</p>
        </div>
        <Link to="/tiers" className="btn-classic px-5 inline-flex items-center gap-2">
          {t('bonus.tiersCta')} <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </div>

      <form className="card settings-form" onSubmit={save}>
        <div className="section-heading">
          <div><h2>{t('bonus.heading')}</h2><p>{t('page.bonus.subtitle')}</p></div>
        </div>
        {error && <div className="inline-alert inline-alert-error" role="alert">{error}</div>}

        <div className="form-grid form-grid-2">
          <div className="field-group">
            <label className="field-label" htmlFor="base-cashback">{t('bonus.baseCashback')}</label>
            <input
              id="base-cashback"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={settings.base_cashback_percent}
              onChange={event => setSettings(current => current && ({ ...current, base_cashback_percent: Number(event.target.value) }))}
              className="input-classic"
              required
            />
            <p className="field-hint">{t('bonus.baseHint')}</p>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="max-discount">{t('bonus.maxDiscount')}</label>
            <input
              id="max-discount"
              type="number"
              min="0"
              max="100"
              step="1"
              value={settings.max_discount_percent}
              onChange={event => setSettings(current => current && ({ ...current, max_discount_percent: Number(event.target.value) }))}
              className="input-classic"
              required
            />
            <p className="field-hint">{t('bonus.maxDiscountHint')}</p>
          </div>
        </div>

        <fieldset className="form-section">
          <legend>{t('bonus.expiration')}</legend>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.bonus_expiration.enabled}
              onChange={event => setSettings(current => current && ({
                ...current,
                bonus_expiration: { ...current.bonus_expiration, enabled: event.target.checked },
              }))}
            />
            <span className="switch-control" aria-hidden="true" />
            <span>{t('bonus.expirationEnable')}</span>
          </label>

          {settings.bonus_expiration.enabled && (
            <div className="form-grid form-grid-2 reveal-panel">
              <div className="field-group">
                <label className="field-label" htmlFor="expiration-days">{t('bonus.inactiveDays')}</label>
                <input id="expiration-days" type="number" min="1" value={settings.bonus_expiration.expiration_days} onChange={event => setSettings(current => current && ({ ...current, bonus_expiration: { ...current.bonus_expiration, expiration_days: Number(event.target.value) } }))} className="input-classic" required />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="notify-days">{t('bonus.notifyDays')}</label>
                <input id="notify-days" type="number" min="1" value={settings.bonus_expiration.notify_before_days} onChange={event => setSettings(current => current && ({ ...current, bonus_expiration: { ...current.bonus_expiration, notify_before_days: Number(event.target.value) } }))} className="input-classic" required />
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="form-section">
          <legend>{t('bonus.promocodes')}</legend>
          <div className="section-heading">
            <p>{t('bonus.promocodesHint')}</p>
            <button type="button" className="btn-outline px-4 inline-flex items-center gap-2" onClick={addPromo}>
              <Plus aria-hidden="true" size={17} />{t('bonus.addPromo')}
            </button>
          </div>
          {settings.bonus_promocodes.length === 0 ? <p className="field-hint">{t('bonus.noPromos')}</p> : (
            <div className="form-stack">
              {settings.bonus_promocodes.map((promo, index) => (
                <div className="promo-editor-row" key={`${index}-${promo.code}`}>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`promo-code-${index}`}>{t('bonus.promoCode')}</label>
                    <input id={`promo-code-${index}`} className="input-classic" value={promo.code} onChange={event => updatePromo(index, { code: event.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 32) })} autoComplete="off" spellCheck={false} required />
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`promo-type-${index}`}>{t('bonus.promoType')}</label>
                    <select id={`promo-type-${index}`} className="input-classic" value={promo.type} onChange={event => updatePromo(index, { type: event.target.value as PromoCode['type'] })}>
                      <option value="percent">%</option><option value="fixed">₸</option>
                    </select>
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`promo-value-${index}`}>{t('bonus.promoValue')}</label>
                    <input id={`promo-value-${index}`} type="number" min="1" max={promo.type === 'percent' ? 100 : undefined} className="input-classic" value={promo.value} onChange={event => updatePromo(index, { value: Number(event.target.value) })} required />
                  </div>
                  <div className="field-group">
                    <label className="field-label" htmlFor={`promo-min-${index}`}>{t('bonus.promoMin')}</label>
                    <input id={`promo-min-${index}`} type="number" min="0" className="input-classic" value={promo.min_order} onChange={event => updatePromo(index, { min_order: Number(event.target.value) })} required />
                  </div>
                  <label className="switch-row promo-active"><input type="checkbox" checked={promo.active} onChange={event => updatePromo(index, { active: event.target.checked })} /><span className="switch-control" aria-hidden="true" /><span>{t('common.active')}</span></label>
                  <button type="button" className="icon-button icon-button-danger" onClick={() => removePromo(index)} aria-label={t('common.delete')}><Trash2 aria-hidden="true" size={18} /></button>
                </div>
              ))}
            </div>
          )}
        </fieldset>

        <div className="form-footer">
          <button type="submit" className="btn-classic px-6 inline-flex items-center gap-2" disabled={saving}>
            {saving ? <LoaderCircle className="spin" aria-hidden="true" size={18} /> : <Save aria-hidden="true" size={18} />}
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

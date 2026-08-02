import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, LoaderCircle, Save } from 'lucide-react';
import { Link } from '../lib/router';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface BonusSettings {
  base_cashback_percent: number;
  max_discount_percent: number;
  bonus_expiration: { enabled: boolean; expiration_days: number; notify_before_days: number };
  [key: string]: unknown;
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
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { void fetchSettings(); }, [fetchSettings]);

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

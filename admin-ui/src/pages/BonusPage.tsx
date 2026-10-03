import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { ArrowRight, Gift, LoaderCircle, Monitor, Save, Settings2, Users } from 'lucide-react';
import { Link, useLocation, useNavigate } from '../lib/router';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';
import ReferralSettings, { type ReferralPolicy } from './ReferralSettings';
import ReferralReport from './ReferralReport';
import CashierSignupRace from './CashierSignupRace';
import '../styles/bonus-page.css';

const tabs = ['cashiers', 'referrals', 'registers', 'settings'] as const;
type BonusTab = (typeof tabs)[number];
const labels = {
  ru: { cashiers: 'Кассиры', referrals: 'Приглашения', registers: 'Кассы', settings: 'Настройки', tabs: 'Разделы бонусов', rules: 'Правила бонусов', unsaved: 'Есть несохранённые изменения', tiers: 'Уровни кэшбэка' },
  kk: { cashiers: 'Кассирлер', referrals: 'Шақырулар', registers: 'Кассалар', settings: 'Баптаулар', tabs: 'Бонус бөлімдері', rules: 'Бонус ережелері', unsaved: 'Сақталмаған өзгерістер бар', tiers: 'Кэшбэк деңгейлері' },
};
const tabIcons = { cashiers: Users, referrals: Gift, registers: Monitor, settings: Settings2 };

interface BonusSettings {
  bonus_referral: ReferralPolicy;
  base_cashback_percent: number;
  max_discount_percent: number;
  bonus_expiration: { enabled: boolean; expiration_days: number; notify_before_days: number };
  [key: string]: unknown;
}

export default function BonusPage({ scope = '' }: { scope?: string }) {
  const { t, locale } = useI18n();
  const text = labels[locale === 'kk' ? 'kk' : 'ru'];
  const { toast } = useFeedback();
  const [settings, setSettings] = useState<BonusSettings | null>(null);
  const [savedSettings, setSavedSettings] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const location = useLocation();
  const navigate = useNavigate();
  const selected = new URLSearchParams(location.search).get('tab');
  const tab: BonusTab = tabs.includes(selected as BonusTab) ? selected as BonusTab : 'cashiers';
  const [visited, setVisited] = useState<BonusTab[]>([tab]);
  const selectTab = (next: BonusTab) => {
    setVisited((current) => current.includes(next) ? current : [...current, next]);
    navigate(`${location.pathname}${next === 'cashiers' ? '' : `?tab=${next}`}`, { replace: true });
  };
  useEffect(() => { setVisited((current) => current.includes(tab) ? current : [...current, tab]); }, [tab]);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const data = await api.getSettings();
      const loaded = {
        bonus_referral: {
          enabled: data.bonus_referral?.enabled === true,
          inviter_bonus: Number(data.bonus_referral?.inviter_bonus ?? 1000),
          friend_bonus: Number(data.bonus_referral?.friend_bonus ?? 500),
          min_first_order: Number(data.bonus_referral?.min_first_order ?? 0),
          max_invites_per_day: 0,
          max_rewards_per_month: 0,
          max_reward_amount_per_month: 0,
          review_same_device: true,
        },
        base_cashback_percent: Number(data.base_cashback_percent ?? 0),
        max_discount_percent: Number(data.max_discount_percent ?? 0),
        bonus_expiration: {
          enabled: Boolean(data.bonus_expiration?.enabled),
          expiration_days: Number(data.bonus_expiration?.expiration_days ?? 90),
          notify_before_days: Number(data.bonus_expiration?.notify_before_days ?? 30),
        },
      };
      setSettings(loaded);
      setSavedSettings(JSON.stringify(loaded));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!settings || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.updateSettings(settings);
      setSavedSettings(JSON.stringify(settings));
      toast(t('bonus.saved'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-stack page-narrow bonus-page">
      <div className="bonus-tabs" role="tablist" aria-label={text.tabs}>
        {tabs.map((key, index) => {
          const Icon = tabIcons[key];
          return <button key={key} type="button" role="tab" id={`bonus-tab-${key}`} aria-controls={`bonus-panel-${key}`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} onClick={() => selectTab(key)} onKeyDown={(event) => {
            const next = event.key === 'ArrowRight' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowLeft' ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : null;
            if (next) { event.preventDefault(); selectTab(next); document.getElementById(`bonus-tab-${next}`)?.focus(); }
          }}>
            <Icon size={18} aria-hidden="true" /><span>{text[key]}</span>
            {key === 'settings' && settings && JSON.stringify(settings) !== savedSettings && <span className="bonus-unsaved-dot" aria-label={text.unsaved} />}
          </button>;
        })}
      </div>
      <div role="tabpanel" id="bonus-panel-cashiers" aria-labelledby="bonus-tab-cashiers" hidden={tab !== 'cashiers'}><CashierSignupRace /></div>
      <div role="tabpanel" id="bonus-panel-referrals" aria-labelledby="bonus-tab-referrals" hidden={tab !== 'referrals'}>{visited.includes('referrals') && <ReferralReport scope={scope} />}</div>
      <div role="tabpanel" id="bonus-panel-registers" aria-labelledby="bonus-tab-registers" hidden={tab !== 'registers'}>{visited.includes('registers') && <ReferralReport view="health" scope={scope} />}</div>
      <div role="tabpanel" id="bonus-panel-settings" aria-labelledby="bonus-tab-settings" hidden={tab !== 'settings'}>
      {loading ? <PageState type="loading" /> : !settings ? <PageState type="error" description={error || t('common.loadError')} onRetry={fetchSettings} /> : <form className="card settings-form bonus-settings" onSubmit={save}>
        {JSON.stringify(settings) !== savedSettings && (
          <p className="inline-alert" role="status">
            {text.unsaved}
          </p>
        )}
        <div className="section-heading">
          <div>
            <h2>{text.rules}</h2>
          </div>
          <Link to="/tiers" className="btn-outline px-4 inline-flex items-center gap-2">
            {text.tiers} <ArrowRight aria-hidden="true" size={17} />
          </Link>
        </div>
        {error && (
          <div className="inline-alert inline-alert-error" role="alert">
            {error}
          </div>
        )}

        <div className="form-grid form-grid-2">
          <div className="field-group">
            <label className="field-label" htmlFor="base-cashback">
              {t('bonus.baseCashback')}
            </label>
            <input
              id="base-cashback"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={settings.base_cashback_percent}
              onChange={(event) =>
                setSettings(
                  (current) =>
                    current && { ...current, base_cashback_percent: Number(event.target.value) },
                )
              }
              className="input-classic"
              required
            />
            <p className="field-hint">{t('bonus.baseHint')}</p>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="max-discount">
              {t('bonus.maxDiscount')}
            </label>
            <input
              id="max-discount"
              type="number"
              min="0"
              max="100"
              step="1"
              value={settings.max_discount_percent}
              onChange={(event) =>
                setSettings(
                  (current) =>
                    current && { ...current, max_discount_percent: Number(event.target.value) },
                )
              }
              className="input-classic"
              required
            />
          </div>
        </div>

        <fieldset className="form-section">
          <legend>{t('bonus.expiration')}</legend>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={settings.bonus_expiration.enabled}
              onChange={(event) =>
                setSettings(
                  (current) =>
                    current && {
                      ...current,
                      bonus_expiration: {
                        ...current.bonus_expiration,
                        enabled: event.target.checked,
                      },
                    },
                )
              }
            />
            <span className="switch-control" aria-hidden="true" />
            <span>{t('bonus.expirationEnable')}</span>
          </label>

          {settings.bonus_expiration.enabled && (
            <div className="form-grid form-grid-2 reveal-panel">
              <div className="field-group">
                <label className="field-label" htmlFor="expiration-days">
                  {t('bonus.inactiveDays')}
                </label>
                <input
                  id="expiration-days"
                  type="number"
                  min="1"
                  value={settings.bonus_expiration.expiration_days}
                  onChange={(event) =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          bonus_expiration: {
                            ...current.bonus_expiration,
                            expiration_days: Number(event.target.value),
                          },
                        },
                    )
                  }
                  className="input-classic"
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor="notify-days">
                  {t('bonus.notifyDays')}
                </label>
                <input
                  id="notify-days"
                  type="number"
                  min="1"
                  value={settings.bonus_expiration.notify_before_days}
                  onChange={(event) =>
                    setSettings(
                      (current) =>
                        current && {
                          ...current,
                          bonus_expiration: {
                            ...current.bonus_expiration,
                            notify_before_days: Number(event.target.value),
                          },
                        },
                    )
                  }
                  className="input-classic"
                  required
                />
              </div>
            </div>
          )}
        </fieldset>

        <ReferralSettings
          value={settings.bonus_referral}
          onChange={(bonus_referral) =>
            setSettings((current) => current && { ...current, bonus_referral })
          }
        />
        <div className="form-footer">
          <button
            type="submit"
            className="btn-classic px-6 inline-flex items-center gap-2"
            disabled={saving}
          >
            {saving ? (
              <LoaderCircle className="spin" aria-hidden="true" size={18} />
            ) : (
              <Save aria-hidden="true" size={18} />
            )}
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>}
      </div>
    </div>
  );
}

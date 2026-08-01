import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppWindow, CheckCircle2, LogOut, Save, ShieldCheck, Smartphone } from 'lucide-react';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface PlatformRelease {
  latest_version: string;
  minimum_version: string;
  store_url: string;
}

interface ReleasePolicy {
  android: PlatformRelease;
  ios: PlatformRelease;
}

const defaultPolicy: ReleasePolicy = {
  android: {
    latest_version: '1.0.0',
    minimum_version: '1.0.0',
    store_url: 'https://play.google.com/store/apps/details?id=com.bulka.bonus',
  },
  ios: { latest_version: '1.0.0', minimum_version: '1.0.0', store_url: '' },
};

export default function SettingsPage() {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [policy, setPolicy] = useState<ReleasePolicy | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const settings = await api.getSettings();
      const configured = settings.app_release_policy as Partial<ReleasePolicy> | undefined;
      setPolicy({
        android: { ...defaultPolicy.android, ...configured?.android },
        ios: { ...defaultPolicy.ios, ...configured?.ios },
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const updatePlatform = (
    platform: keyof ReleasePolicy,
    field: keyof PlatformRelease,
    value: string,
  ) => {
    setPolicy((current) =>
      current
        ? { ...current, [platform]: { ...current[platform], [field]: value.trimStart() } }
        : current,
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!policy || saving) return;
    setSaving(true);
    setError('');
    try {
      await api.updateSettings({ app_release_policy: policy });
      toast(t('settings.releaseSaved'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <PageState type="loading" />;
  if (!policy) return <PageState type="error" description={error} onRetry={load} />;

  return (
    <div className="page-stack page-narrow">
      <section className="card profile-card">
        <div className="profile-card-header">
          <div className="profile-avatar" aria-hidden="true">
            B
          </div>
          <div>
            <h2>{t('settings.heading')}</h2>
            <p>{t('settings.role')}</p>
          </div>
          <button
            type="button"
            onClick={() => api.logout()}
            className="btn-outline danger-outline px-4 inline-flex items-center gap-2"
          >
            <LogOut aria-hidden="true" size={17} /> {t('auth.logoutFull')}
          </button>
        </div>
        <p className="page-help">{t('settings.intro')}</p>

        <div className="settings-grid">
          <article className="setting-card">
            <span className="setting-icon">
              <ShieldCheck aria-hidden="true" size={21} />
            </span>
            <div className="setting-copy">
              <h3>{t('settings.session')}</h3>
              <p className="status-text">
                <CheckCircle2 aria-hidden="true" size={15} /> {t('settings.sessionActive')}
              </p>
            </div>
          </article>
          <article className="setting-card">
            <span className="setting-icon">
              <AppWindow aria-hidden="true" size={21} />
            </span>
            <div className="setting-copy">
              <h3>{t('settings.application')}</h3>
              <p>{t('settings.appValue')}</p>
            </div>
          </article>
        </div>
      </section>

      <form className="card settings-form" onSubmit={save}>
        <div className="section-heading">
          <div>
            <h2>{t('settings.releaseHeading')}</h2>
            <p>{t('settings.releaseHint')}</p>
          </div>
          <Smartphone aria-hidden="true" size={24} />
        </div>

        {error && (
          <div className="inline-alert inline-alert-error" role="alert">
            {error}
          </div>
        )}

        {(['android', 'ios'] as const).map((platform) => (
          <fieldset className="form-section" key={platform}>
            <legend>{platform === 'android' ? 'Android' : 'iOS'}</legend>
            <div className="form-grid form-grid-2">
              <div className="field-group">
                <label className="field-label" htmlFor={`${platform}-latest`}>
                  {t('settings.latestVersion')}
                </label>
                <input
                  id={`${platform}-latest`}
                  className="input-classic"
                  value={policy[platform].latest_version}
                  pattern="\d{1,5}(\.\d{1,5}){1,3}"
                  placeholder="1.0.0"
                  onChange={(event) =>
                    updatePlatform(platform, 'latest_version', event.target.value)
                  }
                  required
                />
              </div>
              <div className="field-group">
                <label className="field-label" htmlFor={`${platform}-minimum`}>
                  {t('settings.minimumVersion')}
                </label>
                <input
                  id={`${platform}-minimum`}
                  className="input-classic"
                  value={policy[platform].minimum_version}
                  pattern="\d{1,5}(\.\d{1,5}){1,3}"
                  placeholder="1.0.0"
                  onChange={(event) =>
                    updatePlatform(platform, 'minimum_version', event.target.value)
                  }
                  required
                />
                <p className="field-hint">{t('settings.minimumHint')}</p>
              </div>
            </div>
            <div className="field-group">
              <label className="field-label" htmlFor={`${platform}-store`}>
                {t('settings.storeUrl')}
              </label>
              <input
                id={`${platform}-store`}
                className="input-classic"
                type="url"
                value={policy[platform].store_url}
                placeholder="https://"
                onChange={(event) => updatePlatform(platform, 'store_url', event.target.value)}
                required={platform === 'android'}
              />
            </div>
          </fieldset>
        ))}

        <div className="form-footer">
          <button className="btn-classic px-5 inline-flex items-center gap-2" disabled={saving}>
            <Save aria-hidden="true" size={17} /> {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </form>
    </div>
  );
}

import { AppWindow, CheckCircle2, LogOut, ShieldCheck } from 'lucide-react';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

export default function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="page-stack page-narrow">
      <section className="card profile-card">
        <div className="profile-card-header">
          <div className="profile-avatar" aria-hidden="true">B</div>
          <div>
            <h2>{t('settings.heading')}</h2>
            <p>{t('settings.role')}</p>
          </div>
          <button type="button" onClick={() => api.logout()} className="btn-outline danger-outline px-4 inline-flex items-center gap-2">
            <LogOut aria-hidden="true" size={17} /> {t('auth.logoutFull')}
          </button>
        </div>
        <p className="page-help">{t('settings.intro')}</p>

        <div className="settings-grid">
          <article className="setting-card">
            <span className="setting-icon"><ShieldCheck aria-hidden="true" size={21} /></span>
            <div className="setting-copy"><h3>{t('settings.session')}</h3><p className="status-text"><CheckCircle2 aria-hidden="true" size={15} /> {t('settings.sessionActive')}</p></div>
          </article>
          <article className="setting-card">
            <span className="setting-icon"><AppWindow aria-hidden="true" size={21} /></span>
            <div className="setting-copy"><h3>{t('settings.application')}</h3><p>{t('settings.appValue')}</p></div>
          </article>
        </div>
      </section>
    </div>
  );
}

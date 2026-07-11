import { LogOut, Menu } from 'lucide-react';
import { useLocation } from 'react-router-dom';
import { api } from '../lib/api';
import { useI18n } from '../lib/i18n';

const routeKeys: Record<string, string> = {
  '/analytics': 'analytics', '/transactions': 'transactions', '/iiko': 'iiko', '/broadcast': 'broadcast',
  '/customers': 'customers', '/settings': 'settings', '/stories': 'stories', '/news': 'news',
  '/bonus': 'bonus', '/tiers': 'tiers', '/locations': 'locations',
};

export default function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { t } = useI18n();
  const location = useLocation();
  const page = routeKeys[location.pathname] ?? 'analytics';

  return (
    <header className="sagi-topbar">
      <div className="topbar-title-wrap">
        <button type="button" onClick={onMenuClick} className="icon-button menu-button" aria-label={t('nav.openMenu')}>
          <Menu aria-hidden="true" size={23} />
        </button>
        <div>
          <h1 className="sagi-page-title">{t(`page.${page}.title`)}</h1>
          <p className="sagi-page-subtitle">{t(`page.${page}.subtitle`)}</p>
        </div>
      </div>
      <div className="topbar-actions">
        <button type="button" onClick={() => api.logout()} className="btn-outline topbar-logout" aria-label={t('auth.logoutFull')}>
          <LogOut aria-hidden="true" size={17} />
          <span>{t('auth.logout')}</span>
        </button>
      </div>
    </header>
  );
}

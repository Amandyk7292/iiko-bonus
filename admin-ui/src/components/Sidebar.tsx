import {
  BarChart3,
  BellRing,
  Building2,
  ChevronRight,
  CircleDollarSign,
  Gift,
  Images,
  Newspaper,
  ShoppingBag,
  ReceiptText,
  Settings2,
  Store,
  Users,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useI18n } from '../lib/i18n';

const sections = [
  {
    title: 'nav.main',
    items: [
      { to: '/analytics', label: 'nav.analytics', icon: BarChart3 },
      { to: '/transactions', label: 'nav.transactions', icon: ReceiptText },
      { to: '/iiko', label: 'nav.iiko', icon: Store },
      { to: '/broadcast', label: 'nav.broadcast', icon: BellRing },
    ],
  },
  {
    title: 'nav.customersGroup',
    items: [
      { to: '/orders', label: 'nav.orders', icon: ShoppingBag },
      { to: '/customers', label: 'nav.customers', icon: Users },
    ],
  },
  {
    title: 'nav.content',
    items: [
      { to: '/menu', label: 'nav.menu', icon: UtensilsCrossed },
      { to: '/stories', label: 'nav.stories', icon: Images },
      { to: '/news', label: 'nav.news', icon: Newspaper },
      { to: '/bonus', label: 'nav.bonus', icon: Gift },
      { to: '/tiers', label: 'nav.tiers', icon: CircleDollarSign },
      { to: '/locations', label: 'nav.locations', icon: Building2 },
      { to: '/settings', label: 'nav.settings', icon: Settings2 },
    ],
  },
];

export default function Sidebar({ isOpen = false, onClose }: { isOpen?: boolean; onClose?: () => void }) {
  const { t } = useI18n();
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return (
    <>
      <button
        type="button"
        className={`sidebar-overlay ${isOpen ? 'sidebar-overlay-visible' : ''}`}
        onClick={onClose}
        aria-label={t('nav.closeMenu')}
        tabIndex={isOpen ? 0 : -1}
      />
      <aside
        className={`sagi-sidebar ${isOpen ? 'sidebar-open' : ''}`}
        aria-label={t('nav.main')}
        aria-hidden={!isDesktop && !isOpen}
        inert={!isDesktop && !isOpen}
      >
        <div className="sidebar-brand-row">
          <img src="/admin/bulka_logo.png" alt="Bulka" className="sidebar-logo" width="142" height="52" />
          <button type="button" onClick={onClose} className="icon-button sidebar-close" aria-label={t('nav.closeMenu')}>
            <X aria-hidden="true" size={21} />
          </button>
        </div>
        <nav>
          {sections.map(section => (
            <div key={section.title} className="sidebar-section">
              <p className="sagi-nav-title">{t(section.title)}</p>
              {section.items.map(item => {
                const Icon = item.icon;
                return (
                  <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? 'sagi-nav-link sagi-nav-link-active' : 'sagi-nav-link'}>
                    <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                    <span>{t(item.label)}</span>
                    <ChevronRight aria-hidden="true" className="nav-chevron" size={16} />
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}

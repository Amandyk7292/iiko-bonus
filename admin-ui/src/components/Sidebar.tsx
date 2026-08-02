import {
  BarChart3,
  BellRing,
  Building2,
  Bike,
  ChevronRight,
  CircleDollarSign,
  Gift,
  Images,
  Newspaper,
  ShoppingBag,
  ReceiptText,
  Settings2,
  ShieldCheck,
  Store,
  Users,
  UtensilsCrossed,
  Warehouse,
  ClipboardList,
  KeyRound,
  ContactRound,
  MapPinned,
  MessageSquareText,
  MessageCircle,
  PanelLeftClose,
  Workflow,
  X,
  LayoutDashboard,
  Headphones,
  Activity,
} from 'lucide-react';
import { NavLink, useLocation } from '../lib/router';
import { useEffect, useMemo, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { useAdminRealtime } from '../lib/admin-realtime';

const sections = [
  {
    title: 'nav.overview',
    items: [
      { to: '/operations', label: 'nav.operationsCenter', icon: LayoutDashboard },
      { to: '/analytics', label: 'nav.analytics', icon: BarChart3 },
      { to: '/transactions', label: 'nav.transactions', icon: ReceiptText },
      { to: '/iiko', label: 'nav.iiko', icon: Store },
    ],
  },
  {
    title: 'nav.operations',
    items: [
      { to: '/orders', label: 'nav.orders', icon: ShoppingBag },
      { to: '/kitchen', label: 'nav.kitchen', icon: ClipboardList },
      { to: '/dispatch', label: 'nav.dispatch', icon: MapPinned },
      { to: '/couriers', label: 'nav.couriers', icon: Bike },
      { to: '/inventory', label: 'nav.inventory', icon: Warehouse },
    ],
  },
  {
    title: 'nav.customersGroup',
    items: [
      { to: '/customers', label: 'nav.customers', icon: Users },
      { to: '/whatsapp', label: 'nav.whatsapp', icon: MessageCircle },
      { to: '/contacts', label: 'nav.contacts', icon: ContactRound },
      { to: '/reviews', label: 'nav.reviews', icon: MessageSquareText },
      { to: '/support', label: 'nav.support', icon: Headphones },
    ],
  },
  {
    title: 'nav.content',
    items: [
      { to: '/menu', label: 'nav.menu', icon: UtensilsCrossed },
      { to: '/stories', label: 'nav.stories', icon: Images },
      { to: '/news', label: 'nav.news', icon: Newspaper },
    ],
  },
  {
    title: 'nav.loyalty',
    items: [
      { to: '/broadcast', label: 'nav.broadcast', icon: BellRing },
      { to: '/bonus', label: 'nav.bonus', icon: Gift },
      { to: '/marketing', label: 'nav.marketing', icon: Workflow },
      { to: '/tiers', label: 'nav.tiers', icon: CircleDollarSign },
    ],
  },
  {
    title: 'nav.system',
    items: [
      { to: '/locations', label: 'nav.locations', icon: Building2 },
      { to: '/settings', label: 'nav.settings', icon: Settings2 },
      { to: '/security', label: 'nav.security', icon: ShieldCheck },
      { to: '/integrations', label: 'nav.integrations', icon: Activity },
      { to: '/access', label: 'nav.access', icon: KeyRound },
    ],
  },
];

const allowedPaths: Record<string, string[]> = {
  branch_manager: [
    '/operations',
    '/analytics',
    '/customers',
    '/whatsapp',
    '/orders',
    '/menu',
    '/inventory',
    '/couriers',
    '/dispatch',
    '/kitchen',
    '/locations',
    '/reviews',
    '/support',
    '/transactions',
    '/integrations',
  ],
  operator: [
    '/operations',
    '/customers',
    '/whatsapp',
    '/orders',
    '/dispatch',
    '/kitchen',
    '/reviews',
    '/support',
  ],
  marketer: [
    '/operations',
    '/analytics',
    '/customers',
    '/broadcast',
    '/contacts',
    '/stories',
    '/news',
    '/bonus',
    '/tiers',
    '/marketing',
    '/reviews',
    '/support',
  ],
  courier: ['/couriers', '/dispatch'],
  viewer: [
    '/operations',
    '/analytics',
    '/customers',
    '/whatsapp',
    '/orders',
    '/menu',
    '/inventory',
    '/couriers',
    '/dispatch',
    '/kitchen',
    '/locations',
    '/reviews',
    '/support',
    '/transactions',
    '/integrations',
  ],
  whatsapp_operator: ['/whatsapp'],
};

export default function Sidebar({
  role = 'viewer',
  isOpen = false,
  collapsed = false,
  onClose,
  onCollapse,
}: {
  role?: string;
  isOpen?: boolean;
  collapsed?: boolean;
  onClose?: () => void;
  onCollapse?: () => void;
}) {
  const { t } = useI18n();
  const { summary } = useAdminRealtime();
  const location = useLocation();
  const [isDesktop, setIsDesktop] = useState(
    () => window.matchMedia('(min-width: 1024px)').matches,
  );
  const visibleSections = useMemo(
    () =>
      sections
        .map((section) => ({
          ...section,
          items: section.items.filter(
            (item) => !allowedPaths[role] || allowedPaths[role].includes(item.to),
          ),
        }))
        .filter((section) => section.items.length > 0),
    [role],
  );
  const activeSection = visibleSections.find((section) =>
    section.items.some((item) => item.to === location.pathname),
  )?.title;
  const [openSection, setOpenSection] = useState(
    () => activeSection ?? visibleSections[0]?.title ?? '',
  );

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const update = () => setIsDesktop(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    if (activeSection) setOpenSection(activeSection);
  }, [activeSection]);

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
        className={`sagi-sidebar ${isOpen ? 'sidebar-open' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}
        aria-label={t('nav.main')}
        aria-hidden={(isDesktop && collapsed) || (!isDesktop && !isOpen)}
        inert={(isDesktop && collapsed) || (!isDesktop && !isOpen)}
      >
        <div className="sidebar-brand-row">
          <img
            src="/admin/bulka_logo.png"
            alt="Bulka"
            className="sidebar-logo"
            width="142"
            height="52"
          />
          <button
            type="button"
            onClick={onCollapse}
            className="icon-button sidebar-collapse"
            aria-label={t('nav.collapseMenu')}
          >
            <PanelLeftClose aria-hidden="true" size={21} />
          </button>
          <button
            type="button"
            onClick={onClose}
            className="icon-button sidebar-close"
            aria-label={t('nav.closeMenu')}
          >
            <X aria-hidden="true" size={21} />
          </button>
        </div>
        <nav>
          {visibleSections.map((section, index) => {
            const expanded = section.title === openSection;
            const linksId = `sidebar-section-${index}`;
            return (
              <div key={section.title} className="sidebar-section">
                <button
                  type="button"
                  className="sagi-nav-title sidebar-section-toggle"
                  aria-expanded={expanded}
                  aria-controls={linksId}
                  onClick={() => setOpenSection(expanded ? '' : section.title)}
                >
                  <span>{t(section.title)}</span>
                  <ChevronRight
                    aria-hidden="true"
                    className={`sidebar-section-chevron ${expanded ? 'is-expanded' : ''}`}
                    size={16}
                  />
                </button>
                <div
                  id={linksId}
                  className={`sidebar-section-links ${expanded ? 'is-expanded' : ''}`}
                  aria-hidden={!expanded}
                  inert={!expanded}
                >
                  <div className="sidebar-section-links-inner">
                    {section.items.map((item) => {
                      const Icon = item.icon;
                      const badge =
                        item.to === '/orders'
                          ? summary?.counts?.newOrders
                          : item.to === '/support'
                            ? summary?.counts?.supportNew
                            : item.to === '/whatsapp'
                              ? summary?.counts?.whatsappUnread
                              : item.to === '/kitchen'
                                ? summary?.counts?.kitchenOverdue
                                : 0;
                      return (
                        <NavLink
                          key={item.to}
                          to={item.to}
                          onClick={onClose}
                          className={({ isActive }) =>
                            isActive ? 'sagi-nav-link sagi-nav-link-active' : 'sagi-nav-link'
                          }
                        >
                          <Icon aria-hidden="true" size={19} strokeWidth={1.8} />
                          <span>{t(item.label)}</span>
                          {Boolean(badge) && (
                            <span className="sidebar-nav-badge">
                              {Number(badge) > 99 ? '99+' : badge}
                            </span>
                          )}
                          <ChevronRight aria-hidden="true" className="nav-chevron" size={16} />
                        </NavLink>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </nav>
      </aside>
    </>
  );
}

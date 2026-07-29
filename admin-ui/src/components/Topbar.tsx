import {
  Bell,
  CreditCard,
  ClipboardList,
  Headphones,
  LogOut,
  Menu,
  MessageCircle,
  ShoppingBag,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from '../lib/router';
import { api, type AdminScopeLocation } from '../lib/api';
import { useAdminRealtime } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
import AdminGlobalSearch from './AdminGlobalSearch';
import LanguageSelect from './LanguageSelect';

const routeKeys: Record<string, string> = {
  '/operations': 'operations',
  '/analytics': 'analytics',
  '/transactions': 'transactions',
  '/iiko': 'iiko',
  '/broadcast': 'broadcast',
  '/customers': 'customers',
  '/orders': 'orders',
  '/settings': 'settings',
  '/stories': 'stories',
  '/news': 'news',
  '/bonus': 'bonus',
  '/tiers': 'tiers',
  '/locations': 'locations',
  '/menu': 'menu',
  '/inventory': 'inventory',
  '/couriers': 'couriers',
  '/security': 'security',
  '/dispatch': 'dispatch',
  '/kitchen': 'kitchen',
  '/marketing': 'marketing',
  '/reviews': 'reviews',
  '/support': 'support',
  '/integrations': 'integrations',
  '/access': 'access',
  '/contacts': 'contacts',
  '/whatsapp': 'whatsapp',
};

export default function Topbar({
  onMenuClick,
  operatorMode = false,
  scopeLocations = [],
  selectedBranchId = '',
  onBranchChange,
}: {
  onMenuClick?: () => void;
  operatorMode?: boolean;
  scopeLocations?: AdminScopeLocation[];
  selectedBranchId?: string;
  onBranchChange?: (branchId: string) => void;
}) {
  const { t } = useI18n();
  const location = useLocation();
  const { summary, connectionStatus, lastUpdatedAt, soundEnabled, setSoundEnabled } =
    useAdminRealtime();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const notificationsRef = useRef<HTMLDivElement>(null);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const page = routeKeys[location.pathname] ?? 'operations';
  const counts = summary?.counts;
  const actionCount = counts
    ? counts.newOrders +
      counts.kitchenOverdue +
      counts.supportNew +
      counts.whatsappUnread +
      counts.paymentIssues
    : 0;

  useEffect(() => {
    if (!notificationsOpen) return;
    const close = (event: PointerEvent) => {
      if (!notificationsRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
      }
    };
    const closeWithKeyboard = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNotificationsOpen(false);
      notificationsButtonRef.current?.focus();
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', closeWithKeyboard);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', closeWithKeyboard);
    };
  }, [notificationsOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => setStatusClock(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const realtimeLabel = t(`realtime.${connectionStatus}`);
  const minutesSinceUpdate =
    lastUpdatedAt == null ? null : Math.max(0, Math.floor((statusClock - lastUpdatedAt) / 60_000));
  const updatedLabel =
    minutesSinceUpdate == null
      ? ''
      : minutesSinceUpdate < 1
        ? t('realtime.updatedNow')
        : t('realtime.updatedMinutes', { count: minutesSinceUpdate });

  const notificationItems = counts
    ? [
        {
          key: 'payments',
          label: t('notifications.paymentIssues'),
          value: counts.paymentIssues,
          path: '/orders?payment=issues',
          icon: CreditCard,
        },
        {
          key: 'orders',
          label: 'Новые оплаченные заказы',
          value: counts.newOrders,
          path: '/orders',
          icon: ShoppingBag,
        },
        {
          key: 'kitchen',
          label: 'Просрочено на кухне',
          value: counts.kitchenOverdue,
          path: '/kitchen',
          icon: ClipboardList,
        },
        {
          key: 'support',
          label: 'Новые обращения',
          value: counts.supportNew,
          path: '/support?queue=new',
          icon: Headphones,
        },
        {
          key: 'whatsapp',
          label: 'Непрочитано в WhatsApp',
          value: counts.whatsappUnread,
          path: '/whatsapp',
          icon: MessageCircle,
        },
      ].filter((item) => {
        if (item.value <= 0) return false;
        if (item.path.startsWith('/orders')) return summary?.capabilities.orders;
        if (item.path.startsWith('/kitchen')) return summary?.capabilities.kitchen;
        if (item.path.startsWith('/support')) return summary?.capabilities.support;
        if (item.path.startsWith('/whatsapp')) return summary?.capabilities.whatsapp;
        return false;
      })
    : [];

  return (
    <header className="sagi-topbar">
      <div className="topbar-title-wrap">
        {onMenuClick && (
          <button
            type="button"
            onClick={onMenuClick}
            className="icon-button menu-button"
            aria-label={t('nav.openMenu')}
          >
            <Menu aria-hidden="true" size={23} />
          </button>
        )}
        <div>
          <h1 className="sagi-page-title">
            {operatorMode ? 'Переписки WhatsApp' : t(`page.${page}.title`)}
          </h1>
          <p className="sagi-page-subtitle">
            {operatorMode ? 'Ответы клиентам Bulka' : t(`page.${page}.subtitle`)}
          </p>
        </div>
      </div>
      <div className="topbar-actions">
        {!operatorMode && <AdminGlobalSearch />}
        {!operatorMode && scopeLocations.length > 0 && (
          <label className="topbar-branch-select">
            <span>Филиал</span>
            <select
              value={selectedBranchId}
              onChange={(event) => onBranchChange?.(event.target.value)}
              aria-label="Филиал для всех разделов"
            >
              <option value="">Все доступные</option>
              {scopeLocations.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {!operatorMode && (
          <div
            className={`realtime-status realtime-status-${connectionStatus}`}
            role="status"
            aria-live="polite"
            aria-atomic="true"
            title={
              lastUpdatedAt
                ? `${realtimeLabel}. ${new Date(lastUpdatedAt).toLocaleString()}`
                : realtimeLabel
            }
          >
            <span className="realtime-status-dot" aria-hidden="true" />
            <span className="realtime-status-copy">
              <strong>{realtimeLabel}</strong>
              {updatedLabel && <small>{updatedLabel}</small>}
            </span>
          </div>
        )}
        {!operatorMode && (
          <div className="topbar-notifications" ref={notificationsRef}>
            <button
              ref={notificationsButtonRef}
              type="button"
              className="icon-button topbar-notification-button"
              aria-label="Операционные уведомления"
              aria-expanded={notificationsOpen}
              onClick={() => setNotificationsOpen((open) => !open)}
            >
              <Bell aria-hidden="true" size={20} />
              {actionCount > 0 && (
                <span className="topbar-notification-count">
                  {actionCount > 99 ? '99+' : actionCount}
                </span>
              )}
            </button>
            {notificationsOpen && (
              <section className="notification-popover" aria-label="Операционные уведомления">
                <header>
                  <div>
                    <strong>Требует внимания</strong>
                    <span>Актуальные задачи по выбранному филиалу</span>
                  </div>
                  <button
                    type="button"
                    className="icon-button icon-button-sm"
                    aria-label={
                      soundEnabled ? 'Выключить звук новых заказов' : 'Включить звук новых заказов'
                    }
                    title={
                      soundEnabled ? 'Выключить звук новых заказов' : 'Включить звук новых заказов'
                    }
                    onClick={() => setSoundEnabled(!soundEnabled)}
                  >
                    {soundEnabled ? (
                      <Volume2 size={17} aria-hidden="true" />
                    ) : (
                      <VolumeX size={17} aria-hidden="true" />
                    )}
                  </button>
                </header>
                <div className="notification-popover-list">
                  {notificationItems.length ? (
                    notificationItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <Link
                          key={item.key}
                          to={item.path}
                          onClick={() => setNotificationsOpen(false)}
                        >
                          <span className="notification-popover-icon">
                            <Icon aria-hidden="true" size={18} />
                          </span>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </Link>
                      );
                    })
                  ) : (
                    <p className="notification-empty">Новых срочных задач нет.</p>
                  )}
                </div>
                <Link
                  className="notification-all-button"
                  to="/operations"
                  onClick={() => setNotificationsOpen(false)}
                >
                  Открыть операционный центр
                </Link>
              </section>
            )}
          </div>
        )}
        <LanguageSelect compact />
        <button
          type="button"
          onClick={() => void api.logout()}
          className="btn-outline topbar-logout"
          aria-label={t('auth.logoutFull')}
        >
          <LogOut aria-hidden="true" size={17} />
          <span>{t('auth.logout')}</span>
        </button>
      </div>
    </header>
  );
}

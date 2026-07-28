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
import { useLocation, useNavigate } from '../lib/router';
import { api, type AdminScopeLocation } from '../lib/api';
import { useAdminRealtime } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
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
  const navigate = useNavigate();
  const { summary, connectionStatus, lastUpdatedAt, soundEnabled, setSoundEnabled } =
    useAdminRealtime();
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [statusClock, setStatusClock] = useState(() => Date.now());
  const notificationsRef = useRef<HTMLDivElement>(null);
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
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
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

  const openTask = (path: string) => {
    setNotificationsOpen(false);
    navigate(path);
  };

  const notificationItems = counts
    ? [
        {
          key: 'payments',
          label: t('notifications.paymentIssues'),
          value: counts.paymentIssues,
          path: '/orders?payment=failed',
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
                    {soundEnabled ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                </header>
                <div className="notification-popover-list">
                  {notificationItems.length ? (
                    notificationItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <button type="button" key={item.key} onClick={() => openTask(item.path)}>
                          <span className="notification-popover-icon">
                            <Icon aria-hidden="true" size={18} />
                          </span>
                          <span>{item.label}</span>
                          <strong>{item.value}</strong>
                        </button>
                      );
                    })
                  ) : (
                    <p className="notification-empty">Новых срочных задач нет.</p>
                  )}
                </div>
                <button
                  type="button"
                  className="notification-all-button"
                  onClick={() => openTask('/operations')}
                >
                  Открыть операционный центр
                </button>
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

import {
  AlertTriangle,
  ArrowRight,
  ChefHat,
  Clock3,
  Headphones,
  MessageCircle,
  PackageX,
  RefreshCw,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { Link } from '../lib/router';
import PageState from '../components/PageState';
import { useAdminRealtime } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';

export default function OperationsPage() {
  const { formatDate, formatNumber } = useI18n();
  const { summary, refreshSummary } = useAdminRealtime();

  if (!summary) return <PageState type="loading" title="Собираем операционную сводку" />;

  const cards = [
    {
      label: 'Новые заказы',
      value: summary.counts.newOrders,
      hint: `${summary.counts.activeOrders} всего в работе`,
      icon: ShoppingBag,
      path: '/orders?payment=paid&status=new',
      tone: 'info',
    },
    {
      label: 'Кухня просрочена',
      value: summary.counts.kitchenOverdue,
      hint: 'Срок приготовления уже прошёл',
      icon: ChefHat,
      path: '/kitchen',
      tone: summary.counts.kitchenOverdue ? 'danger' : 'neutral',
    },
    {
      label: 'Доставка',
      value: summary.counts.deliveryAttention,
      hint: 'Нужен курьер или контроль',
      icon: Truck,
      path: '/dispatch',
      tone: summary.counts.deliveryAttention ? 'warning' : 'neutral',
    },
    {
      label: 'Поддержка',
      value: summary.counts.supportNew,
      hint: `${summary.counts.supportOverdue} с нарушенным SLA`,
      icon: Headphones,
      path: '/support?queue=new',
      tone: summary.counts.supportOverdue ? 'danger' : 'info',
    },
    {
      label: 'WhatsApp',
      value: summary.counts.whatsappUnread,
      hint: `${summary.counts.whatsappDialogs} диалогов с новыми сообщениями`,
      icon: MessageCircle,
      path: '/whatsapp',
      tone: summary.counts.whatsappUnread ? 'info' : 'neutral',
    },
    {
      label: 'Стоп-лист',
      value: summary.counts.stoppedProducts,
      hint: 'Нет остатка или включён ручной стоп',
      icon: PackageX,
      path: '/inventory',
      tone: summary.counts.stoppedProducts ? 'warning' : 'neutral',
    },
  ].filter((card) => {
    if (card.path.startsWith('/orders')) return summary.capabilities.orders;
    if (card.path.startsWith('/kitchen')) return summary.capabilities.kitchen;
    if (card.path.startsWith('/dispatch')) return summary.capabilities.dispatch;
    if (card.path.startsWith('/support')) return summary.capabilities.support;
    if (card.path.startsWith('/whatsapp')) return summary.capabilities.whatsapp;
    if (card.path.startsWith('/inventory')) return summary.capabilities.inventory;
    return false;
  });

  return (
    <div className="page-stack operations-page">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">Что требует внимания сейчас</h2>
          <p className="page-help">
            Заказы, кухня, доставка и обращения собраны в одном рабочем экране.
          </p>
        </div>
        <button
          type="button"
          className="btn-outline px-4 inline-flex items-center gap-2"
          onClick={() => void refreshSummary()}
        >
          <RefreshCw aria-hidden="true" size={17} />
          Обновить
        </button>
      </div>

      <section className="operations-metric-grid" aria-label="Операционные показатели">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <Link
              className={`operations-metric-card tone-${card.tone}`}
              key={card.label}
              to={card.path}
            >
              <span className="operations-metric-icon">
                <Icon aria-hidden="true" size={20} />
              </span>
              <span className="operations-metric-copy">
                <span>{card.label}</span>
                <strong>{formatNumber(card.value)}</strong>
                <small>{card.hint}</small>
              </span>
              <ArrowRight aria-hidden="true" size={18} />
            </Link>
          );
        })}
      </section>

      {summary.capabilities.orders && summary.counts.paymentIssues > 0 && (
        <Link className="operations-alert" to="/orders?payment=failed">
          <AlertTriangle aria-hidden="true" size={20} />
          <span>
            <strong>Проблемы оплаты или возврата: {summary.counts.paymentIssues}</strong>
            <small>Откройте заказы и проверьте сообщения сервера.</small>
          </span>
          <ArrowRight aria-hidden="true" size={18} />
        </Link>
      )}

      <div className="operations-columns">
        {summary.capabilities.orders && (
          <section className="card operations-panel">
            <header className="operations-panel-header">
              <div>
                <h3>Заказы в зоне внимания</h3>
                <p>Сначала просроченные, затем доставки и новые заказы.</p>
              </div>
              <Link className="text-button" to="/orders">
                Все заказы
              </Link>
            </header>
            {summary.orders.length ? (
              <div className="operations-list">
                {summary.orders.map((order) => {
                  const overdue =
                    order.promisedReadyAt && Date.parse(order.promisedReadyAt) < Date.now();
                  return (
                    <Link
                      key={order.id}
                      to={`/orders?search=${encodeURIComponent(String(order.number))}`}
                    >
                      <span className="operations-list-leading">
                        {overdue ? <Clock3 size={18} /> : <ShoppingBag size={18} />}
                      </span>
                      <span className="operations-list-copy">
                        <strong>Заказ №{order.number}</strong>
                        <small>
                          {order.branch || 'Без филиала'} · {formatNumber(order.amount)} ₸
                        </small>
                      </span>
                      <span className={`status-pill ${overdue ? 'status-danger' : 'status-info'}`}>
                        {overdue ? 'Просрочен' : order.orderStatus || 'Новый'}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <PageState type="empty" title="Срочных заказов нет" compact />
            )}
          </section>
        )}

        {summary.capabilities.support && (
          <section className="card operations-panel">
            <header className="operations-panel-header">
              <div>
                <h3>Очередь поддержки</h3>
                <p>Новые и просроченные обращения клиентов.</p>
              </div>
              <Link className="text-button" to="/support">
                Вся очередь
              </Link>
            </header>
            {summary.support.length ? (
              <div className="operations-list">
                {summary.support.map((request) => {
                  const overdue = request.dueAt && Date.parse(request.dueAt) < Date.now();
                  return (
                    <Link
                      key={request.id}
                      to={`/support?request=${encodeURIComponent(request.id)}`}
                    >
                      <span className="operations-list-leading">
                        <Headphones size={18} />
                      </span>
                      <span className="operations-list-copy">
                        <strong>{request.customer?.name || 'Клиент Bulka'}</strong>
                        <small>
                          {request.orderNumber ? `Заказ №${request.orderNumber} · ` : ''}
                          {request.preview}
                        </small>
                      </span>
                      <span className={`status-pill ${overdue ? 'status-danger' : 'status-info'}`}>
                        {overdue ? 'SLA нарушен' : request.priority}
                      </span>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <PageState type="empty" title="Новых обращений нет" compact />
            )}
          </section>
        )}
      </div>

      <p className="operations-updated">Сводка обновлена: {formatDate(summary.updatedAt)}</p>
    </div>
  );
}

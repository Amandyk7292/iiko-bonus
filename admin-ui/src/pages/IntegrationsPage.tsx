import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  Clock3,
  CreditCard,
  RefreshCw,
  ShieldCheck,
  Webhook,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import PageState from '../components/PageState';
import { api, type IntegrationHealthService } from '../lib/api';
import { useI18n } from '../lib/i18n';
import type {
  PaymentDiagnostics,
  PaymentProviderDiagnostic,
  PaymentWebhookDiagnostic,
} from '../lib/payment-diagnostics';

const stateCopy = {
  healthy: 'Работает',
  attention: 'Нужно внимание',
  error: 'Ошибка настройки',
  disabled: 'Выключено',
};

type HealthState = keyof typeof stateCopy;

const providerState = (provider: PaymentProviderDiagnostic): HealthState => {
  if (!provider.enabled) return 'disabled';
  if (!provider.configured || provider.available === false) return 'error';
  if (provider.available === true) return 'healthy';
  return 'attention';
};

const webhookState = (webhook: PaymentWebhookDiagnostic): HealthState => {
  if (!webhook.configured) return 'disabled';
  const successAt = Date.parse(webhook.lastSuccessAt || '') || 0;
  const failureAt = Date.parse(webhook.lastFailureAt || '') || 0;
  if (failureAt > successAt) return 'error';
  if (successAt > 0) return 'healthy';
  return 'attention';
};

const StateIcon = ({ state }: { state: HealthState }) => {
  const Icon =
    state === 'healthy'
      ? CheckCircle2
      : state === 'disabled'
        ? CircleOff
        : state === 'attention'
          ? AlertTriangle
          : XCircle;
  return <Icon aria-hidden="true" size={18} />;
};

function ProviderCard({
  name,
  provider,
  formatDate,
}: {
  name: string;
  provider: PaymentProviderDiagnostic;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const state = providerState(provider);
  return (
    <article className={`payment-provider-card state-${state}`}>
      <header>
        <strong>{name}</strong>
        <span className={`status-pill integration-state-${state}`}>
          <StateIcon state={state} />
          {stateCopy[state]}
        </span>
      </header>
      <dl>
        <div>
          <dt>Настройка</dt>
          <dd>{provider.configured ? 'Готова' : 'Не завершена'}</dd>
        </div>
        <div>
          <dt>Доступность</dt>
          <dd>
            {provider.available === null
              ? 'Не проверялась'
              : provider.available
                ? 'Доступна'
                : 'Недоступна'}
          </dd>
        </div>
      </dl>
      <p>{provider.message}</p>
      {provider.checkedAt && (
        <time dateTime={provider.checkedAt}>
          Проверено {formatDate(provider.checkedAt, { dateStyle: 'short', timeStyle: 'short' })}
        </time>
      )}
    </article>
  );
}

function WebhookStatus({
  name,
  webhook,
  formatDate,
}: {
  name: string;
  webhook: PaymentWebhookDiagnostic;
  formatDate: (value: string, options?: Intl.DateTimeFormatOptions) => string;
}) {
  const state = webhookState(webhook);
  return (
    <div className="payment-webhook-row">
      <span className={`payment-webhook-icon state-${state}`}>
        <StateIcon state={state} />
      </span>
      <div>
        <strong>{name}</strong>
        <small>
          {!webhook.configured
            ? 'Webhook не настроен'
            : webhook.lastSuccessAt
              ? `Последний успешный: ${formatDate(webhook.lastSuccessAt, {
                  dateStyle: 'short',
                  timeStyle: 'short',
                })}`
              : 'Событий пока не было'}
        </small>
        {webhook.lastErrorCode && <code>{webhook.lastErrorCode}</code>}
      </div>
    </div>
  );
}

export default function IntegrationsPage() {
  const { formatDate } = useI18n();
  const [services, setServices] = useState<IntegrationHealthService[]>([]);
  const [payments, setPayments] = useState<PaymentDiagnostics | null>(null);
  const [checkedAt, setCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState<'probe' | 'mode' | ''>('');
  const [actionMessage, setActionMessage] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.getIntegrationHealth();
      setServices(response.services);
      setPayments(response.payments);
      setCheckedAt(response.checkedAt);
      setError('');
    } catch (caught) {
      if (!silent)
        setError(caught instanceof Error ? caught.message : 'Не удалось проверить сервисы');
    } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load(true);
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const updateWidgetMode = async () => {
    if (!payments?.canManage || action) return;
    setAction('mode');
    setActionMessage('');
    try {
      const response = await api.setForteWidgetEnabled(!payments.mode.widgetEnabled);
      setPayments(response.payments);
      setActionMessage(
        response.payments.mode.fallbackActive
          ? 'Widget включён, но новые оплаты безопасно открываются через /flex.'
          : response.payments.mode.widgetEnabled
            ? 'Widget включён.'
            : 'Новые оплаты открываются через /flex.',
      );
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : 'Не удалось изменить режим');
    } finally {
      setAction('');
    }
  };

  const runPaymentProbe = async () => {
    if (!payments?.canManage || action) return;
    setAction('probe');
    setActionMessage('');
    try {
      const response = await api.runPaymentProbe();
      setPayments(response.payments);
      setActionMessage(
        response.payments.providers.forteWidget.available
          ? 'Проверка завершена: Widget принимает карты, списания не было.'
          : 'Widget недоступен — /flex уже используется автоматически.',
      );
    } catch (caught) {
      setActionMessage(caught instanceof Error ? caught.message : 'Проверка не завершилась');
    } finally {
      setAction('');
    }
  };

  if (loading && !services.length) {
    return <PageState type="loading" title="Проверяем подключённые сервисы" />;
  }
  if (error && !services.length) {
    return <PageState type="error" description={error} onRetry={load} />;
  }

  const modeState: HealthState = !payments?.mode.effectiveIntegration
    ? 'error'
    : payments.mode.fallbackActive
      ? 'attention'
      : 'healthy';
  const modeLabel =
    payments?.mode.effectiveIntegration === 'widget'
      ? 'Forte Widget'
      : payments?.mode.effectiveIntegration === 'hosted_page'
        ? 'Страница банка /flex'
        : 'Оплата недоступна';
  const visibleServices = services.filter(
    (service) => service.id !== 'kaspi' || payments?.providers.kaspi.enabled,
  );

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">Состояние внешних сервисов</h2>
          <p className="page-help">
            Здесь видны настройки WhatsApp, ИИ, оплаты, iiko, доставки и push-уведомлений.
          </p>
        </div>
        <button
          type="button"
          className="btn-outline px-4 inline-flex items-center gap-2"
          onClick={() => void load()}
          disabled={loading}
        >
          <RefreshCw aria-hidden="true" className={loading ? 'spin' : ''} size={17} />
          Проверить
        </button>
      </div>

      {error && <div className="inline-alert inline-alert-error">{error}</div>}

      {payments && (
        <section className="card payment-diagnostics" aria-labelledby="payment-diagnostics-title">
          <header className="payment-diagnostics-header">
            <div>
              <span className="payment-section-icon">
                <CreditCard aria-hidden="true" size={21} />
              </span>
              <div>
                <h3 id="payment-diagnostics-title">Диагностика оплат</h3>
                <p>Forte, webhook и очистка неоплаченных заказов.</p>
              </div>
            </div>
            <span className={`status-pill integration-state-${modeState}`}>
              <StateIcon state={modeState} />
              {modeLabel}
            </span>
          </header>

          <div className="payment-mode-row">
            <div>
              <span>Новые оплаты картой</span>
              <strong>{modeLabel}</strong>
              <small>
                {payments.mode.fallbackActive
                  ? 'Widget не прошёл проверку, поэтому покупатель незаметно перейдёт на /flex.'
                  : 'Корзина и резерв сохраняются при автоматическом fallback.'}
              </small>
            </div>
            <button
              type="button"
              className={`payment-mode-switch ${payments.mode.widgetEnabled ? 'is-on' : ''}`}
              role="switch"
              aria-checked={payments.mode.widgetEnabled}
              aria-label="Использовать Forte Widget для новых оплат"
              disabled={!payments.canManage || Boolean(action)}
              onClick={() => void updateWidgetMode()}
            >
              <span aria-hidden="true" />
              {action === 'mode'
                ? 'Сохраняем…'
                : payments.mode.widgetEnabled
                  ? 'Widget включён'
                  : 'Widget выключен'}
            </button>
          </div>

          {actionMessage && (
            <div className="payment-action-message" role="status" aria-live="polite">
              {actionMessage}
            </div>
          )}

          <div className="payment-provider-grid">
            {payments.providers.kaspi.enabled && (
              <ProviderCard
                name="Kaspi Pay"
                provider={payments.providers.kaspi}
                formatDate={formatDate}
              />
            )}
            <ProviderCard
              name="Forte /flex"
              provider={payments.providers.forteHosted}
              formatDate={formatDate}
            />
            <ProviderCard
              name="Forte Widget"
              provider={payments.providers.forteWidget}
              formatDate={formatDate}
            />
          </div>

          <div className="payment-operations-grid">
            <article className="payment-operation-card">
              <header>
                <Webhook aria-hidden="true" size={19} />
                <h4>Webhook</h4>
              </header>
              {payments.providers.kaspi.enabled && (
                <WebhookStatus
                  name="Kaspi Pay"
                  webhook={payments.webhooks.kaspi}
                  formatDate={formatDate}
                />
              )}
              <WebhookStatus
                name="Forte Widget"
                webhook={payments.webhooks.forteWidget}
                formatDate={formatDate}
              />
            </article>

            <article className="payment-operation-card">
              <header>
                <Clock3 aria-hidden="true" size={19} />
                <h4>Неоплаченные заказы</h4>
              </header>
              <strong className="payment-cleanup-result">
                Отменено: {payments.cleanup.cancelled} · резервов освобождено:{' '}
                {payments.cleanup.released}
              </strong>
              <p>
                Просроченные оплаты закрываются после сверки с банком. Оплаченные заказы не
                затрагиваются.
              </p>
              <small>
                {payments.cleanup.checkedAt
                  ? `Последний запуск: ${formatDate(payments.cleanup.checkedAt, {
                      dateStyle: 'short',
                      timeStyle: 'short',
                    })}`
                  : 'Фоновая очистка ещё не запускалась'}
              </small>
            </article>

            <article className="payment-operation-card payment-probe-card">
              <header>
                <ShieldCheck aria-hidden="true" size={19} />
                <h4>Безопасная проверка</h4>
              </header>
              <p>
                Создаёт временную проверку 0 ₸. Деньги не списываются, заказ Bulka не оформляется.
              </p>
              <button
                type="button"
                className="btn-outline"
                disabled={!payments.canManage || Boolean(action)}
                onClick={() => void runPaymentProbe()}
              >
                <RefreshCw
                  aria-hidden="true"
                  className={action === 'probe' ? 'spin' : ''}
                  size={17}
                />
                {action === 'probe' ? 'Проверяем…' : 'Запустить проверку'}
              </button>
              {!payments.canManage && <small>Доступно владельцу и администратору.</small>}
            </article>
          </div>

          <div className="payment-error-section">
            <div>
              <h4>Последние ошибки</h4>
              <span>{payments.latestErrors.length}</span>
            </div>
            {payments.latestErrors.length ? (
              <ul>
                {payments.latestErrors.map((item) => (
                  <li key={`${item.id}:${item.occurredAt || ''}`}>
                    <span className="payment-error-mark">
                      <AlertTriangle aria-hidden="true" size={16} />
                    </span>
                    <div>
                      <strong>
                        {item.provider}
                        {item.orderNumber ? ` · заказ №${item.orderNumber}` : ''}
                      </strong>
                      <p>{item.message}</p>
                    </div>
                    {item.occurredAt && (
                      <time dateTime={item.occurredAt}>
                        {formatDate(item.occurredAt, {
                          dateStyle: 'short',
                          timeStyle: 'short',
                        })}
                      </time>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="payment-errors-empty">
                <CheckCircle2 aria-hidden="true" size={17} />
                Ошибок оплаты нет
              </p>
            )}
          </div>
        </section>
      )}

      <section className="integration-health-grid">
        {visibleServices.map((service) => {
          const Icon =
            service.state === 'healthy'
              ? CheckCircle2
              : service.state === 'disabled'
                ? CircleOff
                : service.state === 'attention'
                  ? AlertTriangle
                  : XCircle;
          return (
            <article
              className={`card integration-health-card state-${service.state}`}
              key={service.id}
            >
              <header>
                <span className="integration-health-icon">
                  <Icon aria-hidden="true" size={21} />
                </span>
                <span className={`status-pill integration-state-${service.state}`}>
                  {stateCopy[service.state]}
                </span>
              </header>
              <h3>{service.name}</h3>
              <p>{service.summary}</p>
              {service.detail && <small>{service.detail}</small>}
              {service.updatedAt && (
                <time dateTime={service.updatedAt}>
                  Последнее обновление: {formatDate(service.updatedAt)}
                </time>
              )}
            </article>
          );
        })}
      </section>

      {checkedAt && <p className="operations-updated">Проверено: {formatDate(checkedAt)}</p>}
    </div>
  );
}

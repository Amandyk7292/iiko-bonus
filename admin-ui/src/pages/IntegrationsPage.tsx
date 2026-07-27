import {
  AlertTriangle,
  CheckCircle2,
  CircleOff,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import PageState from '../components/PageState';
import { api, type IntegrationHealthService } from '../lib/api';
import { useI18n } from '../lib/i18n';

const stateCopy = {
  healthy: 'Работает',
  attention: 'Нужно внимание',
  error: 'Ошибка настройки',
  disabled: 'Выключено',
};

export default function IntegrationsPage() {
  const { formatDate } = useI18n();
  const [services, setServices] = useState<IntegrationHealthService[]>([]);
  const [checkedAt, setCheckedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await api.getIntegrationHealth();
      setServices(response.services);
      setCheckedAt(response.checkedAt);
      setError('');
    } catch (caught) {
      if (!silent) setError(caught instanceof Error ? caught.message : 'Не удалось проверить сервисы');
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

  if (loading && !services.length) {
    return <PageState type="loading" title="Проверяем подключённые сервисы" />;
  }
  if (error && !services.length) {
    return <PageState type="error" description={error} onRetry={load} />;
  }

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
          <RefreshCw className={loading ? 'spin' : ''} size={17} />
          Проверить
        </button>
      </div>

      {error && <div className="inline-alert inline-alert-error">{error}</div>}

      <section className="integration-health-grid">
        {services.map((service) => {
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
                <time dateTime={service.updatedAt}>Последнее обновление: {formatDate(service.updatedAt)}</time>
              )}
            </article>
          );
        })}
      </section>

      {checkedAt && <p className="operations-updated">Проверено: {formatDate(checkedAt)}</p>}
    </div>
  );
}

import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Headphones,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Search,
  Send,
  UserCheck,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from '../lib/router';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import {
  api,
  type SupportMessage,
  type SupportRequest,
} from '../lib/api';
import { useAdminRealtimeEvents } from '../lib/admin-realtime';
import { useI18n } from '../lib/i18n';
import {
  canCloseSupportRequest,
  CLOSED_SUPPORT_STATUSES,
  publicSupportDraft,
} from '../lib/support';

const queueTabs = [
  { value: 'new', label: 'Новые' },
  { value: 'mine', label: 'Мои' },
  { value: 'overdue', label: 'Просроченные' },
  { value: 'closed', label: 'Закрытые' },
  { value: 'all', label: 'Все' },
];

const statusLabels: Record<string, string> = {
  new: 'Новое',
  in_review: 'В работе',
  resolved: 'Решено',
  rejected: 'Закрыто',
};

const priorityLabels: Record<string, string> = {
  low: 'Низкий',
  normal: 'Обычный',
  high: 'Высокий',
  urgent: 'Срочный',
};

const categoryLabels: Record<string, string> = {
  order_issue: 'Проблема с заказом',
  product_quality: 'Качество продукта',
  delivery: 'Доставка',
  refund: 'Возврат',
  other: 'Другой вопрос',
};

function slaText(request: SupportRequest) {
  if (!request.dueAt || ['resolved', 'rejected'].includes(request.status)) return 'SLA завершён';
  const minutes = Math.round((Date.parse(request.dueAt) - Date.now()) / 60_000);
  if (minutes < 0) return `Просрочено на ${Math.max(1, Math.abs(minutes))} мин.`;
  if (minutes < 60) return `Осталось ${minutes} мин.`;
  return `Осталось ${Math.ceil(minutes / 60)} ч.`;
}

export default function SupportPage() {
  const { formatDate } = useI18n();
  const { toast } = useFeedback();
  const [params, setParams] = useSearchParams();
  const queue = params.get('queue') || 'new';
  const status = params.get('status') || '';
  const priority = params.get('priority') || '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const selectedId = params.get('request') || '';
  const [search, setSearch] = useState(params.get('search') || '');
  const [requests, setRequests] = useState<SupportRequest[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<SupportRequest | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const pageSize = 30;

  const updateParams = useCallback(
    (updates: Record<string, string | number | null>) => {
      const next = new URLSearchParams(params);
      for (const [key, value] of Object.entries(updates)) {
        if (value === null || value === '' || value === 'all') next.delete(key);
        else next.set(key, String(value));
      }
      setParams(next, { replace: true });
    },
    [params, setParams],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const current = params.get('search') || '';
      if (search.trim() !== current) updateParams({ search: search.trim(), page: null });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [params, search, updateParams]);

  const loadList = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        const response = await api.getSupportRequests({
          queue: queue === 'all' ? '' : queue,
          status,
          priority,
          search: params.get('search') || '',
          page,
          pageSize,
        });
        setRequests(response.requests);
        setTotal(response.total);
        setError('');
      } catch (caught) {
        if (!silent) {
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить обращения');
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [page, params, priority, queue, status],
  );

  const loadDetail = useCallback(async (id: string, silent = false) => {
    if (!id) {
      setDetail(null);
      setMessages([]);
      return;
    }
    if (!silent) setDetailLoading(true);
    try {
      const response = await api.getSupportRequest(id);
      setDetail(response.request);
      setMessages(response.messages);
    } catch (caught) {
      if (!silent) {
        setError(caught instanceof Error ? caught.message : 'Не удалось открыть обращение');
      }
    } finally {
      if (!silent) setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    void loadDetail(selectedId);
  }, [loadDetail, selectedId]);

  useAdminRealtimeEvents(
    ['support.created', 'support.updated'],
    (event) => {
      void loadList(true);
      if (selectedId && String(event.data.requestId || '') === selectedId) {
        void loadDetail(selectedId, true);
      }
    },
    [loadList, loadDetail, selectedId],
  );

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const selectedFromList = useMemo(
    () => requests.find((request) => request.id === selectedId),
    [requests, selectedId],
  );

  const refreshDetail = async (response: {
    request: SupportRequest;
    messages?: SupportMessage[];
  }) => {
    setDetail(response.request);
    if (response.messages) setMessages(response.messages);
    await loadList(true);
  };

  const claim = async () => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      const response = await api.updateSupportRequest(detail.id, { assignToMe: true });
      await refreshDetail({ request: response.request });
      await loadDetail(detail.id, true);
      toast('Обращение назначено вам');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось назначить обращение', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changePriority = async (nextPriority: string) => {
    if (!detail || saving) return;
    setSaving(true);
    try {
      const response = await api.updateSupportRequest(detail.id, { priority: nextPriority });
      await refreshDetail({ request: response.request });
      toast('Приоритет обновлён');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось изменить приоритет', 'error');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (nextStatus: string) => {
    if (!detail || saving) return;
    const closing =
      CLOSED_SUPPORT_STATUSES.has(nextStatus) &&
      !CLOSED_SUPPORT_STATUSES.has(detail.status);
    const resolution = closing ? publicSupportDraft(reply, internal) : '';
    if (closing && !canCloseSupportRequest(messages, reply, internal)) {
      toast(
        internal && reply.trim()
          ? 'Внутренняя заметка не считается ответом клиенту'
          : 'Перед закрытием ответьте на последнее сообщение клиента',
        'error',
      );
      return;
    }
    setSaving(true);
    try {
      const response = await api.updateSupportRequest(detail.id, {
        status: nextStatus,
        resolution: resolution || undefined,
      });
      if (resolution) {
        setReply('');
        setInternal(false);
      }
      await refreshDetail({ request: response.request });
      await loadDetail(detail.id, true);
      toast('Статус обновлён');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось изменить статус', 'error');
    } finally {
      setSaving(false);
    }
  };

  const sendMessage = async () => {
    if (!detail || !reply.trim() || saving) return;
    setSaving(true);
    try {
      const response = await api.sendSupportMessage(detail.id, reply.trim(), internal);
      setReply('');
      setInternal(false);
      await refreshDetail(response);
      toast(internal ? 'Внутренняя заметка сохранена' : 'Ответ отправлен клиенту');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : 'Не удалось отправить ответ', 'error');
    } finally {
      setSaving(false);
    }
  };

  if (loading && !requests.length) {
    return <PageState type="loading" title="Загружаем очередь поддержки" />;
  }
  if (error && !requests.length && !selectedId) {
    return <PageState type="error" description={error} onRetry={loadList} />;
  }

  return (
    <div className="page-stack support-page">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">Очередь обращений</h2>
          <p className="page-help">
            Назначайте ответственного, контролируйте срок ответа и ведите переписку с клиентом.
          </p>
        </div>
        <button
          type="button"
          className="btn-outline px-4 inline-flex items-center gap-2"
          onClick={() => {
            void loadList();
            if (selectedId) void loadDetail(selectedId);
          }}
        >
          <RefreshCw aria-hidden="true" size={17} />
          Обновить
        </button>
      </div>

      <div className="support-queue-tabs" role="tablist" aria-label="Очереди поддержки">
        {queueTabs.map((tab) => (
          <button
            type="button"
            role="tab"
            aria-selected={queue === tab.value}
            className={queue === tab.value ? 'is-active' : ''}
            key={tab.value}
            onClick={() => updateParams({ queue: tab.value, page: null })}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="sagi-filter support-filter">
        <div className="field-group filter-search">
          <label className="field-label" htmlFor="support-search">
            Поиск
          </label>
          <div className="input-with-icon">
            <Search aria-hidden="true" size={18} />
            <input
              id="support-search"
              className="input-classic"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Номер заказа или текст обращения"
            />
          </div>
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="support-status">
            Статус
          </label>
          <SelectControl
            compact
            id="support-status"
            value={status}
            onChange={(value) => updateParams({ status: value, page: null })}
            options={[
              { value: '', label: 'Все статусы' },
              ...Object.entries(statusLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
        <div className="field-group">
          <label className="field-label" htmlFor="support-priority">
            Приоритет
          </label>
          <SelectControl
            compact
            id="support-priority"
            value={priority}
            onChange={(value) => updateParams({ priority: value, page: null })}
            options={[
              { value: '', label: 'Все приоритеты' },
              ...Object.entries(priorityLabels).map(([value, label]) => ({ value, label })),
            ]}
          />
        </div>
      </section>

      {error && <div className="inline-alert inline-alert-error">{error}</div>}

      <div className="support-workspace">
        <section className="card support-queue-panel">
          <header className="support-queue-header">
            <div>
              <h3>Обращения</h3>
              <p>{total} в выбранной очереди</p>
            </div>
          </header>
          {requests.length ? (
            <div className="support-request-list">
              {requests.map((request) => (
                <button
                  type="button"
                  className={`${request.id === selectedId ? 'is-selected' : ''} ${request.overdue ? 'is-overdue' : ''}`}
                  key={request.id}
                  onClick={() => updateParams({ request: request.id })}
                >
                  <span className="support-request-topline">
                    <strong>{request.customer?.name || 'Клиент Bulka'}</strong>
                    <time dateTime={request.lastMessageAt}>{formatDate(request.lastMessageAt)}</time>
                  </span>
                  <span className="support-request-meta">
                    {request.orderNumber ? `Заказ №${request.orderNumber}` : 'Общий вопрос'}
                    <span>·</span>
                    {categoryLabels[request.category] || request.category}
                  </span>
                  <span className="support-request-preview">{request.preview}</span>
                  <span className="support-request-footer">
                    <span className={`priority-pill priority-${request.priority}`}>
                      {priorityLabels[request.priority]}
                    </span>
                    <span className={request.overdue ? 'support-sla overdue' : 'support-sla'}>
                      <Clock3 size={14} />
                      {slaText(request)}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <PageState type="empty" title="В этой очереди обращений нет" compact />
          )}
          {totalPages > 1 && (
            <div className="table-pagination">
              <button
                type="button"
                className="btn-outline px-4"
                disabled={page <= 1}
                onClick={() => updateParams({ page: page - 1 })}
              >
                Назад
              </button>
              <span>
                {page} / {totalPages}
              </span>
              <button
                type="button"
                className="btn-outline px-4"
                disabled={page >= totalPages}
                onClick={() => updateParams({ page: page + 1 })}
              >
                Далее
              </button>
            </div>
          )}
        </section>

        <section className="card support-detail-panel">
          {detailLoading ? (
            <PageState type="loading" title="Открываем обращение" compact />
          ) : detail ? (
            <>
              <header className="support-detail-header">
                <div>
                  <span className="support-detail-eyebrow">
                    <Headphones size={16} />
                    {categoryLabels[detail.category] || detail.category}
                  </span>
                  <h3>{detail.customer?.name || 'Клиент Bulka'}</h3>
                  <p>
                    {detail.customer?.phone || 'Телефон не указан'}
                    {detail.orderNumber ? ` · Заказ №${detail.orderNumber}` : ''}
                    {detail.branch ? ` · ${detail.branch}` : ''}
                  </p>
                </div>
                <span
                  className={`status-pill ${detail.overdue ? 'status-danger' : 'status-info'}`}
                >
                  {detail.overdue ? 'SLA нарушен' : statusLabels[detail.status]}
                </span>
              </header>

              {detail.refundRequested && (
                <div className="inline-alert inline-alert-warning">
                  <AlertTriangle size={17} />
                  Клиент запросил возврат по оплаченному заказу.
                </div>
              )}

              <div className="support-controls">
                <div className="field-group">
                  <label className="field-label">Приоритет</label>
                  <SelectControl
                    compact
                    value={detail.priority}
                    disabled={saving}
                    onChange={(value) => void changePriority(value)}
                    options={Object.entries(priorityLabels).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label">Статус</label>
                  <SelectControl
                    compact
                    value={detail.status}
                    disabled={saving}
                    onChange={(value) => void changeStatus(value)}
                    options={Object.entries(statusLabels).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </div>
                <button
                  type="button"
                  className="btn-outline inline-flex items-center gap-2 px-4"
                  disabled={saving}
                  onClick={() => void claim()}
                >
                  <UserCheck size={17} />
                  {detail.assignedTo ? `Ответственный: ${detail.assignedTo}` : 'Взять в работу'}
                </button>
              </div>

              <div className="support-thread" aria-label="Переписка по обращению">
                {messages.map((message) => (
                  <article
                    className={`support-message sender-${message.senderType} ${message.internal ? 'is-internal' : ''}`}
                    key={message.id}
                  >
                    <header>
                      <strong>
                        {message.internal
                          ? 'Внутренняя заметка'
                          : message.senderType === 'customer'
                            ? detail.customer?.name || 'Клиент'
                            : message.senderId || 'Команда Bulka'}
                      </strong>
                      <time dateTime={message.createdAt}>{formatDate(message.createdAt)}</time>
                    </header>
                    <p>{message.body}</p>
                    {message.attachments.length > 0 && (
                      <div className="row-actions">
                        {message.attachments.map((attachment, index) => (
                          <a
                            href={attachment.url || '#'}
                            target="_blank"
                            rel="noreferrer"
                            className="btn-outline px-3 inline-flex items-center gap-2"
                            key={attachment.path}
                          >
                            <ImageIcon size={15} />
                            Фото {index + 1}
                            <ExternalLink size={13} />
                          </a>
                        ))}
                      </div>
                    )}
                  </article>
                ))}
              </div>

              <div className="support-composer">
                <label className="field-label" htmlFor="support-reply">
                  {internal ? 'Внутренняя заметка' : 'Ответ клиенту'}
                </label>
                <textarea
                  id="support-reply"
                  className="input-classic"
                  rows={4}
                  maxLength={4000}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder={
                    internal
                      ? 'Эту заметку увидят только сотрудники'
                      : 'Напишите понятный ответ клиенту'
                  }
                />
                <div className="support-composer-actions">
                  <label className="toggle-row support-internal-toggle">
                    <input
                      type="checkbox"
                      checked={internal}
                      onChange={(event) => setInternal(event.target.checked)}
                    />
                    <span>Только для сотрудников</span>
                  </label>
                  <button
                    type="button"
                    className="btn-classic inline-flex items-center gap-2 px-5"
                    disabled={saving || !reply.trim()}
                    onClick={() => void sendMessage()}
                  >
                    {saving ? (
                      <LoaderCircle className="spin" size={17} />
                    ) : internal ? (
                      <CheckCircle2 size={17} />
                    ) : (
                      <Send size={17} />
                    )}
                    {internal ? 'Сохранить заметку' : 'Отправить ответ'}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <PageState
              type="empty"
              title={selectedFromList ? 'Открываем обращение' : 'Выберите обращение'}
              description="Переписка и действия появятся здесь."
              compact
            />
          )}
        </section>
      </div>
    </div>
  );
}

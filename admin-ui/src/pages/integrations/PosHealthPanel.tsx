import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  MonitorSmartphone,
  Printer,
  RefreshCw,
  RotateCcw,
  ServerCog,
  ShieldAlert,
  XCircle,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import Modal from '../../components/Modal';
import { api, type PosHealthResponse, type PosReconciliationCase } from '../../lib/api';

const queueLabels: Record<string, string> = {
  loyaltyPending: 'Бонусы',
  loyaltyFailed: 'Ошибки бонусов',
  giftPending: 'Сертификаты',
  giftFailed: 'Ошибки сертификатов',
  offlineReceipts: 'Офлайн-чеки',
  stockPending: 'Остатки',
  automaticReceipts: 'Онлайн-чеки',
  personalAccountPending: 'Личный счёт',
};
const caseKindLabels: Record<string, string> = {
  personal_account: 'Личный счёт',
  front_receipt: 'Кассовый чек',
  assembly_print: 'Сборочный чек',
  loyalty_queue: 'Бонусы',
  offline_receipt: 'Офлайн-чек',
  stock_sync: 'Остатки',
  plugin_health: 'Плагин',
};
const relativeTime = (value?: string | null) => {
  const milliseconds = Date.now() - (Date.parse(value || '') || 0);
  const minutes = Math.floor(milliseconds / 60_000);
  if (!Number.isFinite(minutes) || minutes < 1) return 'только что';
  if (minutes < 60) return `${minutes} мин назад`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} ч назад` : `${Math.floor(hours / 24)} дн назад`;
};

export default function PosHealthPanel({
  data,
  reload,
}: {
  data: PosHealthResponse;
  reload: () => Promise<void>;
}) {
  const [policy, setPolicy] = useState(data.policy);
  const [saving, setSaving] = useState(false);
  const [caseFilter, setCaseFilter] = useState<'open' | 'history'>('open');
  const [actionCase, setActionCase] = useState<PosReconciliationCase | null>(null);
  const [actionType, setActionType] = useState<'retry' | 'close' | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  useEffect(() => setPolicy(data.policy), [data.policy]);
  const visibleCases = useMemo(
    () =>
      data.cases.filter((item) =>
        caseFilter === 'open'
          ? ['open', 'retrying'].includes(item.status)
          : ['resolved', 'manual_closed'].includes(item.status),
      ),
    [caseFilter, data.cases],
  );

  const savePolicy = async () => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      const response = await api.savePosPluginPolicy(policy);
      setPolicy(response.policy);
      setMessage('Политика версий сохранена.');
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось сохранить версии');
    } finally {
      setSaving(false);
    }
  };
  const runAction = async (
    item: PosReconciliationCase,
    action: 'retry' | 'check' | 'close',
    actionReason?: string,
  ) => {
    if (saving) return;
    setSaving(true);
    setMessage('');
    try {
      await api.actOnPosReconciliation(item.id, action, actionReason);
      setActionCase(null);
      setActionType(null);
      setReason('');
      setMessage(
        action === 'retry'
          ? 'Повтор запрошен.'
          : action === 'close'
            ? 'Сверка закрыта вручную.'
            : 'Состояние проверено.',
      );
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Действие не выполнено');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="pos-health" aria-labelledby="pos-health-title">
      <header className="pos-health-heading">
        <div>
          <span className="payment-section-icon">
            <MonitorSmartphone size={21} />
          </span>
          <div>
            <h3 id="pos-health-title">Кассы и плагины</h3>
            <p>Связь, принтеры, версии и локальные очереди всех филиалов.</p>
          </div>
        </div>
        <button
          className="btn-outline"
          type="button"
          onClick={() => void reload()}
          disabled={saving}
        >
          <RefreshCw size={17} /> Обновить
        </button>
      </header>
      <div className="pos-health-metrics" aria-label="Сводка касс">
        {(
          [
            ['Всего касс', data.summary.total, ServerCog],
            ['На связи', data.summary.online, CheckCircle2],
            ['Нужно внимание', data.summary.attention, AlertTriangle],
            ['Устарели', data.summary.outdated, ShieldAlert],
            ['Открытые сверки', data.summary.openCases, Clock3],
          ] as const
        ).map(([label, value, Icon]) => (
          <article key={label}>
            <Icon size={18} />
            <span>{label}</span>
            <strong>{value}</strong>
          </article>
        ))}
      </div>
      <section className="card pos-version-policy">
        <header>
          <div>
            <h4>Управление версиями плагина</h4>
            <p>Сначала обновите кассы, затем включите запрет старых версий.</p>
          </div>
          <div className="action-cluster">
            <a className="btn-outline" href={policy.downloadUrl} download>
              <Download size={16} /> Скачать обновление
            </a>
            <a className="btn-outline" href={policy.guideUrl} target="_blank" rel="noreferrer">
              <ExternalLink size={16} /> Инструкция
            </a>
          </div>
        </header>
        <div className="form-grid form-grid-2">
          <label className="field-group">
            <span className="field-label">Последняя версия</span>
            <input
              className="input-classic"
              value={policy.latestVersion}
              onChange={(event) => setPolicy({ ...policy, latestVersion: event.target.value })}
            />
          </label>
          <label className="field-group">
            <span className="field-label">Минимальная совместимая версия</span>
            <input
              className="input-classic"
              value={policy.minimumVersion}
              onChange={(event) => setPolicy({ ...policy, minimumVersion: event.target.value })}
            />
          </label>
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={policy.enforceMinimum}
            disabled={!data.canManage}
            onChange={(event) => setPolicy({ ...policy, enforceMinimum: event.target.checked })}
          />
          <span className="switch-control" />
          <span>Запрещать финансовые и складские операции устаревшему плагину</span>
        </label>
        {data.canManage && (
          <button
            className="btn-classic"
            type="button"
            disabled={saving}
            onClick={() => void savePolicy()}
          >
            {saving ? 'Сохраняем…' : 'Сохранить версии'}
          </button>
        )}
      </section>
      {message && (
        <div className="inline-alert inline-alert-info" role="status">
          {message}
        </div>
      )}
      <div className="pos-device-grid">
        {data.devices.map((device) => {
          const queues = Object.entries(device.queues).filter(([, count]) => Number(count) > 0);
          return (
            <article className={`card pos-device-card state-${device.health}`} key={device.id}>
              <header>
                <div>
                  <strong>{device.name}</strong>
                  <span>
                    {device.branch?.name || 'Филиал не найден'} · {device.branch?.city || '—'}
                  </span>
                </div>
                <span
                  className={`status-pill integration-state-${device.online ? device.health : 'error'}`}
                >
                  {device.online ? 'На связи' : 'Нет связи'}
                </span>
              </header>
              <dl>
                <div>
                  <dt>Плагин</dt>
                  <dd>
                    {device.pluginVersion || 'Не сообщил'}
                    {device.outdated ? ' · устарел' : ''}
                  </dd>
                </div>
                <div>
                  <dt>iiko API</dt>
                  <dd>{device.apiVersion || '—'}</dd>
                </div>
                <div>
                  <dt>Главная касса</dt>
                  <dd>{device.connectedToMain ? 'Связь есть' : 'Нет связи'}</dd>
                </div>
                <div>
                  <dt>Принтер</dt>
                  <dd>
                    <Printer size={15} />{' '}
                    {device.printerStatus === 'ready' ? 'Готов' : 'Нужна настройка'}
                  </dd>
                </div>
              </dl>
              {queues.length > 0 && (
                <div className="pos-queue-list">
                  {queues.map(([key, count]) => (
                    <span key={key}>
                      {queueLabels[key] || key}: {count}
                    </span>
                  ))}
                </div>
              )}
              {device.lastError && <p className="pos-device-error">{device.lastError}</p>}
              <small>Последняя связь: {relativeTime(device.lastSeenAt)}</small>
            </article>
          );
        })}
      </div>
      <section className="card pos-reconciliation">
        <header>
          <div>
            <h4>Сверка проблемных операций</h4>
            <p>Повтор использует исходный идентификатор и не создаёт новое списание.</p>
          </div>
          <div className="segmented-control" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={caseFilter === 'open'}
              onClick={() => setCaseFilter('open')}
            >
              Открытые
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={caseFilter === 'history'}
              onClick={() => setCaseFilter('history')}
            >
              История
            </button>
          </div>
        </header>
        {visibleCases.length === 0 ? (
          <div className="pos-reconciliation-empty">
            <CheckCircle2 size={22} /> Операций для сверки нет
          </div>
        ) : (
          <div className="pos-case-list">
            {visibleCases.map((item) => (
              <article className={`pos-case severity-${item.severity}`} key={item.id}>
                <div className="pos-case-main">
                  <span>{caseKindLabels[item.kind] || item.kind}</span>
                  <strong>{item.title}</strong>
                  <p>{item.details}</p>
                  <small>
                    {relativeTime(item.last_seen_at)} · попыток: {item.attempts}
                  </small>
                  {item.resolution_note && <small>Результат: {item.resolution_note}</small>}
                </div>
                {caseFilter === 'open' && data.canManage && (
                  <div className="pos-case-actions">
                    <button
                      className="btn-outline"
                      type="button"
                      disabled={saving}
                      onClick={() => void runAction(item, 'check')}
                    >
                      <RefreshCw size={15} /> Проверить
                    </button>
                    <button
                      className="btn-outline"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setActionCase(item);
                        setActionType('retry');
                        setReason('');
                      }}
                    >
                      <RotateCcw size={15} /> Повторить
                    </button>
                    <button
                      className="btn-danger-outline"
                      type="button"
                      disabled={saving}
                      onClick={() => {
                        setActionCase(item);
                        setActionType('close');
                        setReason('');
                      }}
                    >
                      <XCircle size={15} /> Закрыть после сверки
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
      <Modal
        open={Boolean(actionCase && actionType)}
        title={actionType === 'retry' ? 'Повторить операцию?' : 'Закрыть после ручной сверки?'}
        description={actionCase?.title}
        onClose={() => !saving && setActionCase(null)}
        size="sm"
      >
        <div className="modal-body form-stack">
          <div className="inline-alert inline-alert-warning">
            {actionType === 'retry' && actionCase?.kind === 'assembly_print'
              ? 'Перед повтором проверьте бумагу: первый экземпляр мог быть напечатан.'
              : actionType === 'retry'
                ? 'Будет повторена та же операция с прежним идентификатором.'
                : 'Закрывайте запись только после проверки чека, оплаты и остатков.'}
          </div>
          <label className="field-group">
            <span className="field-label">
              Комментарий {actionType === 'close' ? '(обязательно)' : ''}
            </span>
            <textarea
              className="input-classic"
              rows={3}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </label>
          <div className="modal-actions">
            <button className="btn-outline" type="button" onClick={() => setActionCase(null)}>
              Отмена
            </button>
            <button
              className={actionType === 'close' ? 'btn-danger' : 'btn-classic'}
              type="button"
              disabled={saving || (actionType === 'close' && reason.trim().length < 3)}
              onClick={() =>
                actionCase &&
                actionType &&
                void runAction(actionCase, actionType, reason.trim() || undefined)
              }
            >
              {saving ? 'Выполняем…' : actionType === 'retry' ? 'Повторить' : 'Закрыть сверку'}
            </button>
          </div>
        </div>
      </Modal>
    </section>
  );
}

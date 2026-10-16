import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, Clock, CircleOff, AlertCircle } from '../../components/BulkaIcons';
import { useFeedback } from '../../components/Feedback';
import Modal from '../../components/Modal';
import PageState from '../../components/PageState';
import { roundsApi } from './api';
import { evidenceLabels, safeMediaUrl, statusLabels, timeLabel } from './model';
import type { Evidence, RoundDetail, RoundSummary } from './types';
import { useAutoRefresh } from './useAutoRefresh';

export function Status({ round }: { round: Pick<RoundSummary, 'status' | 'completedLate'> }) {
  const Icon =
    round.status === 'completed'
      ? CheckCircle2
      : round.status === 'overdue'
        ? AlertCircle
        : round.status === 'cancelled'
          ? CircleOff
          : Clock;
  return (
    <span className={`rounds-status rounds-status-${round.status}`}>
      <Icon size={16} />
      {statusLabels[round.status]}
      {round.status === 'completed' && round.completedLate ? ' · с опозданием' : ''}
    </span>
  );
}

function Media({ evidence, title }: { evidence: Evidence; title: string }) {
  const [failed, setFailed] = useState(false);
  const url = safeMediaUrl(evidence.url);
  if (!url || failed) return <p className="rounds-media-unavailable">Вложение недоступно</p>;
  return evidence.kind === 'video' ? (
    <video
      controls
      playsInline
      preload="metadata"
      aria-label={`Видео: ${title}`}
      onError={() => setFailed(true)}
    >
      <source src={url} type={evidence.mime} />
      Видео не поддерживается браузером.
    </video>
  ) : (
    <a href={url} target="_blank" rel="noopener noreferrer" aria-label={`Открыть фото: ${title}`}>
      <img src={url} alt={`Фото: ${title}`} loading="lazy" onError={() => setFailed(true)} />
    </a>
  );
}

export default function RoundDetails({
  id,
  onClose,
  onChanged,
}: {
  id: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [round, setRound] = useState<RoundDetail>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const loadedId = useRef('');
  useAutoRefresh(() => setTick((value) => value + 1));
  const { confirm, toast } = useFeedback();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(loadedId.current !== id);
    setError('');
    if (loadedId.current !== id) setRound(undefined);
    roundsApi
      .detail(id, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) {
          loadedId.current = id;
          setRound(result.round);
        }
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить обход.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, tick]);
  const cancel = async () => {
    if (!round || busy || ['completed', 'cancelled'].includes(round.status)) return;
    if (
      !(await confirm({
        title: 'Отменить обход?',
        body: 'Задачи этого обхода больше не будут доступны сотруднику.',
        confirmLabel: 'Отменить обход',
        destructive: true,
      }))
    )
      return;
    setBusy(true);
    setError('');
    try {
      await roundsApi.cancel(id);
      toast('Обход отменён.', 'success');
      onChanged();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Не удалось отменить обход.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open title={round?.title || 'Обход точки'} onClose={() => !busy && onClose()} size="lg">
      <div className="rounds-detail">
        {loading ? (
          <PageState type="loading" compact />
        ) : !round ? (
          <PageState
            type="error"
            description={error}
            onRetry={() => setTick((value) => value + 1)}
            compact
          />
        ) : (
          <>
            <div className="rounds-detail-summary">
              <div>
                <strong>{round.branchName}</strong>
                <p>
                  {round.inspectorName} · {round.city}
                </p>
              </div>
              <Status round={round} />
            </div>
            <dl className="rounds-detail-dates">
              <div>
                <dt>Выполнить до</dt>
                <dd>{timeLabel(round.deadline)}</dd>
              </div>
              <div>
                <dt>Задачи</dt>
                <dd>
                  {round.completedTasks} / {round.totalTasks}
                </dd>
              </div>
              {round.completedAt && (
                <div>
                  <dt>Завершён</dt>
                  <dd>{timeLabel(round.completedAt)}</dd>
                </div>
              )}
            </dl>
            {[...round.tasks]
              .sort((a, b) => a.position - b.position)
              .map((task, index) => (
                <section
                  className={`rounds-report-task ${task.completedAt ? 'is-completed' : ''}`}
                  key={task.id}
                >
                  <div className="rounds-report-task-heading">
                    <h3>
                      {index + 1}. {task.title}
                    </h3>
                    <span>
                      {task.completedAt ? (
                        <>
                          <CheckCircle2 size={17} />
                          Выполнено
                        </>
                      ) : (
                        'Не выполнено'
                      )}
                    </span>
                  </div>
                  {task.instructions && (
                    <p className="rounds-task-instructions">{task.instructions}</p>
                  )}
                  <small>
                    {evidenceLabels[task.evidenceType]}
                    {task.completedAt ? ` · ${timeLabel(task.completedAt)}` : ''}
                  </small>
                  {task.comment && <p className="rounds-report-comment">{task.comment}</p>}
                  {task.evidence.length > 0 && (
                    <div className="rounds-media">
                      {task.evidence.map((evidence) => (
                        <Media key={evidence.id} evidence={evidence} title={task.title} />
                      ))}
                    </div>
                  )}
                </section>
              ))}
            {error && (
              <p className="rounds-error" role="alert">
                {error}
              </p>
            )}
            <div className="rounds-form-actions">
              <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>
                Закрыть
              </button>
              {!['completed', 'cancelled'].includes(round.status) && (
                <button
                  type="button"
                  className="rounds-danger-button"
                  onClick={() => void cancel()}
                  disabled={busy}
                >
                  {busy ? 'Отменяем…' : 'Отменить обход'}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

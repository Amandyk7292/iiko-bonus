import { useEffect, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import PageState from '../../components/PageState';
import { useFeedback } from '../../components/Feedback';
import { useI18n } from '../../lib/i18n';
import { Field, winnerStatus } from './Fields';
import { loadWinners, redeemWinner } from './api';
import type { Campaign, Winner, Winners } from './model';

export default function WinnersPanel({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const { locale, formatDate, formatNumber } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const { confirm, toast } = useFeedback();
  const [data, setData] = useState<Winners | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(true),
    [status, setStatus] = useState(''),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [busy, setBusy] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    void loadWinners(campaign.id, page, status, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((caught) => {
        if (!controller.signal.aborted)
          setError(caught instanceof Error ? caught.message : 'Не удалось загрузить выигрыши.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [campaign.id, page, status, revision]);
  const redeem = async (winner: Winner) => {
    if (busy || winner.status !== 'claimed' || winner.prizeKind !== 'gift') return;
    if (
      !(await confirm({
        title: text('Выдать приз?', 'Сыйлықты беру керек пе?'),
        body: `${winner.customerName || winner.customerPhone || text('Клиент', 'Клиент')} · ${winner.prizeLabel}`,
        confirmLabel: text('Приз выдан', 'Сыйлық берілді'),
      }))
    )
      return;
    setBusy(winner.id);
    try {
      await redeemWinner(winner.id);
      toast(text('Выдача приза сохранена', 'Сыйлық беру сақталды'));
      setRevision((current) => current + 1);
    } catch (caught) {
      toast(
        caught instanceof Error
          ? caught.message
          : text('Не удалось выдать приз.', 'Сыйлық берілмеді.'),
        'error',
      );
    } finally {
      setBusy('');
    }
  };
  const canNext = data ? page * 50 < data.total : false;
  return (
    <Modal
      open
      title={text('Выигрыши', 'Ұтыстар')}
      description={campaign.title}
      onClose={() => {
        if (!busy) onClose();
      }}
      size="lg"
    >
      <div className="fortune-winners">
        <div className="fortune-winners-header">
          <Field label={text('Статус приза', 'Сыйлық мәртебесі')}>
            <select
              className="input-classic"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="">{text('Все', 'Барлығы')}</option>
              {['pending', 'claimed', 'redeemed', 'expired'].map((value) => (
                <option key={value} value={value}>
                  {winnerStatus(value, text)}
                </option>
              ))}
            </select>
          </Field>
          {data && (
            <span>
              {formatNumber(data.total)} {text('выигрышей', 'ұтыс')}
            </span>
          )}
        </div>
        {loading ? (
          <PageState type="loading" compact />
        ) : error ? (
          <PageState
            type="error"
            description={error}
            onRetry={() => setRevision((current) => current + 1)}
            compact
          />
        ) : !data?.items.length ? (
          <PageState type="empty" title={text('Выигрышей пока нет', 'Әзірге ұтыс жоқ')} compact />
        ) : (
          <ul className="fortune-winner-list">
            {data.items.map((winner) => (
              <li key={winner.id} className="fortune-winner">
                <div>
                  <strong>{winner.prizeLabel}</strong>
                  <p>
                    {winner.customerName ||
                      winner.customerPhone ||
                      text('Клиент ещё не вошёл', 'Клиент әлі кірген жоқ')}
                  </p>
                  <small>
                    {winner.branchName || '—'} · {formatDate(winner.wonAt)}
                  </small>
                  {winner.receiptNumber && (
                    <small>
                      {text('Чек', 'Чек')} №{winner.receiptNumber}
                      {winner.receiptTotal !== undefined &&
                        ` · ${formatNumber(winner.receiptTotal)} ₸`}
                    </small>
                  )}
                </div>
                <div className="fortune-winner-actions">
                  <span className={`fortune-status fortune-status-${winner.status}`}>
                    {winnerStatus(winner.status, text)}
                  </span>
                  {winner.prizeKind !== 'none' && (
                    <small>
                      {text('До', 'Дейін')} {formatDate(winner.expiresAt)}
                    </small>
                  )}
                  {winner.status === 'claimed' && winner.prizeKind === 'gift' && (
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={Boolean(busy)}
                      onClick={() => void redeem(winner)}
                    >
                      <CheckCircle2 size={18} />
                      {busy === winner.id
                        ? text('Сохраняем…', 'Сақталуда…')
                        : text('Выдать приз', 'Сыйлық беру')}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {data && data.total > 50 && (
          <div className="fortune-pagination">
            <button
              type="button"
              className="btn-outline"
              disabled={page === 1 || loading}
              onClick={() => setPage((current) => current - 1)}
            >
              <ChevronLeft size={18} />
              {text('Назад', 'Артқа')}
            </button>
            <span>
              {text('Страница', 'Бет')} {page}
            </span>
            <button
              type="button"
              className="btn-outline"
              disabled={!canNext || loading}
              onClick={() => setPage((current) => current + 1)}
            >
              {text('Далее', 'Келесі')}
              <ChevronRight size={18} />
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}

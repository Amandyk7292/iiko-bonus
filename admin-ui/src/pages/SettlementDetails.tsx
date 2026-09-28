import { useEffect, useRef, useState } from 'react';
import Modal from '../components/Modal';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
export type Drill = { branch?: string; metric: string; name?: string };
type Row = {
  payment_confirmed?: boolean;
  payment_review?: boolean;
  delivery_cost_pending?: boolean;
  order_id: string;
  order_number: number;
  branch: string;
  ordered_at: string;
  payment_method: string;
  status: string;
  fulfillment_status: string;
  cash_amount: number;
  cash_refunded: number;
  cancellation_reason: string | null;
  checked_at: string | null;
  bank_issue: string | null;
  bank_check_current: boolean;
};
export default function SettlementDetails({
  drill,
  from,
  to,
  canManage,
  onClose,
}: {
  drill: Drill;
  from: string;
  to: string;
  canManage: boolean;
  onClose: () => void;
}) {
  const { t, formatNumber, formatDate } = useI18n();
  const [offset, setOffset] = useState(0),
    [refresh, setRefresh] = useState(0);
  const [data, setData] = useState<{ orders: Row[]; total: number } | null>(null);
  const [busy, setBusy] = useState(false),
    [checking, setChecking] = useState(''),
    [error, setError] = useState('');
  const sequence = useRef(0);
  useEffect(() => {
    const seq = ++sequence.current;
    setBusy(true);
    setError('');
    const q = new URLSearchParams({ from, to, metric: drill.metric, offset: String(offset) });
    if (drill.branch) q.set('branch', drill.branch);
    request<{ orders: Row[]; total: number }>(`/transactions/settlements/details?${q}`)
      .then((r) => {
        if (seq === sequence.current) setData(r);
      })
      .catch((e) => {
        if (seq === sequence.current) {
          setError(e.message);
          setData(null);
        }
      })
      .finally(() => {
        if (seq === sequence.current) setBusy(false);
      });
    return () => {
      sequence.current++;
    };
  }, [drill, from, to, offset, refresh]);
  async function check(id: string) {
    setChecking(id);
    setError('');
    try {
      await request(`/transactions/settlements/orders/${id}/bank-check`, { method: 'POST' });
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settlements.copy58'));
    } finally {
      setChecking('');
    }
  }
  return (
    <Modal
      open
      title={`${t('settlements.detail.title')} · ${drill.name || t('settlements.copy5')}`}
      onClose={onClose}
      size="lg"
    >
      <div className="modal-body form-stack" aria-busy={busy}>
        <p>
          {t(`settlements.simple.${drill.metric}`)} · {from} — {to}
        </p>
        {drill.metric === 'buyers' && (
          <p className="field-hint">{t('settlements.detail.buyers')}</p>
        )}
        {drill.metric === 'issues' && <p className="field-hint">{t('settlements.bank.note')}</p>}
        {error && (
          <p role="alert" className="inline-alert-error">
            {error}
          </p>
        )}
        {busy && <p role="status">{t('settlements.copy6')}</p>}
        {data?.orders.map((o) => (
          <article className="branch-order-card" key={o.order_id}>
            <h3>
              #{o.order_number} · {o.branch}
            </h3>
            <p>{formatDate(o.ordered_at, { timeZone: 'Asia/Almaty' })}</p>
            <p>
              {t('settlements.detail.payment')}: {t(`settlements.status.${o.status}`)} ·{' '}
              {t('settlements.detail.fulfillment')}:{' '}
              {t(`settlements.status.${o.fulfillment_status}`)}
            </p>
            <p>
              {t('settlements.detail.amount')}: {formatNumber(Number(o.cash_amount))} ₸ ·{' '}
              {t('settlements.simple.returned')}: {formatNumber(Number(o.cash_refunded))} ₸
            </p>
            {(o.fulfillment_status === 'cancelled' ||
              ['failed', 'expired', 'cancelled'].includes(o.status)) && (
              <p>
                {t('settlements.detail.reason')}:{' '}
                {o.cancellation_reason || t('settlements.detail.noReason')}
              </p>
            )}
            <p>
              {t(
                'settlements.bank.' +
                  (o.payment_confirmed && !o.payment_review
                    ? 'ok'
                    : o.payment_method !== 'forte_card'
                      ? 'manual'
                      : !o.bank_check_current
                        ? 'unchecked'
                        : o.bank_issue || 'unchecked'),
              )}
            </p>
            {o.delivery_cost_pending && <p>{t('settlements.auto.deliveryPending')}</p>}
            {o.checked_at && (
              <small>
                {t('settlements.bank.checked')}:{' '}
                {formatDate(o.checked_at, {
                  timeZone: 'Asia/Almaty',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </small>
            )}
            {canManage && o.payment_method === 'forte_card' && (
              <button
                className="btn-outline"
                disabled={busy || !!checking}
                onClick={() => void check(o.order_id)}
              >
                {checking === o.order_id ? t('settlements.copy6') : t('settlements.bank.check')}
              </button>
            )}
          </article>
        ))}
        {data && !data.total && <p>{t('settlements.copy49')}</p>}
        <div className="settlement-pagination">
          <button
            className="btn-outline"
            disabled={busy || !!checking || offset === 0}
            onClick={() => setOffset((v) => Math.max(0, v - 25))}
          >
            {t('settlements.copy50')}
          </button>
          <span>
            {data?.total
              ? `${offset + 1}–${Math.min(offset + 25, data.total)} / ${data.total}`
              : '0'}
          </span>
          <button
            className="btn-outline"
            disabled={busy || !!checking || !data || offset + 25 >= data.total}
            onClick={() => setOffset((v) => v + 25)}
          >
            {t('settlements.copy51')}
          </button>
        </div>
      </div>
    </Modal>
  );
}

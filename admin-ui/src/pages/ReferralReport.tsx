import { useCallback, useEffect, useRef, useState } from 'react';
import { request, type PosHealthResponse } from '../lib/api';
import { useI18n } from '../lib/i18n';
import Modal from '../components/Modal';

type Invitation = {
  id: string;
  created_at: string;
  status: string;
  review_state: string;
  risk_reasons: string[];
  rewarded_at: string | null;
  reversed_at: string | null;
  branch_name: string | null;
  purchased_at: string | null;
  reward_referrer: number;
  reward_friend: number;
  last_error: string | null;
  first_purchase_source: string;
  amount: number;
  refunded_amount: number;
  owner_name: string | null;
  friend_name: string | null;
  owner_id: string;
  referred_customer_id: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  review_note: string | null;
};
type Report = {
  summary: Record<string, number>;
  branches: {
    branch_id: string | null;
    name: string;
    invitations: number;
    purchases: number;
    revenue: number;
    rewards: number;
  }[];
  items: Invitation[];
  canReview: boolean;
  pos: PosHealthResponse | null;
  posError: boolean;
  health?: {
    delayed: number;
    pendingNotifications: number;
    failedNotifications: number;
    items: {
      id: string;
      purchased_at: string;
      branch_name: string | null;
      last_error: string | null;
    }[];
  };
};
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Almaty',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
const amount = (value: number) =>
  new Intl.NumberFormat('ru-KZ', { maximumFractionDigits: 2 }).format(Number(value || 0));

export default function ReferralReport() {
  const { t } = useI18n();
  const [from, setFrom] = useState(() => today().slice(0, 8) + '01');
  const [to, setTo] = useState(today);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [review, setReview] = useState<Invitation | null>(null);
  const [note, setNote] = useState('');
  const [returning, setReturning] = useState(false);
  const [returnTotal, setReturnTotal] = useState(0);
  const [saving, setSaving] = useState(false);
  const revision = useRef(0);
  const load = useCallback(async () => {
    const current = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const result = await request<Report>(
        `/bonus/referrals?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&offset=${offset}`,
      );
      if (current === revision.current) setData(result);
    } catch (caught) {
      if (current === revision.current) {
        setData(null);
        setError(caught instanceof Error ? caught.message : t('common.loadError'));
      }
    } finally {
      if (current === revision.current) setLoading(false);
    }
  }, [from, to, offset, t]);
  useEffect(() => {
    void load();
    return () => {
      revision.current++;
    };
  }, [load]);
  const decide = async (action: 'approve' | 'reject' | 'return') => {
    if (!review || saving || note.trim().length < 3) return;
    setSaving(true);
    setError('');
    try {
      await request(`/bonus/referrals/${review.id}/review`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          note: note.trim(),
          ...(action === 'return' ? { total: returnTotal } : {}),
        }),
      });
      setReview(null);
      setNote('');
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };
  return (
    <section className="card settings-form" aria-label={t('referrals.title')}>
      <div className="section-heading">
        <div>
          <h2>{t('referrals.title')}</h2>
          <p>{t('referrals.cohort')}</p>
        </div>
      </div>
      <div className="form-grid form-grid-2">
        <label className="field-group">
          <span>{t('referrals.from')}</span>
          <input
            className="input-classic"
            type="date"
            value={from}
            max={to}
            onChange={(e) => {
              setOffset(0);
              setFrom(e.target.value);
            }}
          />
        </label>
        <label className="field-group">
          <span>{t('referrals.to')}</span>
          <input
            className="input-classic"
            type="date"
            value={to}
            min={from}
            onChange={(e) => {
              setOffset(0);
              setTo(e.target.value);
            }}
          />
        </label>
      </div>
      <button className="btn-outline" type="button" disabled={loading} onClick={() => void load()}>
        {loading ? t('common.loading') : t('referrals.refresh')}
      </button>
      {error && (
        <p className="inline-alert" role="alert">
          {error}
        </p>
      )}
      {data && (
        <>
          <dl className="form-grid form-grid-2">
            {[
              'invitations',
              'purchases',
              'revenue',
              'awarded',
              'reversed',
              'debt_created',
              'review',
              'delayed',
            ].map((key) => (
              <div key={key}>
                <dt>{t(`referrals.${key}`)}</dt>
                <dd>
                  {amount(data.summary[key])}
                  {['revenue', 'awarded', 'reversed', 'debt_created'].includes(key) ? ' ₸' : ''}
                </dd>
              </div>
            ))}
          </dl>
          <p className="field-hint">{t('referrals.scope')}</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  {['branch', 'invitations', 'purchases', 'revenue', 'rewards'].map((key) => (
                    <th key={key}>{t(`referrals.${key}`)}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.branches.map((branch) => (
                  <tr key={branch.branch_id || 'none'}>
                    <td data-label={t('referrals.branch')}>{branch.name}</td>
                    <td data-label={t('referrals.invitations')}>{branch.invitations}</td>
                    <td data-label={t('referrals.purchases')}>{branch.purchases}</td>
                    <td data-label={t('referrals.revenue')}>{amount(branch.revenue)} ₸</td>
                    <td data-label={t('referrals.rewards')}>{amount(branch.rewards)} ₸</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <h3>{t('referrals.list')}</h3>
          {!data.items.length && <p>{t('referrals.empty')}</p>}
          {data.items.map((item) => (
            <article className="form-section" key={item.id}>
              <strong>
                {item.id.slice(0, 8)} · {item.branch_name || t('referrals.unassigned')}
              </strong>
              <p style={{ overflowWrap: 'anywhere' }}>
                {t('referrals.inviter')}: {item.owner_name || '—'} · {item.owner_id}
                <br />
                {t('referrals.friend')}: {item.friend_name || '—'} · {item.referred_customer_id}
              </p>
              <p>
                {new Date(item.created_at).toLocaleString('ru-KZ')} ·{' '}
                {t(
                  `referrals.status.${item.reversed_at ? 'reversed' : item.review_state === 'pending' ? 'review' : item.purchased_at && item.status === 'registered' ? 'qualified' : item.status}`,
                )}
              </p>
              {item.risk_reasons.map((reason) => (
                <p key={reason}>{t(`referrals.risk.${reason}`)}</p>
              ))}
              {item.last_error && <p role="status">{item.last_error}</p>}
              {item.reviewed_at && (
                <p style={{ overflowWrap: 'anywhere' }}>
                  {t('referrals.note')}: {item.review_note} · {item.reviewed_by} ·{' '}
                  {new Date(item.reviewed_at).toLocaleString('ru-KZ')}
                </p>
              )}
              {item.review_state === 'pending' && data.canReview && (
                <button
                  className="btn-outline"
                  type="button"
                  onClick={() => {
                    setReturning(false);
                    setReview(item);
                    setNote('');
                  }}
                >
                  {t('referrals.inspect')}
                </button>
              )}
              {item.first_purchase_source === 'pos' && !item.reversed_at && data.canReview && (
                <button
                  className="btn-outline"
                  type="button"
                  onClick={() => {
                    setReturning(true);
                    setReturnTotal(Number(item.amount));
                    setReview(item);
                    setNote('');
                  }}
                >
                  {t('referrals.recordReturn')}
                </button>
              )}
            </article>
          ))}
          <div className="action-cluster">
            <button
              className="btn-outline"
              type="button"
              disabled={loading || offset === 0}
              onClick={() => setOffset(Math.max(0, offset - 50))}
            >
              {t('referrals.previous')}
            </button>
            <span>
              {data.items.length ? offset + 1 : 0}–{offset + data.items.length} /{' '}
              {data.summary.invitations}
            </span>
            <button
              className="btn-outline"
              type="button"
              disabled={loading || offset + data.items.length >= data.summary.invitations}
              onClick={() => setOffset(offset + 50)}
            >
              {t('referrals.next')}
            </button>
          </div>
          <h3>{t('referrals.monitor')}</h3>
          <p className="field-hint">{t('referrals.monitorHint')}</p>
          {data.health && (
            <>
              <p>
                {t('referrals.delayed')}: {data.health.delayed}
              </p>
              <p>
                {t('referrals.pendingNotifications')}: {data.health.pendingNotifications} ·{' '}
                {t('referrals.failedNotifications')}: {data.health.failedNotifications}
              </p>
              {data.health.items.map((item) => (
                <p key={item.id}>
                  {item.branch_name || t('referrals.unassigned')} ·{' '}
                  {new Date(item.purchased_at).toLocaleString('ru-KZ')} ·{' '}
                  {item.last_error || t('referrals.status.qualified')}
                </p>
              ))}
            </>
          )}
          <h3>{t('referrals.pos')}</h3>
          {data.posError && <p role="alert">{t('referrals.posError')}</p>}
          {data.pos && (
            <div style={{ overflowX: 'auto' }}>
              <table className="data-table">
                <thead>
                  <tr>
                    {['branch', 'version', 'connection', 'sync'].map((key) => (
                      <th key={key}>{t(`referrals.${key}`)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.pos.devices.map((device) => (
                    <tr key={`${device.branchId}:${device.id}`}>
                      <td data-label={t('referrals.branch')}>
                        {device.branch?.name || t('referrals.unassigned')} · {device.name}
                      </td>
                      <td data-label={t('referrals.version')}>
                        {device.pluginVersion || '—'}
                        {device.outdated ? ` · ${t('referrals.outdated')}` : ''}
                      </td>
                      <td data-label={t('referrals.connection')}>
                        {device.online ? t('referrals.online') : t('referrals.offline')}
                        <br />
                        {device.lastSeenAt
                          ? new Date(device.lastSeenAt).toLocaleString('ru-KZ')
                          : '—'}
                      </td>
                      <td data-label={t('referrals.sync')}>
                        {device.lastError ||
                          (device.health === 'healthy'
                            ? t('referrals.ok')
                            : t('referrals.attention'))}
                        <br />
                        {Object.entries(device.queues)
                          .filter(([, value]) => Number(value) > 0)
                          .map(([key, value]) => `${t(`referrals.queue.${key}`)}: ${value}`)
                          .join(' · ')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      {review && (
        <Modal
          open
          title={t(returning ? 'referrals.recordReturn' : 'referrals.inspect')}
          onClose={() => {
            if (!saving) setReview(null);
          }}
        >
          <p>{t(returning ? 'referrals.returnHint' : 'referrals.reviewHint')}</p>
          {returning && (
            <label className="field-group">
              <span>{t('referrals.returnTotal')}</span>
              <input
                className="input-classic"
                type="number"
                min={Math.max(0.01, Number(review.refunded_amount || 0))}
                max={review.amount}
                step="0.01"
                value={returnTotal}
                onChange={(e) => setReturnTotal(Number(e.target.value))}
              />
            </label>
          )}
          <label className="field-group">
            <span>{t('referrals.note')}</span>
            <textarea
              className="input-classic"
              value={note}
              maxLength={1000}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          <div className="action-cluster">
            <button
              className="btn-classic"
              type="button"
              disabled={
                saving ||
                note.trim().length < 3 ||
                (returning &&
                  (returnTotal <= 0 ||
                    returnTotal > Number(review.amount) ||
                    returnTotal < Number(review.refunded_amount)))
              }
              onClick={() => void decide(returning ? 'return' : 'approve')}
            >
              {t(returning ? 'referrals.recordReturn' : 'referrals.approve')}
            </button>
            {!returning && (
              <button
                className="btn-outline"
                type="button"
                disabled={saving || note.trim().length < 3}
                onClick={() => void decide('reject')}
              >
                {t('referrals.reject')}
              </button>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}

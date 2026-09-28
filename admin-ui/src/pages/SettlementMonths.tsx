import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import DateInput from '../components/DateInput';
import SelectControl from '../components/SelectControl';
import Modal from '../components/Modal';
import type { Config } from './settlements-model';
type Item = {
  order_id: string;
  order_number: number;
  adjustment: boolean;
  delta: number;
  cash_delta: number;
};
type Snapshot = {
  month: string;
  blocked: number;
  entitlement: number;
  cash_net: number;
  signature: string;
  items: Item[];
};
type Closed = {
  id: string;
  branch_id: string;
  partner_id: string | null;
  month: string;
  closed_at: string;
  entitlement: number;
};
export default function SettlementMonths({
  config,
  canManage,
}: {
  config: Config;
  canManage: boolean;
}) {
  const { t, formatNumber } = useI18n();
  const [branch, setBranch] = useState(''),
    [partner, setPartner] = useState('');
  const [month, setMonth] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth() - 1, 15).toISOString().slice(0, 7) +
      '-01',
  );
  const [months, setMonths] = useState<Closed[]>([]),
    [preview, setPreview] = useState<Snapshot | null>(null),
    [view, setView] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [confirm, setConfirm] = useState(false);
  const money = (n: number) => `${formatNumber(Number(n))} ₸`;
  async function history() {
    const r = await request<{ months: Closed[] }>('/transactions/settlements/months');
    setMonths(r.months);
  }
  useEffect(() => {
    void history().catch((e) => setError(e.message));
  }, []);
  const [visibleItems, setVisibleItems] = useState(50);
  async function openArchive(id: string) {
    setBusy(true);
    setError('');
    try {
      setVisibleItems(50);
      setView(await request<Snapshot>(`/transactions/settlements/months/${id}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settlements.copy58'));
    } finally {
      setBusy(false);
    }
  }
  function reset() {
    setPreview(null);
    setError('');
  }
  async function inspect() {
    setBusy(true);
    setError('');
    setPreview(null);
    try {
      const q = new URLSearchParams({ branch, month });
      if (partner) q.set('partner', partner);
      setPreview(await request<Snapshot>(`/transactions/settlements/months/preview?${q}`));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settlements.copy58'));
    } finally {
      setBusy(false);
    }
  }
  async function close() {
    if (!preview) return;
    setBusy(true);
    setError('');
    try {
      await request('/transactions/settlements/months/close', {
        method: 'POST',
        body: JSON.stringify({
          branch,
          month,
          ...(partner ? { partner } : {}),
          signature: preview.signature,
        }),
      });
      setConfirm(false);
      setPreview(null);
      await history();
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settlements.copy58'));
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  const entries = (snapshot: Snapshot) => (
    <div className="form-stack">
      <p>
        {t('settlements.month.cash')}: <strong>{money(snapshot.cash_net)}</strong>
      </p>
      <p>
        {t('settlements.month.due')}: <strong>{money(snapshot.entitlement)}</strong>
      </p>
      {snapshot.items.slice(0, visibleItems).map((i) => (
        <div className="branch-order-card" key={i.order_id}>
          <strong>
            #{i.order_number} ·{' '}
            {t(i.adjustment ? 'settlements.month.adjustment' : 'settlements.month.order')}
          </strong>
          <p>
            {t('settlements.month.cash')}: {money(i.cash_delta)} · {t('settlements.month.due')}:{' '}
            {money(i.delta)}
          </p>
        </div>
      ))}
      {snapshot.items.length > visibleItems && (
        <button className="btn-outline" onClick={() => setVisibleItems((v) => v + 50)}>
          {t('settlements.month.more')} ({visibleItems}/{snapshot.items.length})
        </button>
      )}
      {!snapshot.items.length && <p>{t('settlements.copy49')}</p>}
    </div>
  );
  return (
    <section className="card form-stack">
      <h2>{t('settlements.month.title')}</h2>
      <p>{t('settlements.month.note')}</p>
      <div className="settlement-filters">
        <div className="field-group">
          <label htmlFor="close-branch">{t('settlements.copy4')}</label>
          <SelectControl
            id="close-branch"
            disabled={busy}
            value={branch}
            onChange={(v) => {
              setBranch(v);
              reset();
            }}
            options={[
              { value: '', label: t('settlements.month.choose') },
              ...config.locations.map((l) => ({ value: l.id, label: l.name })),
            ]}
          />
        </div>
        <div className="field-group">
          <label htmlFor="close-partner">{t('settlements.copy42')}</label>
          <SelectControl
            id="close-partner"
            disabled={busy}
            value={partner}
            onChange={(v) => {
              setPartner(v);
              reset();
            }}
            options={[
              ...(canManage
                ? [{ value: '', label: 'Bulka' }]
                : [{ value: '', label: t('settlements.portal.own') }]),
              ...config.partners.map((p) => ({ value: p.id, label: p.name })),
            ]}
          />
        </div>
        <label className="field-group">
          <span>{t('settlements.month.month')}</span>
          <DateInput
            required
            disabled={busy}
            value={month}
            onChange={(e) => {
              setMonth(e.target.value.slice(0, 7) + '-01');
              reset();
            }}
          />
        </label>
        <button className="btn-outline" disabled={!branch || busy} onClick={() => void inspect()}>
          {t('settlements.month.preview')}
        </button>
      </div>
      {error && (
        <p role="alert" className="inline-alert-error">
          {error}
        </p>
      )}
      {preview && (
        <div className="form-stack">
          <p>
            {t('settlements.month.blocked')}: {preview.blocked}
          </p>
          {entries(preview)}
          {canManage && (
            <button
              className="btn-primary"
              disabled={
                busy ||
                preview.blocked > 0 ||
                month >=
                  new Intl.DateTimeFormat('sv-SE', {
                    timeZone: 'Asia/Almaty',
                    year: 'numeric',
                    month: '2-digit',
                    day: '2-digit',
                  })
                    .format(new Date())
                    .slice(0, 7) +
                    '-01' ||
                months.some(
                  (m) =>
                    m.branch_id === branch &&
                    m.partner_id === (partner || null) &&
                    m.month >= month,
                )
              }
              onClick={() => setConfirm(true)}
            >
              {t('settlements.month.close')}
            </button>
          )}
        </div>
      )}
      <h3>{t('settlements.month.archive')}</h3>
      {months
        .filter((m) => !branch || m.branch_id === branch)
        .map((m) => (
          <button
            key={m.id}
            className="btn-outline"
            disabled={busy}
            onClick={() => void openArchive(m.id)}
          >
            {m.month.slice(0, 7)} ·{' '}
            {config.locations.find((l) => l.id === m.branch_id)?.name || t('settlements.copy4')} ·{' '}
            {config.partners.find((p) => p.id === m.partner_id)?.name || 'Bulka'} ·{' '}
            {money(m.entitlement)}
          </button>
        ))}
      {!months.length && <p>{t('settlements.month.empty')}</p>}
      <Modal
        open={confirm}
        title={t('settlements.month.close')}
        onClose={() => {
          if (!busy) setConfirm(false);
        }}
        footer={
          <button className="btn-primary" disabled={busy} onClick={() => void close()}>
            {busy ? t('settlements.copy6') : t('settlements.month.confirm')}
          </button>
        }
      >
        <div className="modal-body">
          <p>{t('settlements.month.confirmNote')}</p>
          <p>
            {month.slice(0, 7)} · {config.locations.find((l) => l.id === branch)?.name}
          </p>
        </div>
      </Modal>
      <Modal
        open={!!view}
        title={`${t('settlements.month.archive')} · ${view?.month?.slice(0, 7) || ''}`}
        onClose={() => setView(null)}
        size="lg"
      >
        <div className="modal-body">{view && entries(view)}</div>
      </Modal>
    </section>
  );
}

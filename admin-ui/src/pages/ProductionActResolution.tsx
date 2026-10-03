import { useEffect, useId, useRef, useState } from 'react';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';

type Act = {
  id: string;
  date: string;
  status: 'unknown' | 'sending';
  requestedDocumentNumber: string;
  serverId: string;
  departmentId: string;
  sourceStoreId: string;
  targetStoreId: string;
  postImmediately: boolean;
  items: { productId: string; productName: string; quantity: number; unit: string }[];
};
type Action = '' | 'created' | 'not_created';

function Verification({
  act,
  resolve,
  busy,
}: {
  act: Act;
  busy: boolean;
  resolve: (id: string, action: Exclude<Action, ''>, documentNumber: string) => Promise<void>;
}) {
  const { t } = useI18n();
  const id = useId();
  const [action, setAction] = useState<Action>('');
  const [number, setNumber] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  return (
    <details className="form-stack">
      <summary style={{ overflowWrap: 'anywhere' }}>
        {act.date} · {act.requestedDocumentNumber}
      </summary>
      <dl className="grid gap-2" style={{ overflowWrap: 'anywhere' }}>
        {(['serverId', 'departmentId', 'sourceStoreId', 'targetStoreId'] as const).map((key) => (
          <div key={key}>
            <dt>{t(`production.frozen.${key}`)}</dt>
            <dd>{act[key]}</dd>
          </div>
        ))}
        <div>
          <dt>{t('production.mode')}</dt>
          <dd>{t(act.postImmediately ? 'production.modePost' : 'production.modeDraft')}</dd>
        </div>
      </dl>
      <ul>
        {act.items.map((item, index) => (
          <li key={`${item.productId}-${index}`}>
            {item.productName} — {item.quantity} {item.unit}
          </li>
        ))}
      </ul>
      {act.status === 'sending' ? (
        <p role="status">{t('production.processing')}</p>
      ) : (
        <>
          <label className="field-label" htmlFor={`${id}-action`}>
            {t('production.result')}
            <select
              id={`${id}-action`}
              disabled={busy}
              value={action}
              onChange={(event) => {
                setAction(event.target.value as Action);
                setConfirmed(false);
              }}
            >
              <option value="">{t('production.choose')}</option>
              <option value="created">{t('production.exists')}</option>
              <option value="not_created">{t('production.absent')}</option>
            </select>
          </label>
          {action === 'created' && (
            <label className="field-label" htmlFor={`${id}-number`}>
              {t('production.number')}
              <input
                id={`${id}-number`}
                disabled={busy}
                value={number}
                maxLength={100}
                onChange={(event) => setNumber(event.target.value)}
              />
            </label>
          )}
          {action && (
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={confirmed}
                disabled={busy}
                onChange={(event) => setConfirmed(event.target.checked)}
              />
              {t(action === 'created' ? 'production.checkedCreated' : 'production.checkedAbsent')}
            </label>
          )}
          <button
            type="button"
            className="btn-outline"
            disabled={busy || !action || !confirmed || (action === 'created' && !number.trim())}
            onClick={() => {
              if (action) void resolve(act.id, action, number.trim());
            }}
          >
            {t(busy ? 'common.saving' : 'production.confirm')}
          </button>
        </>
      )}
    </details>
  );
}

export default function ProductionActResolution({
  locationId,
  onBusy,
  disabled = false,
}: {
  locationId: string;
  onBusy: (busy: boolean) => void;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [acts, setActs] = useState<Act[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const submitting = useRef(false);
  const path = `/locations/${encodeURIComponent(locationId)}/production-acts`;
  const load = async () => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const response = await request<{ acts: Act[] }>(path);
      if (version === generation.current) setActs(response.acts || []);
    } catch (caught) {
      if (version === generation.current)
        setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };
  useEffect(() => {
    void load();
    return () => {
      generation.current++;
    };
  }, [locationId]);
  const resolve = async (id: string, action: Exclude<Action, ''>, documentNumber: string) => {
    if (submitting.current || disabled) return;
    submitting.current = true;
    setBusy(true);
    onBusy(true);
    setError('');
    const version = generation.current;
    try {
      await request(`${path}/${encodeURIComponent(id)}/resolve`, {
        method: 'POST',
        body: JSON.stringify({
          action,
          confirmed: true,
          ...(action === 'created' ? { documentNumber } : {}),
        }),
      });
      if (version === generation.current)
        setActs((current) => current.filter((act) => act.id !== id));
    } catch (caught) {
      if (version === generation.current)
        setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      submitting.current = false;
      setBusy(false);
      onBusy(false);
    }
  };
  if (!acts.length && !error) return null;
  return (
    <section className="modal-body form-stack" aria-busy={loading || busy}>
      <div className="flex items-center justify-between gap-2">
        <h3>{t('production.unconfirmed')}</h3>
        <button
          type="button"
          className="btn-outline"
          disabled={loading || busy || disabled}
          onClick={() => void load()}
        >
          {t('production.refresh')}
        </button>
      </div>
      {error && (
        <div role="alert" className="inline-alert inline-alert-error">
          {error}
        </div>
      )}
      {acts.map((act) => (
        <Verification key={act.id} act={act} busy={busy || loading || disabled} resolve={resolve} />
      ))}
    </section>
  );
}

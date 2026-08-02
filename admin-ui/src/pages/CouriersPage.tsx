import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Bike,
  Copy,
  History,
  LoaderCircle,
  LogOut,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import { useFeedback } from '../components/Feedback';
import { api, type Courier, type CourierActivity } from '../lib/api';
import { useI18n } from '../lib/i18n';

type Draft = { name: string; phone: string; vehicle: string; active: boolean };
const emptyDraft: Draft = { name: '', phone: '+7', vehicle: '', active: true };

export default function CouriersPage() {
  const { t, formatDate } = useI18n();
  const { toast, confirm } = useFeedback();
  const [couriers, setCouriers] = useState<Courier[]>([]);
  const [editing, setEditing] = useState<Courier | null | 'new'>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [activityCourier, setActivityCourier] = useState<Courier | null>(null);
  const [activity, setActivity] = useState<CourierActivity[]>([]);
  const [activityLoading, setActivityLoading] = useState(false);

  const load = useCallback(
    async (silent = false) => {
      if (!silent) setLoading(true);
      try {
        setCouriers((await api.getCouriers()).couriers ?? []);
        setError('');
      } catch (caught) {
        if (!silent) setError(caught instanceof Error ? caught.message : t('common.loadError'));
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [t],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const open = (courier?: Courier) => {
    setEditing(courier ?? 'new');
    setDraft(
      courier
        ? {
            name: courier.name,
            phone: courier.phone,
            vehicle: courier.vehicle || '',
            active: courier.active,
          }
        : emptyDraft,
    );
    setError('');
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || !editing) return;
    setSaving(true);
    try {
      const payload = { ...draft, vehicle: draft.vehicle || null };
      const result =
        editing === 'new'
          ? await api.createCourier(payload)
          : await api.updateCourier(editing.id, payload);
      setCouriers((current) =>
        editing === 'new'
          ? [result.courier, ...current]
          : current.map((item) => (item.id === result.courier.id ? result.courier : item)),
      );
      setEditing(null);
      toast(t('couriers.saved'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const toggle = async (courier: Courier) => {
    try {
      const result = await api.setCourierActive(courier.id, !courier.active);
      setCouriers((current) =>
        current.map((item) => (item.id === courier.id ? result.courier : item)),
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    }
  };

  const copyAccessLink = async (courier: Courier) => {
    if (!courier.accessUrl) return;
    try {
      await navigator.clipboard.writeText(courier.accessUrl);
      toast(t('couriers.linkCopied'));
    } catch {
      toast(t('couriers.linkCopyError'), 'error');
    }
  };

  const openActivity = async (courier: Courier) => {
    setActivityCourier(courier);
    setActivity([]);
    setActivityLoading(true);
    try {
      setActivity((await api.getCourierActivity(courier.id)).activity ?? []);
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.loadError'), 'error');
    } finally {
      setActivityLoading(false);
    }
  };

  const revokeSessions = async (courier: Courier) => {
    if (
      !courier.activeSessions ||
      !(await confirm({
        title: t('couriers.revokeSessions'),
        body: t('couriers.revokeConfirm'),
        confirmLabel: t('couriers.revokeSessions'),
        destructive: true,
      }))
    ) {
      return;
    }
    try {
      await api.revokeCourierSessions(courier.id);
      setCouriers((current) =>
        current.map((item) => (item.id === courier.id ? { ...item, activeSessions: 0 } : item)),
      );
      toast(t('couriers.sessionsRevoked'));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('common.error'), 'error');
    }
  };

  if (loading && couriers.length === 0) return <PageState type="loading" />;
  if (error && couriers.length === 0 && !editing)
    return <PageState type="error" description={error} onRetry={() => load()} />;

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('couriers.heading')}</h2>
          <p className="page-help">{t('couriers.intro')}</p>
        </div>
        <div className="action-cluster">
          <button
            type="button"
            className="btn-outline px-5 inline-flex items-center gap-2"
            onClick={() => load()}
          >
            <RefreshCw size={17} />
            {t('common.refresh')}
          </button>
          <button
            type="button"
            className="btn-classic px-5 inline-flex items-center gap-2"
            onClick={() => open()}
          >
            <Plus size={17} />
            {t('couriers.add')}
          </button>
        </div>
      </div>
      {couriers.length === 0 ? (
        <PageState type="empty" title={t('couriers.empty')} description={t('couriers.emptyHint')} />
      ) : (
        <section className="courier-grid">
          {couriers.map((courier) => (
            <article
              className={`card courier-card ${courier.active ? '' : 'is-muted'}`}
              key={courier.id}
            >
              <div className="courier-card-head">
                <div className="courier-avatar">
                  <Bike aria-hidden="true" size={22} />
                </div>
                <div>
                  <h3>{courier.name}</h3>
                  <p>{courier.phone}</p>
                </div>
                <button
                  className="icon-button"
                  type="button"
                  onClick={() => open(courier)}
                  aria-label={t('common.edit')}
                >
                  <Pencil size={17} />
                </button>
              </div>
              <dl className="courier-meta">
                <div>
                  <dt>{t('couriers.vehicle')}</dt>
                  <dd>{courier.vehicle || '—'}</dd>
                </div>
                <div>
                  <dt>{t('couriers.sessions')}</dt>
                  <dd>
                    <ShieldCheck size={15} />
                    {courier.activeSessions || 0}
                  </dd>
                </div>
                <div>
                  <dt>{t('couriers.lastLogin')}</dt>
                  <dd>
                    {courier.lastLoginAt
                      ? formatDate(courier.lastLoginAt, { dateStyle: 'short', timeStyle: 'short' })
                      : t('couriers.neverLoggedIn')}
                  </dd>
                </div>
                <div>
                  <dt>{t('couriers.location')}</dt>
                  <dd>
                    {courier.latitude != null && courier.longitude != null ? (
                      <>
                        <MapPin size={15} />
                        {courier.latitude.toFixed(5)}, {courier.longitude.toFixed(5)}
                      </>
                    ) : (
                      t('couriers.noLocation')
                    )}
                  </dd>
                </div>
                {courier.locationUpdatedAt && (
                  <div>
                    <dt>{t('couriers.locationUpdated')}</dt>
                    <dd>{formatDate(courier.locationUpdatedAt)}</dd>
                  </div>
                )}
              </dl>
              {courier.accessUrl && (
                <button
                  type="button"
                  className="btn-outline courier-link-button inline-flex items-center gap-2"
                  onClick={() => void copyAccessLink(courier)}
                >
                  <Copy size={16} />
                  {t('couriers.copyLink')}
                </button>
              )}
              <div className="courier-security-actions">
                <button
                  type="button"
                  className="btn-outline inline-flex items-center gap-2"
                  onClick={() => void openActivity(courier)}
                >
                  <History size={16} />
                  {t('couriers.activity')}
                </button>
                <button
                  type="button"
                  className="btn-outline inline-flex items-center gap-2"
                  onClick={() => void revokeSessions(courier)}
                  disabled={!courier.activeSessions}
                >
                  <LogOut size={16} />
                  {t('couriers.revokeSessions')}
                </button>
              </div>
              <label className="switch-row">
                <input
                  type="checkbox"
                  checked={courier.active}
                  onChange={() => void toggle(courier)}
                />
                <span className="switch-control" aria-hidden="true" />
                <span>{courier.active ? t('common.active') : t('common.inactive')}</span>
              </label>
            </article>
          ))}
        </section>
      )}
      <Modal
        open={Boolean(editing)}
        onClose={() => !saving && setEditing(null)}
        title={editing === 'new' ? t('couriers.add') : t('couriers.edit')}
        size="sm"
      >
        <form className="modal-body form-stack" onSubmit={save}>
          {error && (
            <div className="inline-alert inline-alert-error" role="alert">
              {error}
            </div>
          )}
          <div className="field-group">
            <label className="field-label" htmlFor="courier-name">
              {t('couriers.name')}
            </label>
            <input
              id="courier-name"
              className="input-classic"
              value={draft.name}
              onChange={(event) =>
                setDraft((current) => ({ ...current, name: event.target.value }))
              }
              required
              autoFocus
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="courier-phone">
              {t('couriers.phone')}
            </label>
            <input
              id="courier-phone"
              className="input-classic"
              value={draft.phone}
              onChange={(event) =>
                setDraft((current) => ({ ...current, phone: event.target.value }))
              }
              inputMode="tel"
              autoComplete="tel"
              required
            />
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="courier-vehicle">
              {t('couriers.vehicle')}
            </label>
            <input
              id="courier-vehicle"
              className="input-classic"
              value={draft.vehicle}
              onChange={(event) =>
                setDraft((current) => ({ ...current, vehicle: event.target.value }))
              }
              placeholder={t('couriers.vehiclePlaceholder')}
            />
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(event) =>
                setDraft((current) => ({ ...current, active: event.target.checked }))
              }
            />
            <span className="switch-control" aria-hidden="true" />
            <span>{t('common.active')}</span>
          </label>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline px-5"
              onClick={() => setEditing(null)}
              disabled={saving}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-classic px-5 inline-flex items-center gap-2"
              disabled={saving}
            >
              {saving && <LoaderCircle className="spin" size={17} />}
              {saving ? t('common.saving') : t('common.save')}
            </button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(activityCourier)}
        onClose={() => setActivityCourier(null)}
        title={`${t('couriers.activity')} · ${activityCourier?.name || ''}`}
        description={t('couriers.activityHint')}
        size="lg"
      >
        <div className="modal-body">
          {activityLoading ? (
            <PageState compact type="loading" />
          ) : activity.length === 0 ? (
            <PageState compact type="empty" title={t('couriers.noActivity')} />
          ) : (
            <ol className="courier-activity-list">
              {activity.map((event) => (
                <li key={event.id}>
                  <span className="courier-activity-dot" aria-hidden="true" />
                  <div>
                    <strong>{t(`courierEvent.${event.type}`)}</strong>
                    <small>
                      {formatDate(event.createdAt, { dateStyle: 'short', timeStyle: 'medium' })}
                      {event.orderId
                        ? ` · ${t('couriers.order')} ${String(event.orderId).slice(0, 8)}`
                        : ''}
                      {event.latitude != null && event.longitude != null
                        ? ` · ${event.latitude.toFixed(5)}, ${event.longitude.toFixed(5)}`
                        : ''}
                    </small>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </div>
      </Modal>
    </div>
  );
}

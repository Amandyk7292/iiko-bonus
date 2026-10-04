import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ClipboardList, LoaderCircle } from '../components/BulkaIcons';
import Modal from '../components/GuardedModal';
import { useFeedback } from '../components/Feedback';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import ProductionActResolution from './ProductionActResolution';

type Reference = { id: string; name: string; parentId?: string };
type Binding = {
  serverId: string;
  departmentId: string;
  sourceStoreId: string;
  targetStoreId: string;
  enabled: boolean;
  postImmediately: boolean;
};
type Response = {
  binding: Binding | null;
  directory: { servers: Reference[]; departments: Reference[]; stores: Reference[] };
};
const empty: Binding = {
  serverId: '',
  departmentId: '',
  sourceStoreId: '',
  targetStoreId: '',
  enabled: false,
  postImmediately: false,
};

export default function LocationProductionBinding({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const { t } = useI18n();
  const { toast } = useFeedback();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Binding>(empty);
  const [directory, setDirectory] = useState<Response['directory']>({
    servers: [],
    departments: [],
    stores: [],
  });
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  const path = `/locations/${encodeURIComponent(locationId)}/production-binding`;

  useEffect(
    () => () => {
      generation.current++;
    },
    [locationId],
  );

  const load = async (serverId?: string) => {
    const version = ++generation.current;
    setLoading(true);
    setError('');
    try {
      const value = await request<Response>(
        path + (serverId ? `?serverId=${encodeURIComponent(serverId)}` : ''),
      );
      if (version !== generation.current) return;
      setDirectory(value.directory);
      if (serverId === undefined) setDraft(value.binding || empty);
    } catch (caught) {
      if (version === generation.current)
        setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      if (version === generation.current) setLoading(false);
    }
  };

  const close = () => {
    if (saving || resolving) return;
    generation.current++;
    setOpen(false);
  };
  const stores = directory.stores.filter((row) => row.parentId === draft.departmentId);
  const valid =
    Boolean(draft.serverId && draft.departmentId && draft.sourceStoreId && draft.targetStoreId) &&
    directory.departments.some((row) => row.id === draft.departmentId) &&
    stores.some((row) => row.id === draft.sourceStoreId) &&
    stores.some((row) => row.id === draft.targetStoreId);

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (saving || resolving || loading || !valid) return;
    setSaving(true);
    setError('');
    try {
      await request(path, { method: 'PUT', body: JSON.stringify(draft) });
      setOpen(false);
      toast(t('production.saved'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const select = (
    key: 'departmentId' | 'sourceStoreId' | 'targetStoreId',
    title: string,
    rows: Reference[],
  ) => (
    <label className="field-label">
      {t(title)}
      <select
        value={draft[key]}
        disabled={loading || saving || !draft.serverId}
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            [key]: event.target.value,
            ...(key === 'departmentId' ? { sourceStoreId: '', targetStoreId: '' } : {}),
          }))
        }
      >
        <option value="">{t('production.choose')}</option>
        {rows.map((row) => (
          <option key={row.id} value={row.id}>
            {row.name}
          </option>
        ))}
      </select>
    </label>
  );

  return (
    <>
      <button
        type="button"
        className="icon-button"
        title={t('production.title')}
        aria-label={t('production.title')}
        onClick={() => {
          setOpen(true);
          setDraft(empty);
          setDirectory({ servers: [], departments: [], stores: [] });
          void load();
        }}
      >
        <ClipboardList aria-hidden="true" size={17} />
      </button>
      <Modal open={open} onClose={close} title={`${t('production.title')} · ${name}`} size="md">
        <form className="modal-body form-stack" onSubmit={save} aria-busy={loading || saving}>
          {error && (
            <div className="inline-alert inline-alert-error" role="alert">
              {error}
            </div>
          )}
          {loading && (
            <div role="status" className="inline-flex items-center gap-2">
              <LoaderCircle aria-hidden="true" className="spin" size={17} />
              {t('common.loading')}
            </div>
          )}
          {!loading && directory.servers.length === 0 && <p>{t('production.noServers')}</p>}
          <label className="field-label">
            {t('production.server')}
            <select
              value={draft.serverId}
              disabled={loading || saving}
              onChange={(event) => {
                const serverId = event.target.value;
                setDraft((current) => ({
                  ...current,
                  serverId,
                  departmentId: '',
                  sourceStoreId: '',
                  targetStoreId: '',
                }));
                setDirectory((current) => ({ ...current, departments: [], stores: [] }));
                if (serverId) void load(serverId);
              }}
            >
              <option value="">{t('production.choose')}</option>
              {directory.servers.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
          </label>
          {select('departmentId', 'production.department', directory.departments)}
          {select('sourceStoreId', 'production.source', stores)}
          {select('targetStoreId', 'production.target', stores)}
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={loading || saving}
              onChange={(event) =>
                setDraft((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            {t('production.enabled')}
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={draft.postImmediately}
              disabled={loading || saving}
              onChange={(event) =>
                setDraft((current) => ({ ...current, postImmediately: event.target.checked }))
              }
            />
            {t('production.post')}
          </label>
          <p className="page-help">
            {t(draft.postImmediately ? 'production.postHint' : 'production.draft')}
          </p>
          <div className="modal-actions">
            <button
              type="button"
              className="btn-outline"
              disabled={saving || resolving}
              onClick={close}
            >
              {t('common.cancel')}
            </button>
            <button
              type="submit"
              className="btn-classic"
              disabled={loading || saving || resolving || !valid}
            >
              {t(saving ? 'common.saving' : 'common.save')}
            </button>
          </div>
        </form>
        {open && (
          <ProductionActResolution
            locationId={locationId}
            onBusy={setResolving}
            disabled={saving}
          />
        )}
      </Modal>
    </>
  );
}

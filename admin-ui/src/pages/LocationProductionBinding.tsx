import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ClipboardList, LoaderCircle } from '../components/BulkaIcons';
import Modal from '../components/GuardedModal';
import { useFeedback } from '../components/Feedback';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import ProductionActResolution from './ProductionActResolution';
import './LocationProductionBinding.css';

type Reference = { id: string; name: string; parentId?: string };
type Binding = {
  serverId: string;
  departmentId: string;
  sourceStoreId: string;
  targetStoreId: string;
  enabled: boolean;
  postImmediately: boolean;
};
type RequiredField = 'serverId' | 'departmentId' | 'sourceStoreId' | 'targetStoreId';
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
  const [invalidField, setInvalidField] = useState<RequiredField | null>(null);
  const controls = useRef<Partial<Record<RequiredField, HTMLSelectElement>>>({});
  const id = useId();
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
    setInvalidField(null);
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
  const busy = loading || saving || resolving;
  const fields: [RequiredField, string, Reference[]][] = [
    ['serverId', 'production.server', directory.servers],
    ['departmentId', 'production.department', directory.departments],
    ['sourceStoreId', 'production.source', stores],
    ['targetStoreId', 'production.target', stores],
  ];

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const invalid = fields.find(([key, , rows]) => !rows.some((row) => row.id === draft[key]));
    if (invalid) {
      setInvalidField(invalid[0]);
      setError(
        invalid[2].length
          ? t('production.selectRequired', { field: t(invalid[1]) })
          : t(
              invalid[0] === 'serverId'
                ? 'production.noServers'
                : invalid[0] === 'departmentId'
                  ? 'production.noDepartments'
                  : 'production.noStores',
            ),
      );
      controls.current[invalid[0]]?.focus();
      return;
    }
    setSaving(true);
    setError('');
    setInvalidField(null);
    const version = generation.current;
    try {
      await request(path, { method: 'PUT', body: JSON.stringify(draft) });
      if (version !== generation.current) return;
      setOpen(false);
      toast(t('production.saved'));
    } catch (caught) {
      if (version === generation.current)
        setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      if (version === generation.current) setSaving(false);
    }
  };

  const changeField = (key: RequiredField, value: string) => {
    setError('');
    setInvalidField(null);
    setDraft((current) => ({
      ...current,
      [key]: value,
      ...(key === 'serverId' ? { departmentId: '', sourceStoreId: '', targetStoreId: '' } : {}),
      ...(key === 'departmentId' ? { sourceStoreId: '', targetStoreId: '' } : {}),
    }));
    if (key === 'serverId') {
      generation.current++;
      setLoading(false);
      setDirectory((current) => ({ ...current, departments: [], stores: [] }));
      if (value) void load(value);
    }
  };
  const placeholder = (key: RequiredField) => {
    if (key === 'serverId') return t('production.chooseServer');
    if (!draft.serverId) return t('production.serverFirst');
    if (key === 'departmentId')
      return t(
        directory.departments.length ? 'production.chooseDepartment' : 'production.noDepartments',
      );
    if (!draft.departmentId) return t('production.departmentFirst');
    return t(stores.length ? 'production.chooseStore' : 'production.noStores');
  };

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
      <Modal
        open={open}
        onClose={close}
        title={`${t('production.title')} · ${name}`}
        size="md"
        dismissDisabled={saving || resolving}
        footer={
          <div className="modal-actions production-binding-actions">
            <button
              type="button"
              className="btn-outline"
              disabled={saving || resolving}
              onClick={close}
            >
              {t('common.cancel')}
            </button>
            <button type="submit" form={`${id}-form`} className="btn-classic" disabled={busy}>
              {saving && <LoaderCircle aria-hidden="true" className="spin" size={17} />}
              {t(saving ? 'common.saving' : 'production.saveSettings')}
            </button>
          </div>
        }
      >
        <form
          id={`${id}-form`}
          className="modal-body production-binding-form"
          onSubmit={save}
          noValidate
          aria-busy={busy}
        >
          {error && !invalidField && (
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
          {!loading && !invalidField && directory.servers.length === 0 && (
            <p>{t('production.noServers')}</p>
          )}
          {fields.map(([key, title, rows]) => (
            <div key={key} className="production-binding-field">
              <label htmlFor={`${id}-${key}`} className="production-binding-label">
                {t(title)}{' '}
                <span className="production-binding-required" aria-hidden="true">
                  *
                </span>
              </label>
              <select
                id={`${id}-${key}`}
                className="production-binding-control"
                aria-label={t(title)}
                ref={(element) => {
                  controls.current[key] = element || undefined;
                }}
                value={draft[key]}
                required
                aria-required="true"
                aria-invalid={invalidField === key || undefined}
                aria-describedby={invalidField === key ? `${id}-${key}-error` : undefined}
                disabled={
                  busy ||
                  (key !== 'serverId' && !draft.serverId) ||
                  (['sourceStoreId', 'targetStoreId'].includes(key) && !draft.departmentId)
                }
                onChange={(event) => changeField(key, event.target.value)}
              >
                <option value="">{placeholder(key)}</option>
                {rows.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
              {invalidField === key && (
                <p
                  id={`${id}-${key}-error`}
                  className="field-error production-binding-error"
                  role="alert"
                >
                  {error}
                </p>
              )}
            </div>
          ))}
          <label className="production-binding-checkbox">
            <input
              type="checkbox"
              checked={draft.enabled}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, enabled: event.target.checked }))
              }
            />
            {t('production.enabled')}
          </label>
          <label className="production-binding-checkbox">
            <input
              type="checkbox"
              checked={draft.postImmediately}
              disabled={busy}
              onChange={(event) =>
                setDraft((current) => ({ ...current, postImmediately: event.target.checked }))
              }
            />
            {t('production.post')}
          </label>
          <p className="production-binding-hint">
            {t(draft.postImmediately ? 'production.postHint' : 'production.draft')}
          </p>
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

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  Network,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  UserCog,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api, type OnlineOrderingConfig } from '../lib/api';
import { useI18n } from '../lib/i18n';

interface AccessProfile {
  username: string;
  display_name?: string | null;
  role: string;
  branch_ids: string[];
  active: boolean;
}

interface Location {
  id: string;
  name?: string;
  address?: string;
}

interface StaffDraft {
  phone: string;
  displayName: string;
  role: string;
  branchIds: string[];
}

const roleLabelKeys: Record<string, string> = {
  owner: 'access.role.owner',
  branch_manager: 'access.role.branchManager',
  operator: 'access.role.operator',
  marketer: 'access.role.marketer',
  courier: 'access.role.courier',
  editor: 'access.role.editor',
  viewer: 'access.role.viewer',
};
const emptyDraft = (): StaffDraft => ({
  phone: '',
  displayName: '',
  role: 'operator',
  branchIds: [],
});
const isPhoneProfile = (username: string) => /^\+7\d{10}$/.test(username);
const emptyOnlineOrdering = (): OnlineOrderingConfig => ({ disabled: false });

export default function AccessPage() {
  const { toast } = useFeedback();
  const { t } = useI18n();
  const roleLabels = Object.fromEntries(Object.entries(roleLabelKeys).map(([role, key]) => [role, t(key)]));
  const staffRoleLabels = Object.fromEntries(
    Object.entries(roleLabels).filter(([role]) => !['owner', 'editor'].includes(role)),
  );
  const [profiles, setProfiles] = useState<AccessProfile[]>([]);
  const [configured, setConfigured] = useState<string[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<StaffDraft>(emptyDraft);
  const [onlineOrdering, setOnlineOrdering] = useState<OnlineOrderingConfig>(emptyOnlineOrdering);
  const [savingOnlineOrdering, setSavingOnlineOrdering] = useState(false);
  const [disableOrderingConfirmOpen, setDisableOrderingConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [access, branches, onlineOrderingResponse] = await Promise.all([
        api.getAccessProfiles(),
        api.getFulfillmentLocations(),
        api.getOnlineOrdering(),
      ]);
      const configuredUsers = access.configuredUsers ?? [];
      const existing = new Map<string, AccessProfile>(
        (access.profiles ?? []).map((profile: AccessProfile) => [profile.username, profile]),
      );
      setProfiles(
        configuredUsers.map(
          (username) =>
            existing.get(username) ?? {
              username,
              role: username === 'admin' ? 'owner' : 'viewer',
              display_name: '',
              branch_ids: [],
              active: true,
            },
        ),
      );
      setConfigured(configuredUsers);
      setLocations(branches.locations ?? []);
      setOnlineOrdering(onlineOrderingResponse.config ?? emptyOnlineOrdering());
      setError('');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('access.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const patchProfile = (username: string, data: Partial<AccessProfile>) => {
    setProfiles((current) =>
      current.map((item) => (item.username === username ? { ...item, ...data } : item)),
    );
  };

  const patchDraftBranch = (branchId: string, selected: boolean) => {
    setDraft((current) => ({
      ...current,
      branchIds: selected
        ? [...current.branchIds, branchId]
        : current.branchIds.filter((id) => id !== branchId),
    }));
  };

  const toggleOnlineOrdering = (disabled: boolean) => {
    if (disabled) {
      setDisableOrderingConfirmOpen(true);
      return;
    }
    setOnlineOrdering({ disabled: false });
  };

  const confirmDisableOnlineOrdering = () => {
    setOnlineOrdering({ disabled: true });
    setDisableOrderingConfirmOpen(false);
  };

  const saveOnlineOrdering = async () => {
    setSavingOnlineOrdering(true);
    try {
      const response = await api.updateOnlineOrdering(onlineOrdering);
      setOnlineOrdering(response.config);
      toast(
        response.config.disabled
          ? t('access.onlineOrderingOffState')
          : t('access.onlineOrderingOnState'),
      );
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('access.siteSaveError'), 'error');
    } finally {
      setSavingOnlineOrdering(false);
    }
  };

  const save = async (profile: AccessProfile) => {
    setSaving(profile.username);
    try {
      await api.updateAccessProfile(profile.username, {
        displayName: profile.display_name,
        role: profile.role,
        branchIds: profile.branch_ids || [],
        active: profile.active !== false,
      });
      toast(t('access.permissionsSaved', { name: profile.display_name || profile.username }));
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('access.permissionsSaveError'), 'error');
    } finally {
      setSaving('');
    }
  };

  const createStaff = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.phone.trim() || !draft.displayName.trim() || creating) return;
    setCreating(true);
    try {
      await api.createAccessProfile({
        phone: draft.phone,
        displayName: draft.displayName,
        role: draft.role,
        branchIds: draft.branchIds,
      });
      toast(t('access.staffAdded', { name: draft.displayName.trim() }));
      setCreateOpen(false);
      setDraft(emptyDraft());
      await load();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('access.staffAddError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  if (loading && !profiles.length) return <PageState type="loading" />;
  if (error && !profiles.length) {
    return <PageState type="error" description={error} onRetry={load} />;
  }

  return (
    <div className="page-stack">
      <div className="page-actions-row">
        <div>
          <h2 className="content-heading">{t('access.heading')}</h2>
          <p className="page-help">{t('access.intro')}</p>
        </div>
        <div className="access-page-buttons">
          <button
            className="btn-classic px-5 inline-flex items-center gap-2"
            type="button"
            onClick={() => setCreateOpen(true)}
          >
            <Plus aria-hidden="true" size={17} />
            {t('access.addStaff')}
          </button>
          <button
            className="btn-outline px-5 inline-flex items-center gap-2"
            type="button"
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" size={17} />
            {t('common.refresh')}
          </button>
        </div>
      </div>

      <section
        className={`card site-access-card online-ordering-card ${
          onlineOrdering.disabled ? 'is-disabled' : ''
        }`}
        aria-labelledby="online-ordering-title"
      >
        <header className="site-access-header">
          <div className="site-access-heading">
            <span className="site-access-icon online-ordering-icon" aria-hidden="true">
              <Network size={23} />
            </span>
            <div>
              <h3 id="online-ordering-title">{t('access.onlineOrdering')}</h3>
            </div>
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={onlineOrdering.disabled}
              disabled={savingOnlineOrdering}
              onChange={(event) => toggleOnlineOrdering(event.target.checked)}
              aria-describedby="online-ordering-state"
            />
            <span className="switch-control" />
            <span>{onlineOrdering.disabled ? t('common.disabled') : t('common.enabled')}</span>
          </label>
        </header>

        <div
          id="online-ordering-state"
          className={`site-access-state ${onlineOrdering.disabled ? 'is-disabled' : 'is-enabled'}`}
          role="status"
          aria-live="polite"
        >
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            {onlineOrdering.disabled
              ? t('access.onlineOrderingOffState')
              : t('access.onlineOrderingOnState')}
          </span>
        </div>

        <footer className="site-access-footer">
          <p>{t('access.onlineOrderingScope')}</p>
          <button
            className="btn-classic px-5 inline-flex items-center gap-2"
            type="button"
            disabled={savingOnlineOrdering}
            onClick={() => void saveOnlineOrdering()}
          >
            <Save size={17} aria-hidden="true" />
            {savingOnlineOrdering ? t('common.saving') : t('common.save')}
          </button>
        </footer>
      </section>

      <div className="inline-alert inline-alert-info">
        <ShieldCheck size={17} />
        {t('access.accountsHint', { count: configured.length })}
      </div>

      <section className="access-grid">
        {profiles.length === 0 ? <PageState type="empty" title={t('access.noAccounts')} /> : profiles.map((profile) => {
          const phoneLogin = isPhoneProfile(profile.username);
          const availableRoles = phoneLogin ? staffRoleLabels : roleLabels;
          return (
            <article className="card access-card" key={profile.username}>
              <header>
                <div className="access-avatar">
                  <UserCog size={21} />
                </div>
                <div>
                  <h3>{profile.display_name || profile.username}</h3>
                  <p className="mono">{profile.username}</p>
                  {phoneLogin && (
                    <p className="access-login-method">
                      <Phone aria-hidden="true" size={13} /> {t('access.whatsappLogin')}
                    </p>
                  )}
                </div>
                <label className="switch-row">
                  <input
                    type="checkbox"
                    checked={profile.active !== false}
                    onChange={(event) =>
                      patchProfile(profile.username, { active: event.target.checked })
                    }
                  />
                  <span className="switch-control" />
                  <span>{profile.active !== false ? t('common.active') : t('common.disabled')}</span>
                </label>
              </header>

              <div className="form-grid form-grid-2">
                <label className="field-group">
                  <span className="field-label">{t('access.staffName')}</span>
                  <input
                    name={`displayName-${profile.username}`}
                    autoComplete="off"
                    className="input-classic"
                    value={profile.display_name || ''}
                    onChange={(event) =>
                      patchProfile(profile.username, { display_name: event.target.value })
                    }
                  />
                </label>
                <label className="field-group">
                  <span className="field-label">{t('access.roleAndPermissions')}</span>
                  <SelectControl
                    name={`role-${profile.username}`}
                    value={profile.role}
                    onChange={(value) => patchProfile(profile.username, { role: value })}
                    options={Object.entries(availableRoles).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </label>
              </div>

              {profile.role !== 'owner' && (
                <fieldset className="branch-access">
                  <legend>
                    <Building2 aria-hidden="true" size={16} /> {t('access.availableBranches')}
                  </legend>
                  {locations.length ? (
                    locations.map((location) => (
                      <label key={location.id}>
                        <input
                          type="checkbox"
                          checked={(profile.branch_ids || []).includes(location.id)}
                          onChange={(event) =>
                            patchProfile(profile.username, {
                              branch_ids: event.target.checked
                                ? [...(profile.branch_ids || []), location.id]
                                : (profile.branch_ids || []).filter((id) => id !== location.id),
                            })
                          }
                        />
                        <span>
                          {location.name} · {location.address}
                        </span>
                      </label>
                    ))
                  ) : (
                    <p className="page-help">{t('access.noBranches')}</p>
                  )}
                </fieldset>
              )}

              <button
                className="btn-classic inline-flex items-center gap-2"
                type="button"
                disabled={saving === profile.username}
                onClick={() => void save(profile)}
              >
                <Save aria-hidden="true" size={16} />
                {saving === profile.username ? t('common.saving') : t('access.savePermissions')}
              </button>
            </article>
          );
        })}
      </section>

      <Modal
        open={disableOrderingConfirmOpen}
        title={t('access.onlineOrdering')}
        description={t('access.onlineOrderingOffState')}
        onClose={() => setDisableOrderingConfirmOpen(false)}
        size="sm"
      >
        <div className="modal-body form-stack">
          <div className="modal-actions">
            <button
              className="btn-outline"
              type="button"
              onClick={() => setDisableOrderingConfirmOpen(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-danger inline-flex items-center gap-2"
              type="button"
              onClick={confirmDisableOnlineOrdering}
              autoFocus
            >
              {t('common.confirm')}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={createOpen}
        title={t('access.newStaff')}
        description={t('access.newStaffHint')}
        onClose={() => !creating && setCreateOpen(false)}
        size="lg"
      >
        <form className="modal-body form-stack" onSubmit={createStaff}>
          <div className="form-grid form-grid-2">
            <label className="field-group">
              <span className="field-label">{t('access.phone')}</span>
              <input
                name="staffPhone"
                className="input-classic"
                type="tel"
                autoComplete="tel"
                required
                value={draft.phone}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, phone: event.target.value }))
                }
                placeholder="+7 700 000 00 00"
              />
            </label>
            <label className="field-group">
              <span className="field-label">{t('access.staffName')}</span>
              <input
                name="staffDisplayName"
                className="input-classic"
                autoComplete="name"
                required
                maxLength={160}
                value={draft.displayName}
                onChange={(event) =>
                  setDraft((current) => ({ ...current, displayName: event.target.value }))
                }
                placeholder={t('access.namePlaceholder')}
              />
            </label>
          </div>

          <label className="field-group">
            <span className="field-label">{t('access.roleAndPermissions')}</span>
            <SelectControl
              name="staffRole"
              value={draft.role}
              onChange={(value) => setDraft((current) => ({ ...current, role: value }))}
              options={Object.entries(staffRoleLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </label>

          <fieldset className="branch-access">
            <legend>
              <Building2 aria-hidden="true" size={16} /> {t('access.availableBranches')}
            </legend>
            {locations.length ? (
              locations.map((location) => (
                <label key={location.id}>
                  <input
                    type="checkbox"
                    checked={draft.branchIds.includes(location.id)}
                    onChange={(event) => patchDraftBranch(location.id, event.target.checked)}
                  />
                  <span>
                    {location.name} · {location.address}
                  </span>
                </label>
              ))
            ) : (
              <p className="page-help">{t('access.noBranches')}</p>
            )}
          </fieldset>

          <div className="inline-alert inline-alert-info">
            <Phone aria-hidden="true" size={17} />
            {t('access.loginHint')}
          </div>

          <div className="modal-actions">
            <button
              className="btn-outline"
              type="button"
              disabled={creating}
              onClick={() => setCreateOpen(false)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-classic inline-flex items-center gap-2"
              type="submit"
              disabled={creating || !draft.phone.trim() || !draft.displayName.trim()}
            >
              <Plus aria-hidden="true" size={16} />
              {creating ? t('access.adding') : t('access.addStaff')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

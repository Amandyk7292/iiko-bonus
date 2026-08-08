import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Network,
  Phone,
  Plus,
  RefreshCw,
  RotateCcw,
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
  authMethod?: 'password' | 'whatsapp' | 'environment';
  passwordConfigured?: boolean;
}

interface Location {
  id: string;
  name?: string;
  address?: string;
}

interface StaffDraft {
  mode: 'phone' | 'cashier';
  phone: string;
  username: string;
  password: string;
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
  cashier: 'access.role.cashier',
  editor: 'access.role.editor',
  viewer: 'access.role.viewer',
};
const emptyDraft = (): StaffDraft => ({
  mode: 'cashier',
  phone: '',
  username: '',
  password: '',
  displayName: '',
  role: 'cashier',
  branchIds: [],
});
const isPhoneProfile = (username: string) => /^\+7\d{10}$/.test(username);
const emptyOnlineOrdering = (): OnlineOrderingConfig => ({ disabled: false });

export default function AccessPage() {
  const { toast } = useFeedback();
  const { t } = useI18n();
  const roleLabels = Object.fromEntries(
    Object.entries(roleLabelKeys).map(([role, key]) => [role, t(key)]),
  );
  const staffRoleLabels = Object.fromEntries(
    Object.entries(roleLabels).filter(([role]) => !['owner', 'editor', 'cashier'].includes(role)),
  );
  const environmentRoleLabels = Object.fromEntries(
    Object.entries(roleLabels).filter(([role]) => role !== 'cashier'),
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
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [passwordProfile, setPasswordProfile] = useState<AccessProfile | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [showResetPassword, setShowResetPassword] = useState(false);
  const [resettingPassword, setResettingPassword] = useState(false);
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
              authMethod: username === 'admin' ? 'environment' : undefined,
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
      branchIds:
        current.mode === 'cashier'
          ? selected
            ? [branchId]
            : []
          : selected
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
    const cashier = draft.mode === 'cashier';
    if (
      !draft.displayName.trim() ||
      creating ||
      (cashier
        ? !draft.username.trim() || !draft.password || draft.branchIds.length !== 1
        : !draft.phone.trim())
    ) {
      return;
    }
    setCreating(true);
    try {
      await api.createAccessProfile(
        cashier
          ? {
              username: draft.username,
              password: draft.password,
              displayName: draft.displayName,
              role: 'cashier',
              branchIds: draft.branchIds,
            }
          : {
              phone: draft.phone,
              displayName: draft.displayName,
              role: draft.role,
              branchIds: draft.branchIds,
            },
      );
      toast(t('access.staffAdded', { name: draft.displayName.trim() }));
      setCreateOpen(false);
      setDraft(emptyDraft());
      setShowCreatePassword(false);
      await load();
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('access.staffAddError'), 'error');
    } finally {
      setCreating(false);
    }
  };

  const openPasswordReset = (profile: AccessProfile) => {
    setPasswordProfile(profile);
    setNewPassword('');
    setShowResetPassword(false);
  };

  const closeCreate = () => {
    if (creating) return;
    setCreateOpen(false);
    setDraft(emptyDraft());
    setShowCreatePassword(false);
  };

  const resetPassword = async (event: FormEvent) => {
    event.preventDefault();
    if (!passwordProfile || !newPassword || resettingPassword) return;
    setResettingPassword(true);
    try {
      await api.resetAccessPassword(passwordProfile.username, newPassword);
      toast(
        t('access.passwordResetDone', {
          name: passwordProfile.display_name || passwordProfile.username,
        }),
      );
      setPasswordProfile(null);
      setNewPassword('');
    } catch (caught) {
      toast(caught instanceof Error ? caught.message : t('access.passwordResetError'), 'error');
    } finally {
      setResettingPassword(false);
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
            onClick={() => {
              setDraft(emptyDraft());
              setShowCreatePassword(false);
              setCreateOpen(true);
            }}
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
        {profiles.length === 0 ? (
          <PageState type="empty" title={t('access.noAccounts')} />
        ) : (
          profiles.map((profile) => {
            const phoneLogin = isPhoneProfile(profile.username);
            const cashierProfile = profile.role === 'cashier' || profile.authMethod === 'password';
            const availableRoles = cashierProfile
              ? { cashier: roleLabels.cashier }
              : phoneLogin
                ? staffRoleLabels
                : environmentRoleLabels;
            return (
              <article className="card access-card" key={profile.username}>
                <header>
                  <div className="access-avatar">
                    <UserCog size={21} />
                  </div>
                  <div>
                    <h3>{profile.display_name || profile.username}</h3>
                    <p className="mono">{profile.username}</p>
                    {(phoneLogin || cashierProfile) && (
                      <p className="access-login-method">
                        {cashierProfile ? (
                          <KeyRound aria-hidden="true" size={13} />
                        ) : (
                          <Phone aria-hidden="true" size={13} />
                        )}
                        {cashierProfile ? t('access.passwordLogin') : t('access.whatsappLogin')}
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
                    <span>
                      {profile.active !== false ? t('common.active') : t('common.disabled')}
                    </span>
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
                      disabled={cashierProfile}
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
                            type={cashierProfile ? 'radio' : 'checkbox'}
                            name={cashierProfile ? `cashier-branch-${profile.username}` : undefined}
                            checked={(profile.branch_ids || []).includes(location.id)}
                            onChange={(event) =>
                              patchProfile(profile.username, {
                                branch_ids: cashierProfile
                                  ? event.target.checked
                                    ? [location.id]
                                    : profile.branch_ids
                                  : event.target.checked
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

                <div className="action-cluster">
                  {cashierProfile && (
                    <button
                      className="btn-outline inline-flex items-center gap-2"
                      type="button"
                      onClick={() => openPasswordReset(profile)}
                    >
                      <RotateCcw aria-hidden="true" size={16} />
                      {t('access.resetPassword')}
                    </button>
                  )}
                  <button
                    className="btn-classic inline-flex items-center gap-2"
                    type="button"
                    disabled={
                      saving === profile.username ||
                      (cashierProfile && profile.branch_ids.length !== 1)
                    }
                    onClick={() => void save(profile)}
                  >
                    <Save aria-hidden="true" size={16} />
                    {saving === profile.username ? t('common.saving') : t('access.savePermissions')}
                  </button>
                </div>
              </article>
            );
          })
        )}
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
        onClose={closeCreate}
        size="lg"
      >
        <form className="modal-body form-stack" onSubmit={createStaff}>
          <div className="segmented-control" role="group" aria-label={t('access.accountType')}>
            <button
              type="button"
              className={draft.mode === 'cashier' ? 'is-active' : ''}
              aria-pressed={draft.mode === 'cashier'}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  mode: 'cashier',
                  role: 'cashier',
                  phone: '',
                  branchIds: current.branchIds.slice(0, 1),
                }))
              }
            >
              <LockKeyhole aria-hidden="true" size={17} />
              {t('access.cashierAccount')}
            </button>
            <button
              type="button"
              className={draft.mode === 'phone' ? 'is-active' : ''}
              aria-pressed={draft.mode === 'phone'}
              onClick={() =>
                setDraft((current) => ({
                  ...current,
                  mode: 'phone',
                  role: 'operator',
                  username: '',
                  password: '',
                }))
              }
            >
              <Phone aria-hidden="true" size={17} />
              {t('access.whatsappAccount')}
            </button>
          </div>

          <div className="form-grid form-grid-2">
            {draft.mode === 'cashier' ? (
              <label className="field-group">
                <span className="field-label">{t('access.username')}</span>
                <input
                  name="staffUsername"
                  className="input-classic"
                  type="text"
                  autoComplete="username"
                  required
                  minLength={3}
                  maxLength={64}
                  pattern="[a-z0-9][a-z0-9._-]{2,63}"
                  spellCheck={false}
                  value={draft.username}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      username: event.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''),
                    }))
                  }
                  placeholder="cashier.aktau.1"
                />
              </label>
            ) : (
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
            )}
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

          {draft.mode === 'cashier' ? (
            <div className="field-group">
              <label className="field-label" htmlFor="staff-password">
                {t('access.password')}
              </label>
              <span className="password-field">
                <input
                  id="staff-password"
                  name="staffPassword"
                  className="input-classic w-full"
                  type={showCreatePassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  required
                  minLength={10}
                  maxLength={72}
                  value={draft.password}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, password: event.target.value }))
                  }
                  aria-describedby="cashier-password-hint"
                />
                <button
                  type="button"
                  className="icon-button password-toggle"
                  onClick={() => setShowCreatePassword((current) => !current)}
                  aria-label={showCreatePassword ? t('auth.hidePassword') : t('auth.showPassword')}
                  title={showCreatePassword ? t('auth.hidePassword') : t('auth.showPassword')}
                >
                  {showCreatePassword ? (
                    <EyeOff aria-hidden="true" size={18} />
                  ) : (
                    <Eye aria-hidden="true" size={18} />
                  )}
                </button>
              </span>
              <small id="cashier-password-hint" className="field-hint">
                {t('access.passwordHint')}
              </small>
            </div>
          ) : (
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
          )}

          <fieldset className="branch-access">
            <legend>
              <Building2 aria-hidden="true" size={16} /> {t('access.availableBranches')}
            </legend>
            {locations.length ? (
              locations.map((location) => (
                <label key={location.id}>
                  <input
                    type={draft.mode === 'cashier' ? 'radio' : 'checkbox'}
                    name={draft.mode === 'cashier' ? 'new-cashier-branch' : undefined}
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
            {draft.mode === 'cashier' ? (
              <KeyRound aria-hidden="true" size={17} />
            ) : (
              <Phone aria-hidden="true" size={17} />
            )}
            {draft.mode === 'cashier' ? t('access.cashierLoginHint') : t('access.loginHint')}
          </div>

          <div className="modal-actions">
            <button className="btn-outline" type="button" disabled={creating} onClick={closeCreate}>
              {t('common.cancel')}
            </button>
            <button
              className="btn-classic inline-flex items-center gap-2"
              type="submit"
              disabled={
                creating ||
                !draft.displayName.trim() ||
                (draft.mode === 'cashier'
                  ? !draft.username.trim() ||
                    draft.password.length < 10 ||
                    draft.branchIds.length !== 1
                  : !draft.phone.trim())
              }
            >
              <Plus aria-hidden="true" size={16} />
              {creating ? t('access.adding') : t('access.addStaff')}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={Boolean(passwordProfile)}
        title={t('access.resetPassword')}
        description={t('access.resetPasswordHint', {
          name: passwordProfile?.display_name || passwordProfile?.username || '',
        })}
        onClose={() => !resettingPassword && setPasswordProfile(null)}
        size="sm"
      >
        <form className="modal-body form-stack" onSubmit={resetPassword}>
          <div className="field-group">
            <label className="field-label" htmlFor="reset-cashier-password">
              {t('access.newPassword')}
            </label>
            <span className="password-field">
              <input
                id="reset-cashier-password"
                name="newCashierPassword"
                className="input-classic w-full"
                type={showResetPassword ? 'text' : 'password'}
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={72}
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                aria-describedby="reset-cashier-password-hint"
              />
              <button
                type="button"
                className="icon-button password-toggle"
                onClick={() => setShowResetPassword((current) => !current)}
                aria-label={showResetPassword ? t('auth.hidePassword') : t('auth.showPassword')}
                title={showResetPassword ? t('auth.hidePassword') : t('auth.showPassword')}
              >
                {showResetPassword ? (
                  <EyeOff aria-hidden="true" size={18} />
                ) : (
                  <Eye aria-hidden="true" size={18} />
                )}
              </button>
            </span>
            <small id="reset-cashier-password-hint" className="field-hint">
              {t('access.passwordHint')}
            </small>
          </div>
          <div className="inline-alert inline-alert-info">
            <ShieldCheck aria-hidden="true" size={17} />
            {t('access.resetRevokesSessions')}
          </div>
          <div className="modal-actions">
            <button
              className="btn-outline"
              type="button"
              disabled={resettingPassword}
              onClick={() => setPasswordProfile(null)}
            >
              {t('common.cancel')}
            </button>
            <button
              className="btn-classic inline-flex items-center gap-2"
              type="submit"
              disabled={resettingPassword || newPassword.length < 10}
            >
              <RotateCcw aria-hidden="true" size={16} />
              {resettingPassword ? t('common.saving') : t('access.resetPassword')}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

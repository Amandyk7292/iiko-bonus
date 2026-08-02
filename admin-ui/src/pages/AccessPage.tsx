import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  Building2,
  Globe2,
  Network,
  Phone,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  UserCog,
} from 'lucide-react';
import Modal from '../components/Modal';
import PageState from '../components/PageState';
import SelectControl from '../components/SelectControl';
import { useFeedback } from '../components/Feedback';
import { api, type SiteAccessConfig } from '../lib/api';
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
const emptySiteAccess = (): SiteAccessConfig => ({ enabled: false, allowedIps: [] });

const looksLikeIpAddress = (value: string) => {
  const candidate = value.trim().replace(/^\[|\]$/g, '');
  if (!candidate || candidate.length > 64 || /\s|\//.test(candidate)) return false;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(candidate)) {
    return candidate.split('.').every((part) => Number(part) >= 0 && Number(part) <= 255);
  }
  return candidate.includes(':') && /^[0-9a-f:.]+$/i.test(candidate);
};

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
  const [siteAccess, setSiteAccess] = useState<SiteAccessConfig>(emptySiteAccess);
  const [currentIp, setCurrentIp] = useState('');
  const [ipInput, setIpInput] = useState('');
  const [ipError, setIpError] = useState('');
  const [savingSiteAccess, setSavingSiteAccess] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [access, branches, siteAccessResponse] = await Promise.all([
        api.getAccessProfiles(),
        api.getFulfillmentLocations(),
        api.getSiteAccess(),
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
      setSiteAccess(siteAccessResponse.config ?? emptySiteAccess());
      setCurrentIp(siteAccessResponse.currentIp ?? '');
      setIpError('');
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

  const appendAllowedIp = (rawIp: string) => {
    const candidate = rawIp.trim().replace(/^\[|\]$/g, '');
    if (!looksLikeIpAddress(candidate)) {
      setIpError(t('access.ipInvalid'));
      return false;
    }
    if (siteAccess.allowedIps.some((ip) => ip.toLowerCase() === candidate.toLowerCase())) {
      setIpError(t('access.ipDuplicate'));
      return false;
    }
    setSiteAccess((current) => ({
      ...current,
      allowedIps: [...current.allowedIps, candidate],
    }));
    setIpInput('');
    setIpError('');
    return true;
  };

  const addAllowedIp = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    appendAllowedIp(ipInput);
  };

  const addCurrentIp = () => {
    if (!currentIp) {
      setIpError(t('access.currentIpUnknown'));
      return;
    }
    appendAllowedIp(currentIp);
  };

  const removeAllowedIp = (ip: string) => {
    setSiteAccess((current) => ({
      ...current,
      allowedIps: current.allowedIps.filter((item) => item !== ip),
      enabled: current.enabled && current.allowedIps.length > 1,
    }));
    setIpError('');
  };

  const toggleSiteAccess = (enabled: boolean) => {
    if (enabled && siteAccess.allowedIps.length === 0) {
      setIpError(t('access.addIpFirst'));
      return;
    }
    setSiteAccess((current) => ({ ...current, enabled }));
    setIpError('');
  };

  const saveSiteAccess = async () => {
    if (siteAccess.enabled && siteAccess.allowedIps.length === 0) {
      setIpError(t('access.addIpBeforeEnable'));
      return;
    }
    setSavingSiteAccess(true);
    try {
      const response = await api.updateSiteAccess(siteAccess);
      setSiteAccess(response.config);
      setCurrentIp(response.currentIp ?? currentIp);
      setIpError('');
      toast(
        response.config.enabled
          ? t('access.restrictionSavedOn')
          : t('access.restrictionSavedOff'),
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : t('access.siteSaveError');
      setIpError(message);
      toast(message, 'error');
    } finally {
      setSavingSiteAccess(false);
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

      <section className="card site-access-card" aria-labelledby="site-access-title">
        <header className="site-access-header">
          <div className="site-access-heading">
            <span className="site-access-icon" aria-hidden="true">
              <Globe2 size={23} />
            </span>
            <div>
              <h3 id="site-access-title">{t('access.publicSite')}</h3>
              <p>{t('access.publicSiteHint')}</p>
            </div>
          </div>
          <label className="switch-row">
            <input
              type="checkbox"
              checked={siteAccess.enabled}
              onChange={(event) => toggleSiteAccess(event.target.checked)}
            />
            <span className="switch-control" />
            <span>{siteAccess.enabled ? t('access.restrictionEnabled') : t('access.siteOpen')}</span>
          </label>
        </header>

        <div
          className={`site-access-state ${siteAccess.enabled ? 'is-enabled' : ''}`}
          role="status"
          aria-live="polite"
        >
          <ShieldCheck size={18} aria-hidden="true" />
          <span>
            {siteAccess.enabled
              ? t('access.restrictedState', { count: siteAccess.allowedIps.length })
              : t('access.openState')}
          </span>
        </div>

        <div className="site-access-current">
          <div>
            <span>{t('access.currentIp')}</span>
            <strong className="mono tabular">{currentIp || t('access.notDetected')}</strong>
          </div>
          <button
            className="btn-outline px-4 inline-flex items-center gap-2"
            type="button"
            disabled={
              !currentIp ||
              siteAccess.allowedIps.some((ip) => ip.toLowerCase() === currentIp.toLowerCase())
            }
            onClick={addCurrentIp}
          >
            <Network size={17} aria-hidden="true" />
            {t('access.addMyIp')}
          </button>
        </div>

        <form className="site-access-add-form" onSubmit={addAllowedIp} noValidate>
          <div className="field-group">
            <label className="field-label" htmlFor="allowed-ip-address">
              {t('access.newAllowedIp')}
            </label>
            <span className="site-access-input-row">
              <input
                id="allowed-ip-address"
                name="allowedIp"
                className="input-classic mono"
                value={ipInput}
                onChange={(event) => {
                  setIpInput(event.target.value);
                  setIpError('');
                }}
                placeholder={t('access.ipPlaceholder')}
                maxLength={64}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                aria-invalid={Boolean(ipError)}
                aria-describedby="allowed-ip-hint allowed-ip-error"
              />
              <button
                className="btn-classic px-5 inline-flex items-center gap-2"
                type="submit"
                disabled={!ipInput.trim()}
              >
                <Plus size={17} aria-hidden="true" />
                {t('access.add')}
              </button>
            </span>
            <span className="field-hint" id="allowed-ip-hint">
              {t('access.ipHint')}
            </span>
            <span className="field-error" id="allowed-ip-error" role="alert">
              {ipError}
            </span>
          </div>
        </form>

        <div className="site-access-list-block">
          <div className="site-access-list-heading">
            <h4>{t('access.allowedIps')}</h4>
            <span className="site-access-count">{siteAccess.allowedIps.length}</span>
          </div>
          {siteAccess.allowedIps.length ? (
            <ul className="site-access-list">
              {siteAccess.allowedIps.map((ip) => (
                <li key={ip}>
                  <span className="mono tabular">{ip}</span>
                  <button
                    className="icon-button icon-button-danger"
                    type="button"
                    onClick={() => removeAllowedIp(ip)}
                    aria-label={t('access.removeIp', { ip })}
                  >
                    <Trash2 size={17} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="site-access-empty">
              <Network size={22} aria-hidden="true" />
              <div>
                <strong>{t('access.ipListEmpty')}</strong>
                <span>{t('access.ipListEmptyHint')}</span>
              </div>
            </div>
          )}
        </div>

        <footer className="site-access-footer">
          <p>
            {t('access.scopeHint')}
          </p>
          <button
            className="btn-classic px-5 inline-flex items-center gap-2"
            type="button"
            disabled={savingSiteAccess}
            onClick={() => void saveSiteAccess()}
          >
            <Save size={17} aria-hidden="true" />
            {savingSiteAccess ? t('common.saving') : t('access.saveSiteAccess')}
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

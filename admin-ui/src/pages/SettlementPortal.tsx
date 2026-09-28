import { useEffect, useState } from 'react';
import { request } from '../lib/api';
import { useI18n } from '../lib/i18n';
import SelectControl from '../components/SelectControl';
import type { Config } from './settlements-model';
type Access = {
  users: { username: string; display_name: string; active: boolean }[];
  links: { username: string; partner_id: string }[];
};
export default function SettlementPortal({ config }: { config: Config }) {
  const { t } = useI18n();
  const [data, setData] = useState<Access>({ users: [], links: [] }),
    [username, setUsername] = useState(''),
    [partner, setPartner] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(''),
    [error, setError] = useState('');
  useEffect(() => {
    request<Access>('/transactions/settlements/portal-users')
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  async function save() {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await request('/transactions/settlements/portal-users', {
        method: 'POST',
        body: JSON.stringify({ username, partner }),
      });
      setData(await request<Access>('/transactions/settlements/portal-users'));
      setMessage(t('settlements.portal.saved'));
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settlements.copy58'));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="card">
      <details>
        <summary>{t('settlements.portal.title')}</summary>
        <div className="form-stack">
          <p>{t('settlements.portal.note')}</p>
          <div className="field-group">
            <label htmlFor="portal-user">{t('settlements.portal.user')}</label>
            <SelectControl
              id="portal-user"
              disabled={busy}
              value={username}
              onChange={(v) => {
                setUsername(v);
                setPartner(data.links.find((l) => l.username === v)?.partner_id || '');
                setMessage('');
              }}
              options={[
                { value: '', label: t('settlements.month.choose') },
                ...data.users
                  .filter((u) => u.active)
                  .map((u) => ({ value: u.username, label: u.display_name || u.username })),
              ]}
            />
          </div>
          <div className="field-group">
            <label htmlFor="portal-partner">{t('settlements.copy42')}</label>
            <SelectControl
              id="portal-partner"
              disabled={busy}
              value={partner}
              onChange={setPartner}
              options={[
                { value: '', label: t('settlements.month.choose') },
                ...config.partners.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
          </div>
          {error && (
            <p role="alert" className="inline-alert-error">
              {error}
            </p>
          )}
          {message && <p role="status">{message}</p>}
          <button
            className="btn-outline"
            disabled={busy || !username || !partner}
            onClick={() => void save()}
          >
            {t('settlements.portal.save')}
          </button>
        </div>
      </details>
    </section>
  );
}

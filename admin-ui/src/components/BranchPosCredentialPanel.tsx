import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Copy, KeyRound, LoaderCircle, ShieldAlert } from 'lucide-react';
import { api, type BranchPosCredentialSecret, type BranchPosCredentialStatus } from '../lib/api';
import { useI18n } from '../lib/i18n';
import { useFeedback } from './Feedback';
import Modal from './Modal';

export default function BranchPosCredentialPanel({
  locationId,
  canRotate,
}: {
  locationId: string;
  canRotate: boolean;
}) {
  const { t, locale } = useI18n();
  const { confirm, toast } = useFeedback();
  const [status, setStatus] = useState<BranchPosCredentialStatus | null>(null);
  const [secret, setSecret] = useState<BranchPosCredentialSecret | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .getBranchPosCredential(locationId)
      .then((result) => {
        if (active) setStatus(result.credential);
      })
      .catch((caught) => {
        if (active) setError(caught instanceof Error ? caught.message : t('common.loadError'));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [locationId, t]);

  const configuration = useMemo(
    () =>
      secret ? `IIKO_BRANCH_ID=${secret.branchId}\nIIKO_BRANCH_POS_TOKEN=${secret.token}` : '',
    [secret],
  );

  const rotate = async () => {
    if (rotating) return;
    const replacing = status?.configured === true;
    const accepted = await confirm({
      title: t(replacing ? 'locations.posReplaceConfirmTitle' : 'locations.posCreateConfirmTitle'),
      body: t(replacing ? 'locations.posReplaceConfirmBody' : 'locations.posCreateConfirmBody'),
      confirmLabel: t(replacing ? 'locations.posReplaceKey' : 'locations.posCreateKey'),
      destructive: true,
    });
    if (!accepted) return;
    setRotating(true);
    setError('');
    try {
      const result = await api.rotateBranchPosCredential(locationId);
      setSecret(result.credential);
      setStatus((current) => ({
        branchId: result.credential.branchId,
        branchName: current?.branchName ?? null,
        branchActive: current?.branchActive ?? true,
        configured: true,
        version: result.credential.version,
        rotatedBy: null,
        rotatedAt: result.credential.rotatedAt,
      }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t('common.error'));
    } finally {
      setRotating(false);
    }
  };

  const copyConfiguration = async () => {
    if (!configuration) return;
    try {
      await navigator.clipboard.writeText(configuration);
      toast(t('locations.posCopied'));
    } catch {
      setError(t('locations.posCopyFailed'));
    }
  };

  const rotatedAt = status?.rotatedAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
        new Date(status.rotatedAt),
      )
    : null;

  return (
    <>
      <fieldset className="form-section">
        <legend>{t('locations.posTitle')}</legend>
        <p className="page-help">{t('locations.posHint')}</p>
        {loading ? (
          <div className="inline-flex items-center gap-2" role="status">
            <LoaderCircle aria-hidden="true" className="spin" size={17} />
            {t('common.loading')}
          </div>
        ) : (
          <div className="location-summary">
            {status?.configured ? (
              <CheckCircle2 aria-hidden="true" size={20} />
            ) : (
              <ShieldAlert aria-hidden="true" size={20} />
            )}
            <div>
              <strong>
                {t(status?.configured ? 'locations.posConfigured' : 'locations.posNotConfigured')}
              </strong>
              {status?.configured && (
                <small>
                  {t('locations.posVersion', { version: status.version ?? '—' })}
                  {rotatedAt ? ` · ${t('locations.posRotatedAt', { date: rotatedAt })}` : ''}
                </small>
              )}
            </div>
          </div>
        )}
        {error && (
          <div className="inline-alert inline-alert-error" role="alert">
            {error}
          </div>
        )}
        {canRotate && !loading && status && (
          <button
            type="button"
            className={
              status?.configured
                ? 'btn-danger px-5 inline-flex items-center gap-2'
                : 'btn-outline px-5 inline-flex items-center gap-2'
            }
            onClick={() => void rotate()}
            disabled={rotating}
          >
            {rotating ? (
              <LoaderCircle aria-hidden="true" className="spin" size={17} />
            ) : (
              <KeyRound aria-hidden="true" size={17} />
            )}
            {t(status?.configured ? 'locations.posReplaceKey' : 'locations.posCreateKey')}
          </button>
        )}
      </fieldset>

      <Modal
        open={Boolean(secret)}
        onClose={() => setSecret(null)}
        title={t('locations.posOneTimeTitle')}
        size="lg"
      >
        <div className="modal-body form-stack">
          <div className="inline-alert inline-alert-warning" role="status">
            <ShieldAlert aria-hidden="true" size={18} />
            <span>{t('locations.posOneTimeWarning')}</span>
          </div>
          <div className="field-group">
            <label className="field-label" htmlFor="branch-pos-configuration">
              {t('locations.posConfiguration')}
            </label>
            <textarea
              id="branch-pos-configuration"
              className="input-classic"
              rows={4}
              value={configuration}
              readOnly
              spellCheck={false}
              autoComplete="off"
              data-lpignore="true"
              aria-describedby="branch-pos-configuration-hint"
            />
            <p id="branch-pos-configuration-hint" className="page-help">
              {t('locations.posConfigurationHint')}
            </p>
          </div>
          <div className="modal-actions">
            <button type="button" className="btn-outline px-5" onClick={() => setSecret(null)}>
              {t('common.close')}
            </button>
            <button
              type="button"
              className="btn-classic px-5 inline-flex items-center gap-2"
              onClick={() => void copyConfiguration()}
            >
              <Copy aria-hidden="true" size={17} />
              {t('locations.posCopy')}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}

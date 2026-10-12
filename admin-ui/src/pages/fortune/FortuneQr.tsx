import { useEffect, useState } from 'react';
import { Download } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import PageState from '../../components/PageState';
import { useI18n } from '../../lib/i18n';
import { Field } from './Fields';
import { loadQr } from './api';
import type { Branch, Campaign } from './model';

export default function FortuneQr({
  campaign,
  branches,
  onClose,
}: {
  campaign: Campaign;
  branches: Branch[];
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const text = (ru: string, kk: string) => (locale === 'kk' ? kk : ru);
  const eligible = branches.filter((branch) => campaign.branchIds.includes(branch.id));
  const [branchId, setBranchId] = useState(eligible[0]?.id || ''),
    [image, setImage] = useState(''),
    [url, setUrl] = useState(''),
    [error, setError] = useState(''),
    [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setImage('');
    setUrl('');
    setError('');
    if (!branchId) {
      setError(text('В акции нет филиалов.', 'Акцияда филиал жоқ.'));
      return;
    }
    void (async () => {
      try {
        const result = await loadQr(campaign.id, branchId, controller.signal);
        const qr = await import('qrcode');
        const png = await qr.toDataURL(result.url, {
          width: 900,
          margin: 4,
          errorCorrectionLevel: 'M',
        });
        if (!controller.signal.aborted) {
          setImage(png);
          setUrl(result.url);
        }
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : text('Не удалось создать QR.', 'QR жасалмады.'),
          );
      }
    })();
    return () => controller.abort();
  }, [campaign.id, branchId, revision, locale]);
  const branch = eligible.find((item) => item.id === branchId);
  return (
    <Modal
      open
      title={text('QR для филиала', 'Филиал QR коды')}
      description={campaign.title}
      onClose={onClose}
      size="sm"
    >
      <div className="fortune-qr">
        <Field label={text('Филиал', 'Филиал')}>
          <select
            className="input-classic"
            value={branchId}
            onChange={(event) => setBranchId(event.target.value)}
          >
            {eligible.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.city}
              </option>
            ))}
          </select>
        </Field>
        {error ? (
          <PageState
            type="error"
            description={error}
            onRetry={() => setRevision((current) => current + 1)}
            compact
          />
        ) : image ? (
          <>
            <img
              src={image}
              width={280}
              height={280}
              alt={text(
                `QR рулетки · ${branch?.name || ''}`,
                `Рулетка QR коды · ${branch?.name || ''}`,
              )}
            />
            <a
              className="btn-primary"
              href={image}
              download={`Bulka-Fortune-${branch?.name.replace(/[^\p{L}\p{N} _-]/gu, '') || branchId}.png`}
            >
              <Download size={18} />
              {text('Скачать QR', 'QR жүктеу')}
            </a>
            <a className="fortune-link" href={url} target="_blank" rel="noopener noreferrer">
              {text('Открыть страницу клиента', 'Клиент бетін ашу')}
            </a>
          </>
        ) : (
          <PageState type="loading" compact />
        )}
      </div>
    </Modal>
  );
}

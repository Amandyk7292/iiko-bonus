import { useEffect, useState } from 'react';
import { Download } from '../../components/BulkaIcons';
import Modal from '../../components/Modal';
import PageState from '../../components/PageState';
import { request } from '../../lib/api';
import type { Branch, PhotoCopy } from './model';

function QrBody({ branch, copy }: { branch: Branch; copy: PhotoCopy }) {
  const [image, setImage] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setError('');
    void (async () => {
      try {
        const result = await request<{ url: string }>(
          `/photo-reports/branches/${branch.id}/qr`,
          { method: 'POST', body: '{}', signal: controller.signal },
          { branchScope: '' },
        );
        const qr = await import('qrcode');
        const png = await qr.toDataURL(result.url, {
          width: 640,
          margin: 3,
          errorCorrectionLevel: 'M',
        });
        if (!controller.signal.aborted) setImage(png);
      } catch (caught) {
        if (!controller.signal.aborted)
          setError(
            caught instanceof Error
              ? caught.message
              : copy.text('Не удалось загрузить QR', 'QR жүктелмеді'),
          );
      }
    })();
    return () => controller.abort();
  }, [branch.id, revision, copy]);
  return (
    <div className="closing-qr">
      {error ? (
        <PageState
          type="error"
          description={error}
          onRetry={() => setRevision((v) => v + 1)}
          compact
        />
      ) : !image ? (
        <div className="closing-qr-placeholder">
          <PageState type="loading" compact />
        </div>
      ) : (
        <>
          <img
            src={image}
            alt={copy.text(
              'QR-код точки для фотоотчётов',
              'Нүктенің фотоесептерге арналған QR-коды',
            )}
            width="280"
            height="280"
          />
          <a
            className="btn-primary"
            href={image}
            download={`Bulka-QR-${branch.name.replace(/[^\p{L}\p{N} _-]/gu, '')}.png`}
          >
            <Download size={18} aria-hidden="true" />
            {copy.text('Скачать QR', 'QR жүктеу')}
          </a>
        </>
      )}
    </div>
  );
}
export default function ReportQr({
  branch,
  onClose,
  copy,
}: {
  branch: Branch | null;
  onClose: () => void;
  copy: PhotoCopy;
}) {
  return (
    <Modal
      open={Boolean(branch)}
      onClose={onClose}
      title={copy.text('QR для фотоотчётов', 'Фотоесептерге арналған QR')}
      description={branch ? `${branch.name} · ${branch.city}` : ''}
      size="sm"
    >
      {branch && <QrBody key={branch.id} branch={branch} copy={copy} />}
    </Modal>
  );
}

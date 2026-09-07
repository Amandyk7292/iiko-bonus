import { useState } from 'react';
import { LoaderCircle, QrCode } from 'lucide-react';
import { downloadProductQr } from '../lib/product-qr';

export default function ProductQrButton({ id, name }: { id: string; name: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button" className="icon-button" disabled={busy} aria-busy={busy}
        aria-label={`Скачать QR-код: ${name}`} title="Скачать QR-код товара"
        onClick={async () => {
          if (busy) return;
          setBusy(true); setError(false);
          try { await downloadProductQr(id); }
          catch { setError(true); }
          finally { setBusy(false); }
        }}
      >
        {busy ? <LoaderCircle className="spin" size={17} /> : <QrCode size={17} />}
      </button>
      {error && <span role="alert" className="absolute right-0 top-full z-10 w-48 rounded-lg border bg-white p-2 text-xs text-red-700 shadow">Не удалось скачать QR. Нажмите ещё раз.</span>}
    </span>
  );
}

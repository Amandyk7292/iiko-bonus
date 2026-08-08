import { LoaderCircle, QrCode, RefreshCw, Wifi, WifiOff } from 'lucide-react';
import type { WhatsAppConnectionStatus } from '../lib/api';
import { connectionCopy, providerLabels } from './whatsapp-page.helpers';

interface WhatsAppStatusPanelProps {
  connection: WhatsAppConnectionStatus | null;
  canConfigure: boolean;
  conversationOnly: boolean;
  unread: number;
  busy: string;
  onRefresh: () => void;
  onResetPairing: () => void;
}

export default function WhatsAppStatusPanel({
  connection,
  canConfigure,
  conversationOnly,
  unread,
  busy,
  onRefresh,
  onResetPairing,
}: WhatsAppStatusPanelProps) {
  const copy = connectionCopy(connection, canConfigure);
  return (
    <section className={`whatsapp-status-panel whatsapp-status-${connection?.state || 'starting'}`}>
      <div className="whatsapp-status-icon" aria-hidden="true">
        {connection?.connected ? (
          <Wifi size={24} />
        ) : connection?.state === 'awaiting_scan' ? (
          <QrCode size={24} />
        ) : (
          <WifiOff size={24} />
        )}
      </div>
      <div className="whatsapp-status-copy">
        <h2>{copy.title}</h2>
        <p>{copy.detail}</p>
      </div>
      {!conversationOnly && (
        <div className="whatsapp-status-meta">
          <span>{providerLabels[connection?.assistant.provider || 'gemini']}</span>
          <strong>{connection?.assistant.model || 'gemini-3.1-flash-lite'}</strong>
        </div>
      )}
      <div className="whatsapp-status-meta">
        <span>Непрочитано</span>
        <strong>{unread}</strong>
      </div>
      <div className="whatsapp-status-actions">
        {canConfigure && !connection?.connected && (
          <button
            type="button"
            className="btn-outline whatsapp-pairing-reset"
            onClick={onResetPairing}
            disabled={Boolean(busy)}
          >
            {busy === 'pairing-reset' ? (
              <LoaderCircle aria-hidden="true" size={18} className="spin" />
            ) : (
              <QrCode aria-hidden="true" size={18} />
            )}
            {connection?.qrDataUrl ? 'Обновить QR' : 'Создать новый QR'}
          </button>
        )}
        <button
          type="button"
          className="icon-button whatsapp-refresh-button"
          onClick={onRefresh}
          disabled={busy === 'refresh' || busy === 'pairing-reset'}
          aria-label="Обновить WhatsApp"
          title="Обновить WhatsApp"
        >
          <RefreshCw aria-hidden="true" size={19} className={busy === 'refresh' ? 'spin' : ''} />
        </button>
      </div>
      {canConfigure && connection?.qrDataUrl && (
        <div className="whatsapp-qr-panel">
          <img
            src={connection.qrDataUrl}
            alt="QR-код для подключения WhatsApp"
            width="220"
            height="220"
          />
          <div>
            <h3>Подключите рабочий номер</h3>
            <ol>
              <li>Откройте WhatsApp на телефоне.</li>
              <li>Выберите связанные устройства.</li>
              <li>Отсканируйте этот QR-код.</li>
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}

import { useState } from 'react';
import type { AdminOrder } from '../lib/api';
import { useI18n } from '../lib/i18n';
import Modal from './Modal';
import './DeliveryResolutionNotice.css';

type ResolutionOrder = Pick<AdminOrder, 'deliveryResolution'>;
export const needsPickupApproval = (order: ResolutionOrder) =>
  order.deliveryResolution?.status === 'pickup_pending_approval';
export const hasUnresolvedDelivery = (order: ResolutionOrder) =>
  [
    'pending',
    'pickup_cancelling',
    'cancel_cancelling',
    'pickup_pending_approval',
    'pickup_accepting',
    'pickup_rejecting',
    'cancel_refunding',
  ].includes(order.deliveryResolution?.status || '');
export const deliveryReplacementVisible = (order: ResolutionOrder) =>
  [
    'pickup_cancelling',
    'pickup_pending_approval',
    'pickup_accepting',
    'pickup_rejecting',
    'pickup_accepted',
    'pickup_rejected',
  ].includes(order.deliveryResolution?.status || '');

export default function DeliveryResolutionNotice({
  order,
  saving = false,
  onReview,
}: {
  order: ResolutionOrder;
  saving?: boolean;
  onReview?: (action: 'accept' | 'reject') => Promise<boolean>;
}) {
  const { t, formatDate } = useI18n();
  const [confirmReject, setConfirmReject] = useState(false);
  if (!deliveryReplacementVisible(order) && !hasUnresolvedDelivery(order)) return null;
  const resolution = order.deliveryResolution!;
  const pending = needsPickupApproval(order);
  return (
    <div className="inline-alert inline-alert-warning delivery-resolution-notice mt-2">
      <strong>
        {t(
          deliveryReplacementVisible(order)
            ? 'orders.deliveryReplacement'
            : 'orders.deliveryResolutionNotice',
        )}
      </strong>
      <span>{t(`orders.deliveryResolution.${resolution.status}`)}</span>
      {resolution.pickupTime && (
        <small>
          {t('orders.deliveryPickupTime', {
            time: formatDate(resolution.pickupTime, { dateStyle: 'short', timeStyle: 'short' }),
          })}
        </small>
      )}
      {pending && onReview && (
        <div className="delivery-resolution-actions">
          <button
            className="btn-classic compact-button"
            type="button"
            disabled={saving}
            onClick={() => void onReview('accept')}
          >
            {t(saving ? 'common.saving' : 'orders.deliveryAcceptPickup')}
          </button>
          <button
            className="btn-outline compact-button"
            type="button"
            disabled={saving}
            onClick={() => setConfirmReject(true)}
          >
            {t('orders.deliveryRejectPickup')}
          </button>
        </div>
      )}
      <Modal
        open={pending && confirmReject}
        title={t('orders.deliveryRejectPickup')}
        description={t('orders.deliveryRejectHint')}
        onClose={() => {
          if (!saving) setConfirmReject(false);
        }}
        size="sm"
      >
        <div className="flex flex-wrap justify-end gap-2">
          <button
            className="btn-outline"
            type="button"
            disabled={saving}
            onClick={() => setConfirmReject(false)}
          >
            {t('common.cancel')}
          </button>
          <button
            className="btn-classic"
            type="button"
            disabled={saving}
            onClick={async () => {
              if (await onReview?.('reject')) setConfirmReject(false);
            }}
          >
            {t('common.confirm')}
          </button>
        </div>
      </Modal>
    </div>
  );
}

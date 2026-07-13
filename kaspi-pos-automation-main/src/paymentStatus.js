const QR_FINAL_STATUSES = {
  Processed: 'payment.success',
  CancelledByUser: 'payment.failed',
  NotConfirmedByUser: 'payment.failed',
  CancelledByExternalSource: 'payment.failed',
  ProcessingFailed: 'payment.failed',
  Rejected: 'payment.failed',
  InsufficientFunds: 'payment.failed',
  InsufficientFundsError: 'payment.failed',
  Error: 'payment.failed',
  IrisSrcBlockCode1: 'payment.failed',
  IrisSrcBlockCode3: 'payment.failed',
  IrisSrcBlockCode9: 'payment.failed',
  IrisDestBlockCode3: 'payment.failed',
  IrisDestBlockCode5: 'payment.failed',
  IrisDestBlockCode7: 'payment.failed',
  IrisDestBlockCode10: 'payment.failed',
  QrTokenDiscarded: 'payment.expired',
  Expired: 'payment.expired',
};

const INVOICE_FINAL_STATUSES = {
  Processed: 'payment.success',
  RemotePaymentCanceled: 'payment.failed',
  RemotePaymentRejected: 'payment.failed',
  Expired: 'payment.expired',
};

const QR_INTERMEDIATE = new Set(['QrTokenCreated', 'Wait']);
const INVOICE_INTERMEDIATE = new Set(['RemotePaymentCreated']);

export const shouldStopPollingAfterFailures = (retryCount) => Number(retryCount) > 10;

export const shouldStopFastTracking = (createdAt, now, maxAgeMs) => {
  const created = Number(createdAt);
  const current = Number(now);
  const maxAge = Number(maxAgeMs);
  return (
    Number.isFinite(created) &&
    created > 0 &&
    Number.isFinite(current) &&
    Number.isFinite(maxAge) &&
    maxAge > 0 &&
    current - created > maxAge
  );
};

export const resolvePaymentEvent = (type, status) => {
  if (!status) return null;
  if (type === 'qr') {
    if (QR_INTERMEDIATE.has(status)) return null;
    return QR_FINAL_STATUSES[status] || null;
  }
  if (INVOICE_INTERMEDIATE.has(status)) return null;
  return INVOICE_FINAL_STATUSES[status] || null;
};

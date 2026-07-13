import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  resolvePaymentEvent,
  shouldStopFastTracking,
  shouldStopPollingAfterFailures,
} from '../src/paymentStatus.js';

describe('payment polling status mapping', () => {
  it('keeps intermediate and unknown invoice statuses pending', () => {
    assert.equal(resolvePaymentEvent('invoice', 'RemotePaymentCreated'), null);
    assert.equal(resolvePaymentEvent('invoice', 'RemotePaymentProcessing'), null);
    assert.equal(resolvePaymentEvent('invoice', null), null);
  });

  it('finishes invoice only for explicit final statuses', () => {
    assert.equal(resolvePaymentEvent('invoice', 'Processed'), 'payment.success');
    assert.equal(resolvePaymentEvent('invoice', 'RemotePaymentCanceled'), 'payment.failed');
    assert.equal(resolvePaymentEvent('invoice', 'RemotePaymentRejected'), 'payment.failed');
    assert.equal(resolvePaymentEvent('invoice', 'Expired'), 'payment.expired');
  });

  it('keeps intermediate and unknown QR statuses pending', () => {
    assert.equal(resolvePaymentEvent('qr', 'QrTokenCreated'), null);
    assert.equal(resolvePaymentEvent('qr', 'Wait'), null);
    assert.equal(resolvePaymentEvent('qr', 'Processing'), null);
  });

  it('retires an operation only after ten responses without a usable status', () => {
    assert.equal(shouldStopPollingAfterFailures(10), false);
    assert.equal(shouldStopPollingAfterFailures(11), true);
  });

  it('moves old operations out of fast tracking without changing payment status', () => {
    const now = Date.parse('2026-07-14T00:00:00.000Z');
    const maxAge = 30 * 60 * 1000;
    assert.equal(shouldStopFastTracking(now - maxAge, now, maxAge), false);
    assert.equal(shouldStopFastTracking(now - maxAge - 1, now, maxAge), true);
    assert.equal(shouldStopFastTracking(undefined, now, maxAge), false);
  });
});

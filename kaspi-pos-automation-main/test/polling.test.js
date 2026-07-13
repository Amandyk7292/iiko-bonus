import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolvePaymentEvent } from '../src/paymentStatus.js';

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
});

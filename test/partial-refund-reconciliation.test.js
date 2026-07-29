const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { reconcilePartialRefundRecord } = require('../src/services/partial-refund.service');

test('uncertain partial refund becomes confirmed before adjustments are applied', async () => {
  const calls = [];
  const refund = {
    id: '11111111-1111-4111-8111-111111111111',
    status: 'unknown',
    provider_reference: 'provider-ref',
  };

  const result = await reconcilePartialRefundRecord(refund, {
    resolve: async () => {
      calls.push('resolve');
      return { status: 'confirmed', reference: 'provider-ref' };
    },
    complete: async (_refund, decision) => {
      calls.push(`complete:${decision.reference}`);
      return { id: 'order-id', refund_status: 'partial' };
    },
    applyAdjustments: async () => {
      calls.push('adjust');
      return { spentBonusRestored: 10 };
    },
    afterConfirmed: async () => calls.push('after-confirmed'),
    decline: async () => assert.fail('confirmed refund must not be declined'),
    defer: async () => assert.fail('confirmed refund must not be deferred'),
  });

  assert.equal(result.status, 'confirmed');
  assert.deepEqual(calls, ['resolve', 'complete:provider-ref', 'adjust', 'after-confirmed']);
});

test('uncertain partial refund becomes safely declined without financial adjustments', async () => {
  const calls = [];
  const refund = {
    id: '22222222-2222-4222-8222-222222222222',
    status: 'unknown',
  };

  const result = await reconcilePartialRefundRecord(refund, {
    resolve: async () => {
      calls.push('resolve');
      return { status: 'declined', message: 'Provider rejected refund' };
    },
    complete: async () => assert.fail('declined refund must not be completed'),
    applyAdjustments: async () => assert.fail('declined refund must not adjust money'),
    decline: async (_refund, decision) => {
      calls.push(`decline:${decision.message}`);
      return { id: 'order-id', refund_status: 'failed' };
    },
    afterDeclined: async () => calls.push('after-declined'),
    defer: async () => assert.fail('declined refund must not be deferred'),
  });

  assert.equal(result.status, 'declined');
  assert.deepEqual(calls, ['resolve', 'decline:Provider rejected refund', 'after-declined']);
});

test('latest migration preserves ambiguous partial refunds for reconciliation', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260729150000_payment_creation_legal_consent_key_rotation.sql',
    ),
    'utf8',
  );

  assert.match(
    migration,
    /status in \('pending', 'processing', 'unknown', 'succeeded', 'failed'\)/i,
  );
  assert.match(migration, /add column if not exists provider_reference varchar\(160\)/i);
  assert.match(migration, /add column if not exists provider_request_id uuid/i);
  assert.match(migration, /create or replace function public\.mark_partial_refund_unknown/i);
  assert.match(migration, /create or replace function public\.decline_partial_refund/i);
  assert.match(
    migration,
    /if v_refund\.status not in \('processing', 'unknown'\) then\s+raise exception 'refund state conflict'/i,
  );
});

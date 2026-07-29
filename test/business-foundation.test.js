const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { buildExpirySummary } = require('../src/services/bonus-expiry.service');
const { eligibility, parseQrPayload, parseToken } = require('../src/services/pickup-handoff.service');
const {
  giftCertificateListQuerySchema,
  giftCertificatePurchaseBodySchema,
  pickupHandoffVerifyBodySchema,
  stockSubscriptionBodySchema,
} = require('../src/contracts/business-foundation.contract');
const {
  credentialHash,
  decryptSecret,
  encryptSecret,
} = require('../src/utils/secret-envelope.util');
const {
  purchaseFingerprint,
  serializePurchase,
} = require('../src/services/gift-certificate-purchase.service');
const { branchPosTokenHash } = require('../src/services/branch-pos-credential.service');

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(
  path.join(root, 'supabase', 'migrations', '20260729160000_business_foundation.sql'),
  'utf8',
);

test('secret envelopes authenticate ciphertext, purpose and AAD', () => {
  const encrypted = encryptSecret('BLK-SECRET-CODE', {
    purpose: 'gift-card-code',
    aad: 'gift-purchase:123',
  });
  assert.equal(
    decryptSecret(encrypted, {
      purpose: 'gift-card-code',
      aad: 'gift-purchase:123',
    }),
    'BLK-SECRET-CODE',
  );
  assert.throws(() =>
    decryptSecret(encrypted, {
      purpose: 'gift-card-code',
      aad: 'gift-purchase:forged',
    }),
  );
  const parts = encrypted.split('.');
  parts[3] = `${parts[3].slice(0, -1)}${parts[3].endsWith('A') ? 'B' : 'A'}`;
  assert.throws(() =>
    decryptSecret(parts.join('.'), {
      purpose: 'gift-card-code',
      aad: 'gift-purchase:123',
    }),
  );
  assert.notEqual(credentialHash('same', 'pickup-pin'), credentialHash('same', 'pickup-token'));
  assert.notEqual(branchPosTokenHash('same'), credentialHash('same', 'pickup-token'));
});

test('bonus expiry consumes credits FIFO and reconciles to the current balance', () => {
  const now = new Date('2026-07-29T00:00:00.000Z');
  const summary = buildExpirySummary({
    balance: 60,
    days: 40,
    now,
    transactions: [
      {
        type: 'deposit',
        amount: 100,
        timestamp: '2026-07-01T00:00:00.000Z',
        expires_at: '2026-08-10T00:00:00.000Z',
      },
      {
        type: 'withdrawal',
        amount: 40,
        timestamp: '2026-07-10T00:00:00.000Z',
      },
    ],
  });
  assert.equal(summary.currentBalance, 60);
  assert.equal(summary.totalExpiring, 60);
  assert.equal(summary.buckets[0].amount, 60);

  const fallback = buildExpirySummary({
    balance: 25,
    days: 40,
    now,
    transactions: [],
    fallbackExpiryAt: '2026-08-15T00:00:00.000Z',
  });
  assert.equal(fallback.totalExpiring, 25);
});

test('pickup credentials are one-order, bounded and pickup-only', () => {
  const orderId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  const token = 'a'.repeat(43);
  const payload = `bulka:pickup:${orderId}:${token}`;
  assert.deepEqual(parseQrPayload(payload), { orderId, token });
  assert.equal(parseToken(payload, orderId), token);
  assert.throws(() =>
    parseToken(payload, '217615f9-b35f-4eb4-9f6d-777f2236bb25'),
  );
  assert.equal(
    eligibility({
      order_kind: 'product',
      fulfillment_type: 'pickup',
      status: 'paid',
      fulfillment_status: 'ready',
    }).eligible,
    true,
  );
  assert.equal(
    eligibility({
      order_kind: 'product',
      fulfillment_type: 'delivery',
      status: 'paid',
      fulfillment_status: 'ready',
    }).eligible,
    false,
  );
});

test('business contracts reject forged fields and ambiguous handoff credentials', () => {
  const branchId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  assert.equal(
    stockSubscriptionBodySchema.safeParse({
      productId: 'product-1',
      branchId,
      customerId: branchId,
    }).success,
    false,
  );
  assert.equal(
    giftCertificatePurchaseBodySchema.safeParse({
      requestId: branchId,
      amount: 500,
      recipient: { phone: '+7 700 000 00 00' },
      paymentMethod: 'forte',
      status: 'active',
    }).success,
    false,
  );
  assert.equal(
    pickupHandoffVerifyBodySchema.safeParse({
      token: 'a'.repeat(32),
      pin: '123456',
    }).success,
    false,
  );
  assert.deepEqual(giftCertificateListQuerySchema.parse({}), { limit: 50 });
  assert.equal(giftCertificateListQuerySchema.safeParse({ limit: 51 }).success, false);
});

test('gift purchase serialization exposes delivery mode without recipient customer id', () => {
  const purchaseId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';
  const purchase = {
    id: purchaseId,
    request_id: '217615f9-b35f-4eb4-9f6d-777f2236bb25',
    status: 'active',
    amount: 1000,
    currency: 'KZT',
    recipient_phone: '+77000000000',
    recipient_name: 'Получатель',
    message: 'С праздником',
    payment_provider: 'forte',
    gift_card_id: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
    code_ciphertext: encryptSecret('BLK-TESTCODE', {
      purpose: 'gift-card-code',
      aad: `gift-purchase:${purchaseId}`,
    }),
    created_at: '2026-07-29T00:00:00.000Z',
    activated_at: '2026-07-29T00:01:00.000Z',
  };
  const serialized = serializePurchase(
    purchase,
    {
      id: purchase.gift_card_id,
      code_last4: 'CODE',
      balance: 1000,
      recipient_customer_id: '417615f9-b35f-4eb4-9f6d-777f2236bb25',
    },
    { includeCode: true },
  );
  assert.equal(serialized.recipient.registered, true);
  assert.equal(serialized.recipient.deliveryMode, 'in_app');
  assert.equal(serialized.giftCard.code, 'BLK-TESTCODE');
  assert.equal(JSON.stringify(serialized).includes('417615f9'), false);

  const fingerprint = purchaseFingerprint('customer', {
    requestId: purchase.request_id,
    amount: 1000,
    recipient: { phone: '+7 700 000 00 00' },
    paymentMethod: 'forte',
  });
  assert.equal(fingerprint.length, 64);
});

test('migration atomically protects POS, pickup, stock alerts and gift refunds', () => {
  assert.match(migration, /create table if not exists public\.branch_pos_credentials/i);
  assert.match(migration, /token_hash varchar\(64\)/i);
  assert.doesNotMatch(migration, /branch_pos_credentials[\s\S]{0,400}token_ciphertext/i);
  assert.match(migration, /pin_failed_attempts integer not null default 0/i);
  assert.match(migration, /now\(\) \+ interval '15 minutes'/i);
  assert.match(migration, /claim_stock_subscription_notification/i);
  assert.match(
    migration,
    /insert into public\.customer_notifications[\s\S]+update public\.customer_stock_subscriptions[\s\S]+status = 'notified'/i,
  );
  assert.match(migration, /prepare_gift_certificate_refund/i);
  assert.match(migration, /rollback_gift_certificate_refund/i);
  assert.match(migration, /finalize_gift_certificate_refund/i);
  assert.match(migration, /from public\.gift_cards[\s\S]+for update/i);
  assert.match(migration, /gift certificate has already been used/i);
  assert.match(migration, /status in \('active', 'committed'\)/i);
  assert.match(
    migration,
    /set active = case when previous_status = 'active' then true else false end/i,
  );
  assert.match(migration, /not valid/i);
  assert.match(migration, /validate constraint kaspi_orders_order_kind_check/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on function public\.rotate_branch_pos_credential[\s\S]+to service_role/i,
  );
});

test('branch-sensitive POS routes require the per-branch credential middleware', () => {
  const source = fs.readFileSync(path.join(root, 'src', 'routes', 'loyalty.routes.js'), 'utf8');
  for (const route of [
    'pickup-handoff/verify',
    'gift-cards/validate',
    'gift-cards/reserve',
    'gift-cards/commit',
    'gift-cards/cancel',
  ]) {
    const routeStart = source.indexOf(`'/api/loyalty/${route}'`);
    assert.notEqual(routeStart, -1);
    assert.match(source.slice(routeStart, routeStart + 260), /branchPosAuthMiddleware/);
  }
});

test('gift certificate refunds are guarded before the gateway and cannot be partial', () => {
  const orderService = fs.readFileSync(
    path.join(root, 'src', 'services', 'customer-order.service.js'),
    'utf8',
  );
  const partialRefundService = fs.readFileSync(
    path.join(root, 'src', 'services', 'partial-refund.service.js'),
    'utf8',
  );
  const prepareIndex = orderService.indexOf('await prepareGiftCertificateRefund(claimed)');
  const gatewayIndex = orderService.indexOf('refund = await refundPaymentForOrder', prepareIndex);
  assert.notEqual(prepareIndex, -1);
  assert.ok(gatewayIndex > prepareIndex);
  assert.match(orderService, /await rollbackGiftCertificateRefund\(claimed\)/);
  assert.match(orderService, /await finalizeGiftCertificateRefund\(refunded\)/);
  assert.match(
    partialRefundService,
    /GIFT_CERTIFICATE_PARTIAL_REFUND_FORBIDDEN/,
  );
});

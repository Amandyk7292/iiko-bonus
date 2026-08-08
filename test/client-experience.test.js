const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  inQuietHours,
  notificationCategory,
} = require('../src/services/notification-preferences.service');
const { buildContentState } = require('../src/services/live-activity.service');
const { OrderPaymentStateService } = require('../src/services/order-payment-state.service');

test('notification categories separate transactional and marketing messages', () => {
  assert.equal(notificationCategory({ type: 'delivery' }), 'orders');
  assert.equal(notificationCategory({ type: 'bonus' }), 'bonus');
  assert.equal(notificationCategory({ type: 'marketing_promo' }), 'promos');
  assert.equal(notificationCategory({ type: 'support' }), 'support');
  assert.equal(notificationCategory({}), 'promos');
});

test('quiet hours work across midnight in the customer timezone', () => {
  const preferences = {
    quietHoursEnabled: true,
    quietStart: '22:00',
    quietEnd: '08:00',
    timezone: 'UTC',
  };
  assert.equal(inQuietHours(preferences, new Date('2026-07-16T23:30:00Z')), true);
  assert.equal(inQuietHours(preferences, new Date('2026-07-16T07:59:00Z')), true);
  assert.equal(inQuietHours(preferences, new Date('2026-07-16T12:00:00Z')), false);
});

test('Live Activity state has bounded progress and a Unix ETA', () => {
  const state = buildContentState({
    fulfillment_status: 'preparing',
    delivery_status: 'unassigned',
    promised_ready_at: '2026-07-16T12:30:00.000Z',
  });
  assert.equal(state.status, 'preparing');
  assert.equal(state.progress, 0.42);
  assert.equal(state.etaTimestamp, 1784205000);
  assert.ok(state.updatedAtTimestamp > 0);
});

test('order record stores branch preparation and a delivery ETA', () => {
  const service = new OrderPaymentStateService();
  const scheduledAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const record = service.orderRecord({
    customerId: 'customer-1',
    operationId: 'operation-1',
    normalizedPhone: '77770000000',
    pricing: {
      total: 5200,
      subtotal: 5000,
      discount: 0,
      deliveryFee: 200,
      preparationMinutes: 22,
    },
    cartItems: [],
    checkout: {
      orderType: 'delivery',
      branchId: 'branch-1',
      branch: 'Bulka',
      scheduledAt,
      deliveryZone: { distanceKm: 4 },
      requestId: 'request-1',
    },
    paymentMethod: 'invoice',
  });

  assert.equal(record.preparation_minutes, 22);
  assert.equal(record.eta_version, 'eta-v3');
  assert.equal(record.eta_confidence, 'low');
  assert.equal(record.eta_min_at, scheduledAt);
  assert.equal(record.eta_max_at, new Date(Date.parse(scheduledAt) + 10 * 60 * 1000).toISOString());
  assert.ok(Date.parse(record.promised_ready_at) < Date.parse(record.eta_max_at));
  assert.ok(Date.parse(record.estimated_delivery_at) >= Date.parse(record.eta_min_at));
});

test('canonical product details and ETA migration contains its full contract', () => {
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'supabase', 'migrations', '20260716190000_product_details_eta.sql'),
    'utf8',
  );
  assert.match(migration, /ingredients_translations/i);
  assert.match(migration, /eta_min_at/i);
  assert.match(migration, /kitchen_parallel_capacity/i);
});

test('canonical client experience migration protects support uploads', () => {
  const migration = fs.readFileSync(
    path.join(
      __dirname,
      '..',
      'supabase',
      'migrations',
      '20260716160000_client_experience_suite.sql',
    ),
    'utf8',
  );
  assert.match(migration, /customer_notification_preferences/i);
  assert.match(migration, /customer_support_requests/i);
  assert.match(migration, /customer_live_activity_tokens/i);
  assert.match(migration, /jsonb_array_length\(attachments\) <= 3/i);
  assert.match(migration, /support-attachments/i);
});

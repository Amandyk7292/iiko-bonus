const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  PaymentOperationsService,
  isSafeWidgetFallbackError,
  sanitizeDiagnosticMessage,
} = require('../src/services/payment-operations.service');

const fixedNow = new Date('2026-07-27T12:00:00.000Z');

const createHarness = () => {
  const settings = new Map();
  let widgetAvailable = true;
  let checkoutProbeCalls = 0;
  let connectionProbeCalls = 0;
  const service = new PaymentOperationsService({
    readSetting: async (key) =>
      settings.has(key) ? { value: JSON.stringify(settings.get(key)) } : null,
    writeSetting: async (key, value) => {
      settings.set(key, value);
      return { value, updated_at: fixedNow.toISOString() };
    },
    listPaymentErrors: async () => [],
    kaspi: { availability: async () => true },
    forte: {
      availability: () => true,
      probeConnection: async () => ({ available: true, message: 'Forte /flex отвечает' }),
    },
    widget: {
      availability: () => true,
      probeCheckout: async () => {
        checkoutProbeCalls += 1;
        return {
          available: widgetAvailable,
          message: widgetAvailable ? 'Карты доступны' : 'Нет доступных методов',
          errorCode: widgetAvailable ? null : 'FORTE_WIDGET_NO_PAYMENT_METHODS',
          availableMethods: widgetAvailable ? ['credit_card'] : [],
        };
      },
      probeConnection: async () => {
        connectionProbeCalls += 1;
        return {
          available: widgetAvailable,
          message: widgetAvailable ? 'API отвечает' : 'Временный отказ',
          errorCode: widgetAvailable ? null : 'FORTE_WIDGET_CAPABILITY_UNAVAILABLE',
          availableMethods: [],
          readOnly: true,
        };
      },
    },
    env: {
      FORTE_ENABLED: 'true',
      FORTE_WIDGET_CHECKOUT_ENABLED: 'false',
      FORTE_WIDGET_WEBHOOK_PUBLIC_KEY: 'public-key',
      KASPI_POS_ENABLED: 'true',
      KASPI_INTERNAL_SECRET: 'k'.repeat(32),
      KASPI_WEBHOOK_SECRET: 'w'.repeat(32),
    },
    now: () => fixedNow,
  });
  return {
    service,
    settings,
    setWidgetAvailable(value) {
      widgetAvailable = value;
    },
    probeCalls() {
      return { checkout: checkoutProbeCalls, connection: connectionProbeCalls };
    },
  };
};

test('runtime switch enables Widget without restart and falls back when its probe fails', async () => {
  const harness = createHarness();
  assert.equal(
    (await harness.service.getForteCheckoutDecision()).effectiveIntegration,
    'hosted_page',
  );

  await harness.service.setWidgetEnabled(true, { updatedBy: 'admin' });
  let decision = await harness.service.getForteCheckoutDecision();
  assert.equal(decision.effectiveIntegration, 'widget');
  assert.equal(decision.fallbackActive, false);
  assert.equal(harness.settings.get('payment_forte_widget_enabled').updatedBy, 'admin');

  harness.setWidgetAvailable(false);
  await harness.service.runSafeProbe();
  decision = await harness.service.getForteCheckoutDecision();
  assert.equal(decision.effectiveIntegration, 'hosted_page');
  assert.equal(decision.fallbackActive, true);
  assert.equal(decision.fallbackReason, 'widget_unhealthy');
});

test('payment diagnostics never expose secrets or URL query parameters', () => {
  const sanitized = sanitizeDiagnosticMessage(
    'token=abc123 password=hunter2 https://bank.example/pay?id=42&secret=unsafe',
  );
  assert.doesNotMatch(sanitized, /abc123|hunter2|42|unsafe/);
  assert.match(sanitized, /token=\[скрыто\]/);
  assert.match(sanitized, /https:\/\/bank\.example\/pay/);
});

test('automatic Widget fallback is limited to failures known to be safe', () => {
  assert.equal(
    isSafeWidgetFallbackError({
      code: 'FORTE_WIDGET_NO_PAYMENT_METHODS',
      retryable: false,
    }),
    true,
  );
  assert.equal(
    isSafeWidgetFallbackError({
      code: 'FORTE_WIDGET_CREATE_REJECTED',
      retryable: false,
    }),
    true,
  );
  assert.equal(
    isSafeWidgetFallbackError({
      code: 'FORTE_WIDGET_CREATE_REJECTED',
      retryable: true,
    }),
    true,
  );
  assert.equal(isSafeWidgetFallbackError({ code: 'FORTE_WIDGET_NETWORK_ERROR' }), true);
  assert.equal(isSafeWidgetFallbackError({ code: 'FORTE_WIDGET_SAVE_FAILED' }), false);
});

test('one scheduled transient does not disable a working Widget or create a checkout', async () => {
  const harness = createHarness();
  await harness.service.setWidgetEnabled(true, { updatedBy: 'admin' });
  harness.setWidgetAvailable(false);
  await harness.service.runScheduledSafeProbe();
  const decision = await harness.service.getForteCheckoutDecision();
  assert.equal(decision.effectiveIntegration, 'widget');
  assert.equal(decision.fallbackActive, false);
  assert.deepEqual(harness.probeCalls(), { checkout: 1, connection: 1 });
  const health = harness.settings.get('payment_provider_probe').forteWidget;
  assert.equal(health.available, false);
  assert.equal(health.effectiveAvailable, true);
  assert.equal(health.consecutiveFailures, 1);
});

test('scheduled safe probe opens the circuit only after consecutive failures', async () => {
  const harness = createHarness();
  await harness.service.setWidgetEnabled(true, { updatedBy: 'admin' });
  harness.setWidgetAvailable(false);
  await harness.service.runScheduledSafeProbe();
  await harness.service.runScheduledSafeProbe();
  await assert.rejects(
    () => harness.service.runScheduledSafeProbe(),
    (error) =>
      error.code === 'PAYMENT_PROVIDER_PROBE_UNHEALTHY' && error.providers.includes('forteWidget'),
  );
  const decision = await harness.service.getForteCheckoutDecision();
  assert.equal(decision.effectiveIntegration, 'hosted_page');
  assert.equal(harness.settings.get('payment_provider_probe').forteWidget.consecutiveFailures, 3);
  assert.deepEqual(harness.probeCalls(), { checkout: 1, connection: 3 });
});

test('scheduled payment capability check runs every thirty minutes', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'src', 'server.js'), 'utf8');
  assert.match(server, /PAYMENT_PROVIDER_PROBE_INTERVAL_MS\s*=\s*30\s*\*\s*60\s*\*\s*1000/);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { ForteService } = require('../src/services/forte.service');
const { ForteWidgetService } = require('../src/services/forte-widget.service');
const { deliveryBudget, budgetError } = require('../src/services/delivery-budget.service');
const pricing = { total: 1035, canonicalItems: [], deliveryBudgetReservationId: 'hold-1' };

function harness(t, Service) {
  const service = new Service({ forecastEta: async () => ({}) });
  const widget = Service === ForteWidgetService;
  t.mock.method(service, widget ? 'assertCheckoutAvailable' : 'assertConfigured', () => ({
    publicBaseUrl: 'https://bulka.example',
  }));
  t.mock.method(service, 'existingRequest', async () => null);
  if (widget) t.mock.method(service, 'defaultPaymentMethod', async () => null);
  const calls = [];
  t.mock.method(service, widget ? 'createProviderCheckout' : 'createProviderOrder', async () => {
    calls.push('bank');
    throw Object.assign(new Error('Uncertain bank response'), { code: 'BANK_TIMEOUT' });
  });
  return { service, calls };
}

for (const Service of [ForteService, ForteWidgetService]) {
  test(`${Service.name}: a missing durable delivery hold prevents the bank request`, async (t) => {
    const { service, calls } = harness(t, Service);
    t.mock.method(deliveryBudget, 'markPayment', async (id) => {
      assert.equal(id, 'hold-1');
      throw budgetError();
    });
    await assert.rejects(service.createCheckout('+77001112233', pricing, 'customer'), {
      code: 'DELIVERY_TEMPORARILY_UNAVAILABLE',
    });
    assert.deepEqual(calls, []);
  });

  test(`${Service.name}: the hold is durable when the bank result is unknown`, async (t) => {
    const { service, calls } = harness(t, Service);
    t.mock.method(deliveryBudget, 'markPayment', async () => {
      calls.push('marked');
    });
    await assert.rejects(service.createCheckout('+77001112233', pricing, 'customer'), {
      code: 'BANK_TIMEOUT',
    });
    assert.deepEqual(calls, ['marked', 'bank']);
  });
}

test('an unavailable saved card fails before marking a payment attempt', async (t) => {
  const { service, calls } = harness(t, ForteWidgetService);
  t.mock.method(deliveryBudget, 'markPayment', async () => {
    calls.push('marked');
  });
  t.mock.method(service, 'defaultPaymentMethod', async () => {
    throw Object.assign(new Error('Saved card unavailable'), { code: 'CARD_UNAVAILABLE' });
  });
  await assert.rejects(
    service.createCheckout(
      '+77001112233',
      pricing,
      'customer',
      {},
      { paymentMethodId: 'removed-card' },
    ),
    { code: 'CARD_UNAVAILABLE' },
  );
  assert.deepEqual(calls, []);
});

const assert = require('node:assert/strict');
const test = require('node:test');

const kaspiController = require('../src/controllers/kaspi.controller');
const {
  createGiftCertificatePurchase,
} = require('../src/services/gift-certificate-purchase.service');

const responseHarness = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(body) {
    this.body = body;
    return this;
  },
});

test('disabled Kaspi integration exposes no payment or webhook operation', async (t) => {
  const previous = process.env.KASPI_POS_ENABLED;
  process.env.KASPI_POS_ENABLED = 'false';
  t.after(() => {
    if (previous === undefined) delete process.env.KASPI_POS_ENABLED;
    else process.env.KASPI_POS_ENABLED = previous;
  });

  const availability = responseHarness();
  await kaspiController.availability({}, availability);
  assert.equal(availability.statusCode, 200);
  assert.deepEqual(availability.body, {
    success: true,
    enabled: false,
    available: false,
  });

  for (const operation of [
    kaspiController.createPayment,
    kaspiController.quotePayment,
    kaspiController.checkStatus,
    kaspiController.handleWebhook,
  ]) {
    const response = responseHarness();
    await operation({}, response);
    assert.equal(response.statusCode, 410);
    assert.equal(response.body.code, 'KASPI_DISABLED');
    assert.equal(response.body.retryable, false);
  }

  await assert.rejects(
    createGiftCertificatePurchase(
      { id: 'customer-1', phone: '77770000000' },
      { paymentMethod: 'kaspi' },
    ),
    (error) => error?.statusCode === 410 && error?.code === 'KASPI_DISABLED',
  );
});

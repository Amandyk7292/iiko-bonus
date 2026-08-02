const assert = require('node:assert/strict');
const test = require('node:test');

const {
  adminCustomerBonusBodySchema,
  adminCustomerListQuerySchema,
  adminCustomerUpdateBodySchema,
} = require('../src/contracts/admin-customer.contract');
const { paymentReceiptQuerySchema } = require('../src/contracts/payment-receipt.contract');
const {
  adminLoginBodySchema,
  adminPhoneVerifyBodySchema,
} = require('../src/contracts/admin-auth.contract');
const {
  courierLocationBodySchema,
  forteCardSetupBodySchema,
  forteOperationParamsSchema,
  fortePaymentMethodParamsSchema,
  profileUpdateBodySchema,
  supportCreateBodySchema,
} = require('../src/contracts/customer-api.contract');
const {
  requestBodySafetyMiddleware,
  validateRequest,
} = require('../src/middlewares/validation.middleware');

const customerId = '117615f9-b35f-4eb4-9f6d-777f2236bb25';

test('customer contracts normalize valid input and reject unsafe mutations', () => {
  const bonus = adminCustomerBonusBodySchema.parse({
    customerId,
    amount: '125.5',
    reason: '  Ошибка кассира  ',
  });
  assert.equal(bonus.amount, 125.5);
  assert.equal(bonus.reason, 'Ошибка кассира');

  assert.equal(
    adminCustomerBonusBodySchema.safeParse({ customerId, amount: 1, reason: '1234' }).success,
    false,
  );
  assert.equal(
    adminCustomerUpdateBodySchema.safeParse({
      customerId,
      balance: 1_000_000,
    }).success,
    false,
  );
  assert.equal(
    adminCustomerUpdateBodySchema.safeParse({
      customerId,
      name: 'Клиент',
      unknownField: true,
    }).success,
    false,
  );
});

test('query contracts bound pagination and require expiring receipt access', () => {
  assert.deepEqual(adminCustomerListQuerySchema.parse({}), {
    page: 1,
    pageSize: 50,
    search: '',
  });
  assert.equal(adminCustomerListQuerySchema.safeParse({ pageSize: 1000 }).success, false);
  assert.equal(
    paymentReceiptQuerySchema.safeParse({
      token: 'a'.repeat(43),
    }).success,
    false,
  );
});

test('validation middleware raises a typed field error without echoing input', () => {
  const req = { body: { customerId: 'not-a-uuid', amount: 10, reason: '1234' } };
  const res = {
    statusCode: 200,
    body: null,
    status(value) {
      this.statusCode = value;
      return this;
    },
    json(value) {
      this.body = value;
      return this;
    },
  };
  let validationError;
  validateRequest({ body: adminCustomerBonusBodySchema })(req, res, (error) => {
    validationError = error;
  });

  assert.equal(validationError.statusCode, 400);
  assert.equal(validationError.code, 'VALIDATION_ERROR');
  assert.equal(validationError.expose, true);
  assert.ok(Array.isArray(validationError.fields));
  assert.equal(JSON.stringify(validationError.fields).includes('not-a-uuid'), false);
});

test('authentication and customer contracts reject extra and malformed fields', () => {
  const loginBody = adminLoginBodySchema.parse({ password: 'secret', code: '' });
  assert.deepEqual(loginBody, { username: 'admin', password: 'secret', code: undefined });
  assert.equal(
    adminLoginBodySchema.safeParse({ password: 'secret', unexpected: true }).success,
    false,
  );
  assert.equal(
    adminPhoneVerifyBodySchema.safeParse({ phone: '+7 700 000 00 00', code: '12345' }).success,
    false,
  );
  assert.deepEqual(courierLocationBodySchema.parse({ latitude: '43.65', longitude: '51.16' }), {
    latitude: 43.65,
    longitude: 51.16,
  });
  assert.equal(courierLocationBodySchema.safeParse({ latitude: 91, longitude: 0 }).success, false);
  assert.equal(profileUpdateBodySchema.safeParse({ email: 'not-an-email' }).success, false);
  assert.deepEqual(forteCardSetupBodySchema.parse({ language: 'kk' }), {
    language: 'kk',
  });
  assert.equal(
    forteCardSetupBodySchema.safeParse({ language: 'de', token: 'secret' }).success,
    false,
  );
  assert.equal(forteOperationParamsSchema.safeParse({ operationId: customerId }).success, true);
  assert.equal(fortePaymentMethodParamsSchema.safeParse({ methodId: 'not-a-uuid' }).success, false);
  assert.equal(
    supportCreateBodySchema.safeParse({
      category: 'refund',
      message: 'Нужен возврат',
      attachments: ['one', 'two', 'three', 'four'],
    }).success,
    false,
  );
});

test('global request body guard rejects unsafe keys and excessive nesting', () => {
  const unsafeBody = JSON.parse('{"safe":1,"__proto__":{"polluted":true}}');
  let unsafeError;
  requestBodySafetyMiddleware({ body: unsafeBody }, {}, (error) => {
    unsafeError = error;
  });
  assert.equal(unsafeError.code, 'REQUEST_BODY_UNSAFE_KEY');
  assert.equal({}.polluted, undefined);

  let nested = {};
  for (let index = 0; index < 18; index += 1) nested = { nested };
  let depthError;
  requestBodySafetyMiddleware({ body: nested }, {}, (error) => {
    depthError = error;
  });
  assert.equal(depthError.code, 'REQUEST_BODY_TOO_DEEP');
});

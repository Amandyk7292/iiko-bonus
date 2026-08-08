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
  adminPhoneRequestBodySchema,
  adminPhoneVerifyBodySchema,
  whatsappOperatorAccessBodySchema,
} = require('../src/contracts/admin-auth.contract');
const {
  contactActionCreateBodySchema,
  contactActionUpdateBodySchema,
  contactCardCreateBodySchema,
  contactCardUpdateBodySchema,
  contactReorderBodySchema,
} = require('../src/contracts/contact-center.contract');
const {
  paymentProbeBodySchema,
  paymentWidgetModeBodySchema,
} = require('../src/contracts/payment-integration.contract');
const { adminMutationSchemas } = require('../src/contracts/admin-mutations.contract');
const {
  courierLocationBodySchema,
  cartSnapshotBodySchema,
  customerAddressBodySchema,
  customerAddressParamsSchema,
  customerOrderParamsSchema,
  customerProductParamsSchema,
  favoriteMutationBodySchema,
  forteCardSetupBodySchema,
  forteOperationParamsSchema,
  fortePaymentMethodParamsSchema,
  giftCardRedeemBodySchema,
  forteWidgetWebhookBodySchema,
  orderReviewBodySchema,
  profileUpdateBodySchema,
  referralRedeemBodySchema,
  registrationBodySchema,
  reorderBodySchema,
  supportCreateBodySchema,
  analyticsEventsBodySchema,
} = require('../src/contracts/customer-api.contract');
const {
  orderSubstitutionCreateBodySchema,
} = require('../src/contracts/order-substitution.contract');
const {
  apiEnvelopeValidationMiddleware,
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

test('Forte webhook contracts accept documented envelopes and reject forged fields', () => {
  const fortePayload = {
    transaction: {
      uid: '217615f9-b35f-4eb4-9f6d-777f2236bb25',
      status: 'successful',
      amount: 3000,
      currency: 'KZT',
      tracking_id: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
      test: false,
      credit_card: {
        brand: 'visa',
        last_4: '1328',
        exp_month: 12,
        exp_year: 2030,
      },
      additional_data: {
        vendor: { token: 'a'.repeat(64) },
      },
    },
  };
  assert.equal(forteWidgetWebhookBodySchema.safeParse(fortePayload).success, true);
  assert.equal(
    forteWidgetWebhookBodySchema.safeParse({
      transaction: {
        ...fortePayload.transaction,
        provider_extension: { reconciliation: 'complete' },
        credit_card: {
          ...fortePayload.transaction.credit_card,
          provider_card_id: 'card-123',
        },
      },
    }).success,
    true,
  );
  assert.equal(
    forteWidgetWebhookBodySchema.safeParse({
      checkout: {
        token: 'a'.repeat(64),
        shop_id: 32828,
        transaction_type: 'payment',
        attempts: 1,
        iframe: true,
        order: {
          currency: 'KZT',
          amount: 3000,
          description: 'Привязка карты к профилю Bulka',
          tracking_id: '317615f9-b35f-4eb4-9f6d-777f2236bb25',
          additional_data: { contract: ['oneclick'] },
        },
        settings: {
          language: 'ru',
          return_url: 'https://bulka.com.kz/profile?status=returned',
          cancel_url: 'https://bulka.com.kz/profile?status=cancelled',
          save_card_toggle: {
            display: true,
            customer_contract: true,
            text: 'Сохранить карту',
          },
          another_card_toggle: { display: true },
        },
        payment_method: {
          types: ['credit_card'],
          excluded_brands: ['apple_pay'],
        },
        finished: false,
        expired: false,
        test: false,
        status: 'pending',
      },
    }).success,
    true,
  );
  assert.equal(
    forteWidgetWebhookBodySchema.safeParse({
      ...fortePayload,
      forgedCustomerId: customerId,
    }).success,
    false,
  );
  assert.equal(
    forteWidgetWebhookBodySchema.safeParse({
      transaction: {
        ...fortePayload.transaction,
        tracking_id: 'not-an-order-id',
      },
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
  assert.deepEqual(
    adminLoginBodySchema.parse({ username: 'ADMIN', password: 'secret', code: '  ' }),
    {
      username: 'admin',
      password: 'secret',
      code: undefined,
    },
  );
  assert.equal(
    adminLoginBodySchema.safeParse({ password: 'secret', code: '123456' }).success,
    true,
  );
  assert.equal(
    adminLoginBodySchema.safeParse({ password: 'secret', code: '12345' }).success,
    false,
  );
  assert.equal(
    adminLoginBodySchema.safeParse({ password: 'secret', unexpected: true }).success,
    false,
  );
  assert.equal(
    adminPhoneVerifyBodySchema.safeParse({ phone: '+7 700 000 00 00', code: '12345' }).success,
    false,
  );
  assert.equal(
    adminPhoneRequestBodySchema.safeParse({
      phone: '+7 700 000 00 00',
      role: 'owner',
    }).success,
    false,
  );
  assert.equal(
    whatsappOperatorAccessBodySchema.safeParse({
      token: 'short',
    }).success,
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

test('contact center contracts reject unknown fields, unsafe targets, and invalid reorders', () => {
  const titles = { ru: 'Bulka', kk: 'Bulka', en: 'Bulka' };
  const labels = { ru: 'Сайт', kk: 'Сайт', en: 'Website' };
  const card = {
    displayMode: 'standard',
    titles,
    iconKey: 'bulka',
    sortOrder: 0,
    isActive: false,
  };
  const action = {
    type: 'website',
    labels,
    target: 'https://bulka.com.kz/contact',
    iconKey: 'website',
    sortOrder: 0,
    isActive: true,
  };

  assert.equal(contactCardCreateBodySchema.safeParse(card).success, true);
  assert.equal(contactCardCreateBodySchema.safeParse({ ...card, adminOnly: true }).success, false);
  assert.equal(contactCardUpdateBodySchema.safeParse({}).success, false);
  assert.equal(contactCardUpdateBodySchema.safeParse({ isActive: true }).success, true);
  assert.equal(contactActionCreateBodySchema.safeParse(action).success, true);
  assert.equal(
    contactActionCreateBodySchema.safeParse({
      ...action,
      target: 'javascript:alert(1)',
    }).success,
    false,
  );
  assert.equal(
    contactActionUpdateBodySchema.safeParse({
      type: 'phone',
      target: '+7 700 000 00 00',
      secret: 'unexpected',
    }).success,
    false,
  );
  assert.equal(
    contactReorderBodySchema.safeParse({
      ids: [customerId, customerId],
    }).success,
    false,
  );
});

test('payment integration mutations accept only an explicit mode and an empty probe body', () => {
  assert.deepEqual(paymentWidgetModeBodySchema.parse({ enabled: true }), { enabled: true });
  assert.equal(paymentWidgetModeBodySchema.safeParse({ enabled: 'true' }).success, false);
  assert.equal(
    paymentWidgetModeBodySchema.safeParse({ enabled: true, secretKey: 'hidden' }).success,
    false,
  );
  assert.deepEqual(paymentProbeBodySchema.parse(undefined), {});
  assert.equal(paymentProbeBodySchema.safeParse({ force: true }).success, false);
});

test('admin mutation contracts reject unknown fields across every management area', () => {
  const invalidPayloads = [
    [
      adminMutationSchemas.whatsappSettings.body,
      { assistantEnabled: true, providerSecret: 'must-not-pass' },
    ],
    [adminMutationSchemas.siteAccess.body, { enabled: false, allowedIps: [], bypass: true }],
    [adminMutationSchemas.settings.body, { base_cashback_percent: 5, databaseUrl: 'hidden' }],
    [
      adminMutationSchemas.tierCreate.body,
      {
        code: 'silver',
        names: { ru: 'Серебро', kk: 'Күміс', en: 'Silver' },
        descriptions: { ru: 'Уровень', kk: 'Деңгей', en: 'Tier' },
        minSpend: 50_000,
        cashbackPercent: 5,
        sortOrder: 1,
        isActive: true,
        ownerOnly: true,
      },
    ],
    [
      adminMutationSchemas.productOverride.body,
      {
        iikoProductId: 'product-1',
        overrides: { is_hidden: false, rawSql: 'drop table menu' },
      },
    ],
    [
      adminMutationSchemas.inventory.body,
      {
        productName: 'Булочка',
        sourceQuantity: 10,
        manualStop: false,
        branchOverride: customerId,
      },
    ],
    [
      adminMutationSchemas.courierCreate.body,
      {
        name: 'Курьер',
        phone: '+7 700 000 00 00',
        vehicle: 'Авто',
        active: true,
        authVersion: 99,
      },
    ],
    [
      adminMutationSchemas.locationCreate.body,
      {
        cityId: customerId,
        name: 'ЖК Дукат',
        address: '17-й микрорайон, 1',
        latitude: 43.66,
        longitude: 51.13,
        internalCode: 'secret',
      },
    ],
    [
      adminMutationSchemas.supportMessage.body,
      { body: 'Ответ клиенту', internal: false, senderType: 'owner' },
    ],
    [
      adminMutationSchemas.promotionCreate.body,
      {
        code: 'SALE10',
        title: 'Скидка',
        discountType: 'percent',
        discountValue: 10,
        minOrder: 0,
        maxDiscount: null,
        customerIds: [],
        customerTags: [],
        usageLimit: null,
        perCustomerLimit: 1,
        startsAt: null,
        endsAt: null,
        active: true,
        redemptionCount: 1,
      },
    ],
    [
      adminMutationSchemas.accessCreate.body,
      {
        phone: '+7 700 000 00 00',
        displayName: 'Оператор',
        role: 'operator',
        branchIds: [],
        password: 'must-not-pass',
      },
    ],
  ];

  for (const [schema, payload] of invalidPayloads) {
    assert.equal(schema.safeParse(payload).success, false);
  }
});

test('admin mutation contracts accept the payloads emitted by current admin forms', () => {
  assert.equal(
    adminMutationSchemas.orderStatus.body.safeParse({
      status: 'cancelled',
      cancellationReason: 'Товара нет',
    }).success,
    true,
  );
  for (const cancellationReason of ['', ',', '...', 'не']) {
    assert.equal(
      adminMutationSchemas.orderStatus.body.safeParse({
        status: 'cancelled',
        cancellationReason,
      }).success,
      false,
    );
  }
  assert.equal(
    adminMutationSchemas.whatsappMessage.body.safeParse({
      text: 'Здравствуйте',
      clientMessageId: 'reply_123',
    }).success,
    true,
  );
  assert.equal(
    adminMutationSchemas.settings.body.safeParse({
      base_cashback_percent: 3,
      max_discount_percent: 50,
      bonus_expiration: {
        enabled: true,
        expiration_days: 90,
        notify_before_days: 30,
      },
    }).success,
    true,
  );
  assert.equal(
    adminMutationSchemas.locationCreate.body.safeParse({
      cityId: customerId,
      name: 'ЖК Дукат',
      address: '17-й микрорайон, 1',
      latitude: 43.66944,
      longitude: 51.13693,
      active: true,
      pickupEnabled: true,
      preorderEnabled: true,
      deliveryEnabled: true,
      deliveryZones: [
        {
          id: 'zone-1',
          radiusKm: 5,
          fee: 700,
          minOrder: 3_000,
          color: '#C97532',
        },
      ],
      hours: { daily: { open: '08:00', close: '21:00' } },
      slotMinutes: 60,
      pickupSlotCapacity: 20,
      preorderSlotCapacity: 10,
      deliverySlotCapacity: 15,
    }).success,
    true,
  );
  assert.equal(
    adminMutationSchemas.promotionCreate.body.safeParse({
      code: 'SALE10',
      title: 'Скидка',
      discountType: 'percent',
      discountValue: 10,
      minOrder: 0,
      maxDiscount: null,
      customerIds: [],
      customerTags: [],
      usageLimit: null,
      perCustomerLimit: 1,
      startsAt: null,
      endsAt: null,
      active: true,
    }).success,
    true,
  );
  assert.deepEqual(adminMutationSchemas.empty.body.parse(undefined), {});
  assert.equal(
    adminMutationSchemas.courierEmpty.params.safeParse({ id: 'not-a-uuid' }).success,
    false,
  );
});

test('product override validation compacts empty storage rows', () => {
  const parsed = adminMutationSchemas.productOverride.body.parse({
    iikoProductId: 'product-1',
    overrides: {
      custom_price: 300,
      storage_conditions: [
        { temperature: '', duration_value: undefined, duration_unit: '' },
        { temperature: '  ', duration_value: '', duration_unit: '' },
      ],
    },
  });

  assert.deepEqual(parsed.overrides.storage_conditions, []);
});

test('product override validation keeps incomplete optional storage rows unpublished', () => {
  const parsed = adminMutationSchemas.productOverride.body.parse({
    iikoProductId: 'product-1',
    overrides: {
      storage_conditions: [
        { temperature: '-18 °C', duration_value: '', duration_unit: 'days' },
        { temperature: '', duration_value: 72, duration_unit: 'hours' },
      ],
    },
  });

  assert.deepEqual(parsed.overrides.storage_conditions, []);
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

test('analytics and substitution contracts reject forged workflow fields', () => {
  assert.equal(
    analyticsEventsBodySchema.safeParse({
      events: [
        {
          eventId: customerId,
          type: 'checkout_start',
          branchId: customerId,
          properties: { items: 2 },
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    analyticsEventsBodySchema.safeParse({
      events: [{ type: 'checkout_started', branchId: customerId }],
    }).success,
    true,
  );
  assert.equal(
    analyticsEventsBodySchema.safeParse({
      events: [{ type: 'payment_magic', branchId: 'not-a-uuid' }],
    }).success,
    false,
  );
  assert.equal(
    orderSubstitutionCreateBodySchema.safeParse({
      lineKey: 'bun:0',
      quantity: 1,
      action: 'replace_with_approval',
    }).success,
    false,
  );
  assert.equal(
    orderSubstitutionCreateBodySchema.safeParse({
      lineKey: 'bun:0',
      quantity: 1,
      action: 'replace_with_approval',
      replacementProductId: 'croissant',
      refundAmount: 1000000,
    }).success,
    false,
  );
});

test('remaining customer mutations use strict bounded contracts', () => {
  assert.deepEqual(
    registrationBodySchema.parse({
      name: '  Амандық  ',
      phone: '+7 747 000 00 00',
    }),
    {
      name: 'Амандық',
      phone: '+7 747 000 00 00',
    },
  );
  assert.equal(
    registrationBodySchema.safeParse({
      name: 'Клиент',
      role: 'admin',
    }).success,
    false,
  );

  assert.equal(customerOrderParamsSchema.safeParse({ id: customerId }).success, true);
  assert.equal(customerOrderParamsSchema.safeParse({ id: 'order-1' }).success, false);
  assert.equal(customerProductParamsSchema.safeParse({ productId: '../secret' }).success, false);
  assert.deepEqual(favoriteMutationBodySchema.parse({}), { favorite: true });
  assert.equal(favoriteMutationBodySchema.safeParse({ favorite: true, customerId }).success, false);
  assert.equal(reorderBodySchema.safeParse({ branchId: customerId }).success, true);
  assert.equal(reorderBodySchema.safeParse({ branchId: 'all' }).success, false);

  assert.equal(
    cartSnapshotBodySchema.safeParse({
      items: [{ id: 'bun-1', quantity: 2 }],
      branchId: customerId,
      orderType: 'pickup',
    }).success,
    true,
  );
  assert.equal(
    cartSnapshotBodySchema.safeParse({
      items: [{ id: 'bun-1', quantity: 0, price: 1 }],
      orderType: 'pickup',
    }).success,
    false,
  );

  assert.equal(
    orderReviewBodySchema.safeParse({
      rating: 5,
      comment: 'Всё отлично',
      items: [{ productId: 'bun-1', rating: 5 }],
    }).success,
    true,
  );
  assert.equal(
    orderReviewBodySchema.safeParse({
      rating: 6,
      status: 'published',
    }).success,
    false,
  );
  assert.equal(referralRedeemBodySchema.safeParse({ code: 'BULKA-ABC12345' }).success, true);
  assert.equal(
    referralRedeemBodySchema.safeParse({ code: '<script>alert(1)</script>' }).success,
    false,
  );
  assert.equal(giftCardRedeemBodySchema.safeParse({ code: 'BLK-ABCDEF0123456789' }).success, true);
  assert.equal(
    giftCardRedeemBodySchema.safeParse({ code: 'BLK-ABC', amount: 1_000_000 }).success,
    false,
  );

  const address = {
    label: 'Дом',
    address: '32А микрорайон, дом 6',
    city: 'Актау',
    latitude: '43.6532',
    longitude: '51.1975',
    house: '14',
    entrance: '2',
    floor: '7',
    apartment: '42',
  };
  assert.equal(customerAddressBodySchema.safeParse(address).success, true);
  assert.equal(
    customerAddressBodySchema.safeParse({
      ...address,
      latitude: 91,
    }).success,
    false,
  );
  assert.equal(
    customerAddressBodySchema.safeParse({
      ...address,
      customerId,
    }).success,
    false,
  );
  assert.equal(customerAddressParamsSchema.safeParse({ id: customerId }).success, true);
});

test('baseline API envelope applies Zod validation to untyped JSON routes', () => {
  const valid = {
    path: '/api/example',
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    query: { page: '1' },
    body: { safe: true },
  };
  let validError;
  apiEnvelopeValidationMiddleware(valid, {}, (error) => {
    validError = error;
  });
  assert.equal(validError, undefined);

  const invalid = {
    path: '/admin/api/example',
    method: 'GET',
    headers: {},
    query: { nested: { unsafe: true } },
    body: undefined,
  };
  let invalidError;
  apiEnvelopeValidationMiddleware(invalid, {}, (error) => {
    invalidError = error;
  });
  assert.equal(invalidError.code, 'QUERY_VALIDATION_ERROR');
});

test('story contracts accept extended promotion metadata and reject invalid limits', () => {
  const localized = {
    ru: {
      title: 'Кофе в подарок',
      description: 'Краткое описание',
      details: 'Подробные условия акции.',
      coverUrl: 'https://example.com/cover.webp',
      contentUrl: 'https://example.com/story.webp',
    },
    kz: {
      title: 'Кофе сыйлыққа',
      description: '',
      details: '',
      coverUrl: '',
      contentUrl: '',
    },
    en: {
      title: 'Free coffee',
      description: '',
      details: '',
      coverUrl: '',
      contentUrl: '',
    },
  };
  const payload = {
    title: localized.ru.title,
    description: localized.ru.description,
    details: localized.ru.details,
    coverUrl: localized.ru.coverUrl,
    contentUrl: localized.ru.contentUrl,
    groupId: 'free-coffee',
    groupTitle: localized.ru.title,
    duration: 15,
    sortOrder: 1,
    promoType: 'promotion',
    startsAt: '2026-08-01T05:00:00.000Z',
    endsAt: '2026-08-10T05:00:00.000Z',
    remaining: 10,
    qrValue: 'BULKA-FREE-COFFEE',
    createdAt: null,
    i18n: localized,
  };

  assert.equal(adminMutationSchemas.storyCreate.body.safeParse(payload).success, true);
  assert.equal(
    adminMutationSchemas.storyCreate.body.safeParse({ ...payload, remaining: -1 }).success,
    false,
  );
  assert.equal(
    adminMutationSchemas.storyCreate.body.safeParse({
      ...payload,
      startsAt: payload.endsAt,
      endsAt: payload.startsAt,
    }).success,
    false,
  );
  assert.equal(
    adminMutationSchemas.storyCreate.body.safeParse({
      ...payload,
      promoType: 'recurring',
    }).success,
    false,
  );
});

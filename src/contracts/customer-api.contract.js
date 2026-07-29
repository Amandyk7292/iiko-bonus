const { z } = require('../middlewares/validation.middleware');

const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const uuidSchema = z.string().trim().uuid();
const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(32)
  .regex(/^[+()\s0-9-]+$/);
const coordinateSchema = z.coerce.number().finite();
const optionalCoordinateSchema = z.preprocess(
  (value) => (value === '' || value === null || value === undefined ? undefined : value),
  coordinateSchema.optional(),
);
const timeSchema = z
  .string()
  .trim()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const forteOperationParamsSchema = z.object({ operationId: z.string().trim().uuid() }).strict();
const fortePaymentMethodParamsSchema = z.object({ methodId: z.string().trim().uuid() }).strict();
const forteCardSetupBodySchema = z
  .object({ language: z.enum(['ru', 'kk', 'en']).optional().default('ru') })
  .strict();
const nullableText = (maximum) => z.string().trim().max(maximum).nullish();
const cartConfigurationSchema = z.record(z.string().max(80), z.unknown());
const cartModifierSchema = z.record(z.string().max(80), z.unknown());
const checkoutItemSchema = z
  .object({
    id: resourceIdSchema,
    quantity: z.coerce.number().int().min(1).max(99),
    configuration: cartConfigurationSchema.nullish(),
    modifiers: z.array(cartModifierSchema).max(50).nullish(),
  })
  .strict();
const checkoutAddressSchema = z
  .object({
    label: nullableText(160),
    address: z.string().trim().min(1).max(500),
    city: z.string().trim().min(1).max(160),
    latitude: coordinateSchema.min(-90).max(90),
    longitude: coordinateSchema.min(-180).max(180),
    entrance: nullableText(80),
    floor: nullableText(40),
    apartment: nullableText(80),
    comment: nullableText(500),
  })
  .strict();
const checkoutQuoteBodySchema = z
  .object({
    items: z.array(checkoutItemSchema).min(1).max(50),
    orderType: z.enum(['pickup', 'delivery', 'preorder']).nullish(),
    fulfillmentType: z.enum(['pickup', 'delivery', 'preorder']).nullish(),
    preorderFulfillmentType: z.enum(['pickup', 'delivery']).nullish(),
    branch: nullableText(160),
    branchId: nullableText(128),
    scheduledAt: z.iso.datetime({ offset: true }).nullish(),
    pickupTime: z.iso.datetime({ offset: true }).nullish(),
    deliveryAddress: checkoutAddressSchema.nullish(),
    promoCode: nullableText(80),
  })
  .strict();
const checkoutPaymentBodySchema = checkoutQuoteBodySchema
  .extend({
    checkoutId: z.string().trim().uuid(),
    savedPaymentMethodId: nullableText(200),
    additionalPhone: nullableText(32),
    comment: nullableText(500),
    substitutionPreference: z
      .enum(['remove_refund', 'call_customer', 'replace_with_approval'])
      .optional()
      .default('call_customer'),
    language: z.enum(['ru', 'kk', 'en']).nullish(),
  })
  .strict();

const registrationBodySchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    // Kept for compatibility with the public registration form. The server
    // continues to trust only the phone embedded in the signed registration token.
    phone: phoneSchema.optional(),
  })
  .strict();

const customerOrderParamsSchema = z.object({ id: uuidSchema }).strict();
const customerProductParamsSchema = z.object({ productId: resourceIdSchema }).strict();
const favoriteMutationBodySchema = z
  .object({
    favorite: z.boolean().optional().default(true),
  })
  .strict();
const reorderBodySchema = z
  .object({
    branchId: uuidSchema.optional(),
  })
  .strict();
const cartSnapshotBodySchema = z
  .object({
    items: z.array(checkoutItemSchema).max(50),
    branchId: uuidSchema.nullish(),
    orderType: z.enum(['pickup', 'delivery', 'preorder']).optional().default('pickup'),
  })
  .strict();

const reviewItemSchema = z
  .object({
    productId: resourceIdSchema,
    rating: z.coerce.number().int().min(1).max(5).nullish(),
    complaintReason: z.string().trim().max(300).nullish(),
    comment: z.string().trim().max(1_000).nullish(),
  })
  .strict();
const orderReviewBodySchema = z
  .object({
    rating: z.coerce.number().int().min(1).max(5),
    comment: z.string().trim().max(2_000).nullish(),
    items: z.array(reviewItemSchema).max(50).optional().default([]),
  })
  .strict();

const referralRedeemBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(6)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
  })
  .strict();
const giftCardRedeemBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .min(8)
      .max(64)
      .regex(/^[A-Za-z0-9-]+$/),
  })
  .strict();

const customerAddressParamsSchema = z.object({ id: uuidSchema }).strict();
const optionalAddressText = (maximum) => z.string().trim().max(maximum).nullish();
const customerAddressBodySchema = z
  .object({
    label: optionalAddressText(120),
    address: z.string().trim().min(3).max(500),
    city: z.string().trim().min(1).max(100),
    latitude: coordinateSchema.min(-90).max(90),
    longitude: coordinateSchema.min(-180).max(180),
    entrance: optionalAddressText(30),
    floor: optionalAddressText(20),
    apartment: optionalAddressText(30),
    comment: optionalAddressText(300),
    courierComment: optionalAddressText(300),
    isDefault: z.boolean().optional(),
  })
  .strict();

const courierAuthRequestBodySchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(10)
      .max(24)
      .regex(/^[+()\s0-9-]+$/),
  })
  .strict();

const courierAuthVerifyBodySchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(10)
      .max(24)
      .regex(/^[+()\s0-9-]+$/),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  })
  .strict();

const courierLocationBodySchema = z
  .object({
    latitude: coordinateSchema.min(-90).max(90),
    longitude: coordinateSchema.min(-180).max(180),
  })
  .strict();

const courierOrderParamsSchema = z.object({ orderId: resourceIdSchema }).strict();

const courierOrderStatusBodySchema = z
  .object({
    status: z.enum(['assigned', 'picked_up', 'en_route', 'cancelled']),
  })
  .strict();

const courierConfirmDeliveryBodySchema = z
  .object({
    pin: z
      .string()
      .trim()
      .regex(/^\d{4,8}$/),
    latitude: optionalCoordinateSchema.refine(
      (value) => value === undefined || (value >= -90 && value <= 90),
      'Некорректная широта',
    ),
    longitude: optionalCoordinateSchema.refine(
      (value) => value === undefined || (value >= -180 && value <= 180),
      'Некорректная долгота',
    ),
  })
  .strict();

const profileUpdateBodySchema = z
  .object({
    name: z.string().trim().max(160).optional(),
    last_name: z.string().trim().max(160).optional(),
    gender: z.enum(['male', 'female', 'other', 'Мужской', 'Женский', '']).optional(),
    email: z.union([z.email().max(255), z.literal('')]).optional(),
    region: z.string().trim().max(160).optional(),
    birth_date: z
      .union([z.iso.date(), z.literal('')])
      .optional()
      .refine((value) => !value || Date.parse(`${value}T00:00:00Z`) <= Date.now(), {
        message: 'Дата рождения не может быть в будущем',
      }),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Нет данных для обновления',
  });

const notificationPreferencesBodySchema = z
  .object({
    ordersEnabled: z.boolean().optional(),
    bonusEnabled: z.boolean().optional(),
    promosEnabled: z.boolean().optional(),
    supportEnabled: z.boolean().optional(),
    quietHoursEnabled: z.boolean().optional(),
    quietStart: timeSchema.optional(),
    quietEnd: timeSchema.optional(),
    timezone: z.string().trim().min(1).max(80).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Нет настроек для обновления',
  });

const supportRequestParamsSchema = z.object({ id: resourceIdSchema }).strict();
const supportAttachmentSchema = z.string().trim().min(1).max(500);

const supportCreateBodySchema = z
  .object({
    orderId: resourceIdSchema.nullish(),
    category: z.enum(['order_issue', 'product_quality', 'delivery', 'refund', 'other']),
    message: z.string().trim().min(5).max(2000),
    refundRequested: z.boolean().optional().default(false),
    attachments: z.array(supportAttachmentSchema).max(3).optional().default([]),
  })
  .strict();

const supportMessageBodySchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    attachments: z.array(supportAttachmentSchema).max(3).optional().default([]),
  })
  .strict();

const liveActivityBodySchema = z
  .object({
    pushToken: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-f0-9]{64,256}$/),
    activityId: z.string().trim().min(1).max(120),
    installationId: z.string().trim().min(1).max(120),
    orderId: resourceIdSchema,
    environment: z.enum(['production', 'sandbox']).optional().default('production'),
  })
  .strict();

const liveActivityDeleteBodySchema = z
  .object({
    activityId: z.string().trim().min(1).max(120).optional(),
    orderId: resourceIdSchema.optional(),
  })
  .strict()
  .refine((value) => value.activityId || value.orderId, {
    message: 'Укажите activityId или orderId',
  });

const analyticsEventSchema = z
  .object({
    eventId: z.string().trim().uuid().optional(),
    type: z.enum([
      'app_open',
      'catalog_view',
      'product_view',
      'add_to_cart',
      'remove_from_cart',
      'checkout_start',
      'checkout_quote',
      'payment_created',
      'payment_paid',
      'payment_failed',
      'payment_cancelled',
      'search',
      'promotion_view',
    ]),
    occurredAt: z.iso.datetime({ offset: true }).optional(),
    productId: resourceIdSchema.optional(),
    categoryId: resourceIdSchema.optional(),
    branchId: z.string().trim().uuid().optional(),
    orderId: z.string().trim().uuid().optional(),
    properties: z
      .record(z.string().max(40), z.union([z.string(), z.number(), z.boolean(), z.null()]))
      .optional()
      .default({}),
  })
  .strict();

const analyticsEventsBodySchema = z
  .object({
    events: z.array(analyticsEventSchema).min(1).max(20),
  })
  .strict();

const kaspiWebhookBodySchema = z
  .object({
    event: z.enum(['payment.success', 'payment.failed', 'payment.expired']),
    operationId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,100}$/)
      .optional(),
    paymentId: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9-]{1,100}$/)
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.operationId || value.paymentId), {
    message: 'operationId or paymentId is required',
  })
  .refine(
    (value) =>
      !value.operationId ||
      !value.paymentId ||
      String(value.operationId) === String(value.paymentId),
    {
      message: 'operationId and paymentId must match',
    },
  );

const forteProviderIdSchema = z.union([
  z.string().trim().min(1).max(200),
  z.number().int().nonnegative(),
]);
const forteTimestampSchema = z.iso.datetime({ offset: true }).nullable().optional();
// additional_data and payment-method data are merchant/provider extension
// containers by specification. Their envelopes stay bounded by the global
// request safety middleware while all security-relevant fields remain exact.
const forteExtensionSchema = z.record(z.string().max(120), z.unknown());
const forteCardSchema = z
  .object({
    holder: z.string().max(200).nullable().optional(),
    stamp: z.string().max(256).nullable().optional(),
    brand: z.string().max(40).nullable().optional(),
    sub_brand: z.string().max(80).nullable().optional(),
    last_4: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    last_four: z
      .string()
      .regex(/^\d{4}$/)
      .nullable()
      .optional(),
    first_1: z.string().regex(/^\d$/).nullable().optional(),
    bin: z
      .string()
      .regex(/^\d{6,8}$/)
      .nullable()
      .optional(),
    issuer_country: z.string().max(3).nullable().optional(),
    issuer_name: z.string().max(200).nullable().optional(),
    product: z.string().max(120).nullable().optional(),
    exp_month: z.number().int().min(1).max(12).nullable().optional(),
    exp_year: z.number().int().min(2000).max(2200).nullable().optional(),
    token_provider: z.string().max(80).nullable().optional(),
    token: z.string().max(512).nullable().optional(),
    masked_pan: z.string().max(32).nullable().optional(),
  })
  .strict();
const forteTransactionResultSchema = z
  .object({
    auth_code: z.string().max(100).nullable().optional(),
    bank_code: z.string().max(100).nullable().optional(),
    rrn: z.string().max(100).nullable().optional(),
    ref_id: z.string().max(160).nullable().optional(),
    message: z.string().max(1_000).nullable().optional(),
    amount: z.number().int().nonnegative().optional(),
    currency: z.string().length(3).optional(),
    billing_descriptor: z.string().max(200).nullable().optional(),
    gateway_id: forteProviderIdSchema.nullable().optional(),
    status: z.string().max(60).optional(),
  })
  .strict();
const forteGatewaySchema = z
  .object({
    iframe: z.boolean().optional(),
  })
  .strict();
const forteCustomerSchema = z
  .object({
    id: forteProviderIdSchema.nullable().optional(),
    ip: z.string().max(64).nullable().optional(),
    email: z.string().max(320).nullable().optional(),
    device_id: z.string().max(256).nullable().optional(),
    birth_date: z.string().max(32).nullable().optional(),
    first_name: z.string().max(160).nullable().optional(),
    last_name: z.string().max(160).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    city: z.string().max(160).nullable().optional(),
    country: z.string().max(3).nullable().optional(),
    state: z.string().max(160).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
    zip: z.string().max(32).nullable().optional(),
    external_id: z.string().max(200).nullable().optional(),
    taxpayer_id: z.string().max(100).nullable().optional(),
  })
  .strict();
const forteAddressSchema = z
  .object({
    first_name: z.string().max(160).nullable().optional(),
    last_name: z.string().max(160).nullable().optional(),
    address: z.string().max(500).nullable().optional(),
    country: z.string().max(3).nullable().optional(),
    city: z.string().max(160).nullable().optional(),
    zip: z.string().max(32).nullable().optional(),
    state: z.string().max(160).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
  })
  .strict();
const forteSavedCardMethodSchema = forteCardSchema
  .extend({
    type: z.string().max(60).optional(),
    credit_card: forteCardSchema.optional(),
  })
  .strict();
const forteCheckoutPaymentMethodSchema = z
  .object({
    id: forteProviderIdSchema.optional(),
    checkout_data_id: forteProviderIdSchema.optional(),
    types: z.array(z.string().max(40)).max(30).optional(),
    excluded_types: z.array(z.string().max(40)).max(30).optional(),
    excluded_brands: z.array(z.string().max(40)).max(30).optional(),
    credit_card: forteCardSchema.optional(),
    data: forteExtensionSchema.optional(),
    created_at: forteTimestampSchema,
    updated_at: forteTimestampSchema,
  })
  .strict();
const forteTransactionSchema = z
  .object({
    uid: forteProviderIdSchema.optional(),
    id: forteProviderIdSchema.optional(),
    status: z.string().trim().min(1).max(60),
    amount: z.number().int().positive(),
    currency: z.literal('KZT'),
    description: z.string().max(1_000).nullable().optional(),
    type: z.string().max(60).nullable().optional(),
    payment_method_type: z.string().max(60).nullable().optional(),
    tracking_id: uuidSchema,
    message: z.string().max(1_000).nullable().optional(),
    test: z.boolean(),
    created_at: forteTimestampSchema,
    updated_at: forteTimestampSchema,
    paid_at: forteTimestampSchema,
    expired_at: forteTimestampSchema,
    recurring_type: z.string().max(60).nullable().optional(),
    closed_at: forteTimestampSchema,
    settled_at: forteTimestampSchema,
    manually_corrected_at: forteTimestampSchema,
    language: z.enum(['ru', 'kk', 'en']).optional(),
    credit_card: forteCardSchema.optional(),
    card: forteCardSchema.optional(),
    payment_method: forteSavedCardMethodSchema.optional(),
    method: z
      .object({
        brand: z.string().max(40).nullable().optional(),
      })
      .strict()
      .optional(),
    receipt_url: z.url().max(2_000).nullable().optional(),
    status_code: z
      .union([z.string().max(100), z.number().int()])
      .nullable()
      .optional(),
    gateway: forteGatewaySchema.nullable().optional(),
    additional_data: forteExtensionSchema.optional(),
    redirect_url: z.url().max(2_000).nullable().optional(),
    payment: forteTransactionResultSchema.optional(),
    authorization: forteTransactionResultSchema.optional(),
    charge: forteTransactionResultSchema.optional(),
    capture: forteTransactionResultSchema.optional(),
    refund: forteTransactionResultSchema.optional(),
    void: forteTransactionResultSchema.optional(),
    customer: forteCustomerSchema.optional(),
    billing_address: forteAddressSchema.optional(),
  })
  .strict()
  .refine((value) => Boolean(value.uid || value.id), {
    message: 'transaction uid is required',
  });
const forteCheckoutOrderSchema = z
  .object({
    currency: z.literal('KZT'),
    amount: z.number().int().positive(),
    description: z.string().max(1_000).nullable().optional(),
    tracking_id: uuidSchema,
    additional_data: forteExtensionSchema.optional(),
    custom_fields: forteExtensionSchema.optional(),
    expected_bank_code: z.string().max(100).nullable().optional(),
    receipt_text: z.array(z.string().max(100)).max(50).optional(),
    expired_at: forteTimestampSchema,
  })
  .strict();
const forteCheckoutSettingsSchema = z
  .object({
    success_url: z.url().max(2_000).nullable().optional(),
    fail_url: z.url().max(2_000).nullable().optional(),
    decline_url: z.url().max(2_000).nullable().optional(),
    notification_url: z.url().max(2_000).nullable().optional(),
    cancel_url: z.url().max(2_000).nullable().optional(),
    return_url: z.url().max(2_000).nullable().optional(),
    verification_url: z.url().max(2_000).nullable().optional(),
    language: z.enum(['ru', 'kk', 'en']).optional(),
    auto_return: z.union([z.number().int().nonnegative(), z.string().max(20)]).optional(),
    button_next_text: z.string().max(200).nullable().optional(),
    customer_fields: z
      .object({
        hidden: z.array(z.string().max(80)).max(50).optional(),
        read_only: z.array(z.string().max(80)).max(50).optional(),
        visible: z.array(z.string().max(80)).max(50).optional(),
      })
      .strict()
      .optional(),
    credit_card_fields: z
      .object({
        holder: z.string().max(200).nullable().optional(),
      })
      .strict()
      .optional(),
    save_card_toggle: z
      .object({
        display: z.boolean().optional(),
        customer_contract: z.boolean().optional(),
        text: z.string().max(500).nullable().optional(),
        hint: z.string().max(500).nullable().optional(),
      })
      .strict()
      .optional(),
    another_card_toggle: z
      .object({
        display: z.boolean().optional(),
      })
      .strict()
      .optional(),
    agreement_toggle: z
      .object({
        value: z.boolean().optional(),
        url: z.url().max(2_000).nullable().optional(),
        text: z.string().max(500).nullable().optional(),
      })
      .strict()
      .optional(),
    style: z
      .object({
        widget: z
          .object({
            buttonsColor: z.string().max(40).optional(),
            backgroundType: z.number().int().min(0).max(100).optional(),
          })
          .strict()
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const forteShopSchema = z
  .object({
    id: forteProviderIdSchema.optional(),
    name: z.string().max(200).nullable().optional(),
    country: z.string().max(3).nullable().optional(),
    url: z.url().max(2_000).nullable().optional(),
    contact_email: z.string().max(320).nullable().optional(),
    contact_phone: z.string().max(32).nullable().optional(),
    brands: z.array(z.string().max(40)).max(50).optional(),
  })
  .strict();
const forteMerchantSchema = z
  .object({
    id: forteProviderIdSchema.optional(),
    country: z.string().max(3).nullable().optional(),
  })
  .strict();
const forteGatewayResponseSchema = z
  .object({
    payment: forteTransactionSchema.optional(),
    authorization: forteTransactionSchema.optional(),
    charge: forteTransactionSchema.optional(),
  })
  .strict()
  .nullable();
const forteCheckoutSchema = z
  .object({
    token: z.string().trim().min(32).max(512),
    shop_id: forteProviderIdSchema.optional(),
    transaction_type: z.string().max(60).optional(),
    attempts: z.number().int().min(1).max(100).optional(),
    iframe: z.boolean().optional(),
    dynamic_billing_descriptor: z.string().max(200).nullable().optional(),
    gateway_response: forteGatewayResponseSchema.optional(),
    order: forteCheckoutOrderSchema,
    settings: forteCheckoutSettingsSchema.optional(),
    customer: forteCustomerSchema.optional(),
    finished: z.boolean(),
    expired: z.boolean(),
    shop: forteShopSchema.optional(),
    merchant: forteMerchantSchema.optional(),
    test: z.boolean(),
    status: z.string().trim().min(1).max(60),
    message: z.string().max(1_000).nullable().optional(),
    payment_method: forteCheckoutPaymentMethodSchema.optional(),
    credit_card: forteCardSchema.optional(),
    card: forteCardSchema.optional(),
    redirect_url: z.url().max(2_000).nullable().optional(),
  })
  .strict();
const forteWidgetWebhookBodySchema = z.union([
  z.object({ transaction: forteTransactionSchema }).strict(),
  z.object({ checkout: forteCheckoutSchema }).strict(),
  forteCheckoutSchema,
  forteTransactionSchema,
]);

module.exports = {
  analyticsEventsBodySchema,
  cartSnapshotBodySchema,
  checkoutPaymentBodySchema,
  checkoutQuoteBodySchema,
  courierAuthRequestBodySchema,
  courierAuthVerifyBodySchema,
  courierConfirmDeliveryBodySchema,
  courierLocationBodySchema,
  courierOrderParamsSchema,
  courierOrderStatusBodySchema,
  forteCardSetupBodySchema,
  forteOperationParamsSchema,
  fortePaymentMethodParamsSchema,
  customerAddressBodySchema,
  customerAddressParamsSchema,
  customerOrderParamsSchema,
  customerProductParamsSchema,
  favoriteMutationBodySchema,
  giftCardRedeemBodySchema,
  forteWidgetWebhookBodySchema,
  kaspiWebhookBodySchema,
  liveActivityBodySchema,
  liveActivityDeleteBodySchema,
  notificationPreferencesBodySchema,
  orderReviewBodySchema,
  profileUpdateBodySchema,
  referralRedeemBodySchema,
  registrationBodySchema,
  reorderBodySchema,
  supportCreateBodySchema,
  supportMessageBodySchema,
  supportRequestParamsSchema,
};

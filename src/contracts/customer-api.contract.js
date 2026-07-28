const { z } = require('../middlewares/validation.middleware');

const resourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/);
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

module.exports = {
  analyticsEventsBodySchema,
  courierAuthRequestBodySchema,
  courierAuthVerifyBodySchema,
  courierConfirmDeliveryBodySchema,
  courierLocationBodySchema,
  courierOrderParamsSchema,
  courierOrderStatusBodySchema,
  forteCardSetupBodySchema,
  forteOperationParamsSchema,
  fortePaymentMethodParamsSchema,
  liveActivityBodySchema,
  liveActivityDeleteBodySchema,
  notificationPreferencesBodySchema,
  profileUpdateBodySchema,
  supportCreateBodySchema,
  supportMessageBodySchema,
  supportRequestParamsSchema,
};

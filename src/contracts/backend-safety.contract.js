const { z } = require('../middlewares/validation.middleware');

const nullableShortText = (maximum) => z.string().trim().max(maximum).nullable().optional();
const uuidSchema = z.string().trim().uuid();

const legalConsentSchema = z
  .object({
    offerVersion: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    offerHash: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    privacyVersion: z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/),
    privacyHash: z
      .string()
      .trim()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
    locale: z.enum(['ru', 'kk', 'en']),
    channel: z.enum(['web', 'android', 'ios', 'mobile_app', 'mobile_api']),
    acceptedAt: z.iso.datetime({ offset: true }).optional(),
  })
  .strict();

const customerRegistrationBodySchema = z
  .object({
    phone: z.string().trim().max(32).optional(),
    name: z.string().trim().min(1).max(80),
    surname: nullableShortText(80),
    gender: nullableShortText(16),
    birthdate: nullableShortText(10),
    email: nullableShortText(254),
    acceptedLegal: z.literal(true),
    legalConsent: legalConsentSchema,
  })
  .strict();

const orderParamsSchema = z.object({ id: uuidSchema }).strict();
const refundLineSchema = z
  .object({
    lineKey: z.string().trim().min(1).max(220),
    quantity: z.coerce.number().int().min(1).max(99),
  })
  .strict();
const partialRefundPreviewBodySchema = z
  .object({
    items: z.array(refundLineSchema).min(1).max(200),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();
const partialRefundBodySchema = partialRefundPreviewBodySchema.extend({
  idempotencyKey: uuidSchema.optional(),
});

const kitchenStatusBodySchema = z
  .object({
    status: z.enum(['queued', 'preparing', 'ready', 'handed_over', 'cancelled']),
    preparationMinutes: z.coerce.number().int().min(1).max(1440).nullable().optional(),
    cancellationReason: z.string().trim().max(500).optional(),
    iikoManualEntryConfirmed: z.literal(true).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === 'preparing' && value.iikoManualEntryConfirmed !== true) {
      context.addIssue({
        code: 'custom',
        path: ['iikoManualEntryConfirmed'],
        message: 'Подтвердите ручное внесение заказа в iikoFront',
      });
    }
  });

const auditLogQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000_000).optional().default(1),
    pageSize: z.coerce.number().int().min(10).max(100).optional().default(50),
    method: z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']).optional(),
    outcome: z.enum(['success', 'rejected', 'server_error']).optional(),
    status: z.enum(['success', 'rejected', 'server_error']).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();

module.exports = {
  auditLogQuerySchema,
  customerRegistrationBodySchema,
  kitchenStatusBodySchema,
  orderParamsSchema,
  partialRefundBodySchema,
  partialRefundPreviewBodySchema,
};

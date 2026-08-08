const { z } = require('../middlewares/validation.middleware');

const uuid = z.string().trim().uuid();
const resourceId = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);

const bonusExpiryQuerySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).optional().default(30),
  })
  .strict();

const stockSubscriptionBodySchema = z
  .object({
    productId: resourceId,
    branchId: uuid,
  })
  .strict();
const stockSubscriptionParamsSchema = z.object({ id: uuid }).strict();
const stockSubscriptionProductParamsSchema = z.object({ productId: resourceId }).strict();
const stockSubscriptionStatusQuerySchema = z.object({ branchId: uuid }).strict();

const giftRecipientSchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(10)
      .max(32)
      .regex(/^[+()\s0-9-]+$/),
    name: z.string().trim().min(1).max(160).optional(),
    message: z.string().trim().max(500).optional(),
  })
  .strict();
const giftCertificatePurchaseBodySchema = z
  .object({
    requestId: uuid,
    amount: z.coerce.number().int().min(500).max(1_000_000),
    recipient: giftRecipientSchema,
    deliveryAt: z.iso.datetime({ offset: true }).optional(),
    paymentMethod: z.literal('forte'),
    locale: z.enum(['ru', 'kk', 'en']).optional().default('ru'),
    savedPaymentMethodId: uuid.optional(),
  })
  .strict();
const giftCertificatePurchaseParamsSchema = z.object({ id: uuid }).strict();
const giftCertificateListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(50).optional().default(50),
  })
  .strict();

const orderUuidParamsSchema = z.object({ id: uuid }).strict();
const pickupHandoffVerifyBodySchema = z
  .object({
    token: z.string().trim().min(20).max(500).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.token) !== Boolean(value.pin), {
    message: 'Передайте QR-токен или PIN',
  });

const adminGlobalSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(120),
    limit: z.coerce.number().int().min(1).max(50).optional().default(20),
  })
  .strict();
const adminGlobalSearchDetailParamsSchema = z
  .object({
    type: z.enum(['order', 'customer', 'support']),
    id: uuid,
  })
  .strict();
const branchPosCredentialParamsSchema = z.object({ id: uuid }).strict();

module.exports = {
  adminGlobalSearchDetailParamsSchema,
  adminGlobalSearchQuerySchema,
  bonusExpiryQuerySchema,
  branchPosCredentialParamsSchema,
  giftCertificatePurchaseBodySchema,
  giftCertificateListQuerySchema,
  giftCertificatePurchaseParamsSchema,
  orderUuidParamsSchema,
  pickupHandoffVerifyBodySchema,
  stockSubscriptionBodySchema,
  stockSubscriptionParamsSchema,
  stockSubscriptionProductParamsSchema,
  stockSubscriptionStatusQuerySchema,
};

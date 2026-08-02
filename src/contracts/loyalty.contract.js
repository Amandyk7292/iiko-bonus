const { z } = require('../middlewares/validation.middleware');

const uuidSchema = z.string().trim().uuid();
const orderIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(
    (value) => ![...value].some((character) => character.charCodeAt(0) < 32),
    'orderId contains control characters',
  );
const moneySchema = z.coerce.number().finite().min(0).max(100_000_000);

const loyaltyCustomerBodySchema = z
  .object({
    phone: z
      .string()
      .trim()
      .min(10)
      .max(32)
      .regex(/^[+()\s0-9-]+$/),
    name: z.string().trim().min(1).max(160).optional(),
  })
  .strict();

const loyaltySearchBodySchema = z
  .object({
    query: z.string().trim().min(1).max(160),
  })
  .strict();

const loyaltyCalculateBodySchema = z
  .object({
    customerId: uuidSchema.nullish(),
    orderTotal: moneySchema,
    requestedBonusAmount: moneySchema.optional().default(0),
  })
  .strict();

const loyaltyItemSchema = z
  .object({
    productId: z.string().trim().min(1).max(200),
    productName: z.string().trim().min(1).max(500),
    amount: z.coerce.number().finite().positive().max(10_000),
    price: moneySchema,
    total: moneySchema,
  })
  .strict();

const loyaltyReserveBodySchema = z
  .object({
    customerId: uuidSchema,
    orderId: orderIdSchema,
    discountAmount: moneySchema.optional().default(0),
    orderTotal: moneySchema,
  })
  .strict();

const loyaltyCommitBodySchema = z
  .object({
    customerId: uuidSchema,
    orderId: orderIdSchema,
    reservationId: uuidSchema,
    orderTotal: moneySchema,
    items: z.array(loyaltyItemSchema).max(500).nullish(),
  })
  .strict();

const loyaltyCancelBodySchema = z
  .object({
    customerId: uuidSchema,
    orderId: orderIdSchema,
    reservationId: uuidSchema,
  })
  .strict();

const loyaltyApplyBodySchema = loyaltyReserveBodySchema
  .extend({
    items: z.array(loyaltyItemSchema).max(500).nullish(),
    operation: z.literal('apply').optional(),
    reservationId: uuidSchema.nullish(),
    attempts: z.coerce.number().int().min(0).max(1000).optional(),
    createdAtUtc: z.iso.datetime({ offset: true }).optional(),
    updatedAtUtc: z.iso.datetime({ offset: true }).optional(),
    lastAttemptAtUtc: z.union([z.iso.datetime({ offset: true }), z.literal('')]).optional(),
    lastError: z.string().max(1000).optional(),
    terminal: z.boolean().optional(),
  })
  .strict();

const pickupHandoffPluginBodySchema = z
  .object({
    branchId: uuidSchema,
    token: z.string().trim().min(20).max(500).optional(),
    pin: z
      .string()
      .trim()
      .regex(/^\d{6}$/)
      .optional(),
    orderNumber: z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
    iikoOrderId: orderIdSchema.optional(),
  })
  .strict()
  .refine(
    (value) =>
      (Boolean(value.token) && !value.pin && !value.orderNumber) ||
      (!value.token && Boolean(value.pin) && Boolean(value.orderNumber)),
    {
      message: 'send token, or orderNumber together with pin',
    },
  );

const giftCardCodeSchema = z
  .string()
  .trim()
  .min(8)
  .max(80)
  .regex(/^[A-Za-z0-9_-]+$/);
const giftCardValidateBodySchema = z
  .object({
    code: giftCardCodeSchema,
    branchId: uuidSchema,
  })
  .strict();
const giftCardReserveBodySchema = giftCardValidateBodySchema
  .extend({
    iikoOrderId: orderIdSchema,
    idempotencyKey: uuidSchema,
    amount: z.coerce.number().finite().positive().max(1_000_000),
    ttlMinutes: z.coerce.number().int().min(5).max(120).optional().default(20),
  })
  .strict();
const giftCardReservationMutationBodySchema = z
  .object({
    reservationId: uuidSchema,
    idempotencyKey: uuidSchema,
  })
  .strict();

module.exports = {
  giftCardReservationMutationBodySchema,
  giftCardReserveBodySchema,
  giftCardValidateBodySchema,
  loyaltyApplyBodySchema,
  loyaltyCalculateBodySchema,
  loyaltyCancelBodySchema,
  loyaltyCommitBodySchema,
  loyaltyCustomerBodySchema,
  loyaltyReserveBodySchema,
  loyaltySearchBodySchema,
  pickupHandoffPluginBodySchema,
};

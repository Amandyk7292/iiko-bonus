const { z } = require('../middlewares/validation.middleware');
const { iikoGuidSchema } = require('./iiko-guid.schema');

const decimal = (scale, maximum, positive = false) =>
  z
    .number()
    .finite()
    .min(positive ? 10 ** -scale : 0)
    .max(maximum)
    .refine((value) => Math.abs(value * 10 ** scale - Math.round(value * 10 ** scale)) < 0.000001);
const money = decimal(2, 100000000);
const quantity = decimal(3, 9999, true);
const saleSchema = z
  .object({
    requestId: z.uuid().toLowerCase(),
    terminalId: iikoGuidSchema,
    snapshotRevision: z.string().min(1).max(128),
    cashShiftId: iikoGuidSchema,
    paymentTypeId: iikoGuidSchema,
    items: z
      .array(z.object({ productId: iikoGuidSchema, quantity }).strict())
      .min(1)
      .max(100),
    expectedTotal: money,
  })
  .strict();
const saleParamsSchema = z.object({ id: z.uuid().toLowerCase() }).strict();
const emptyQuerySchema = z.object({}).strict();
const pollQuerySchema = z.object({ terminalId: iikoGuidSchema }).strict();
const snapshotSchema = z
  .object({
    terminalId: iikoGuidSchema,
    terminalName: z.string().trim().max(100).optional(),
    revision: z.string().min(1).max(128),
    capturedAt: z.iso.datetime().optional(),
    cashShift: z
      .object({
        id: iikoGuidSchema.nullable(),
        isOpen: z.boolean(),
        number: z.union([z.string().max(50), z.number().int()]).optional(),
      })
      .strict(),
    products: z
      .array(
        z
          .object({
            id: iikoGuidSchema,
            name: z.string().trim().min(1).max(250),
            price: decimal(2, 1000000),
            unit: z.string().max(50),
            quantityStep: quantity,
            paymentTypeIds: z.array(iikoGuidSchema).max(64),
            available: z.boolean(),
            unavailableReason: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .max(2000),
    paymentTypes: z
      .array(
        z
          .object({
            id: iikoGuidSchema,
            name: z.string().trim().min(1).max(250),
            kind: z.string().max(80),
            isFiscal: z.boolean(),
            selectable: z.boolean(),
            reason: z.string().max(500).nullable().optional(),
          })
          .strict(),
      )
      .max(64),
    profile: z
      .object({
        nonFiscalNoPaperVerified: z.boolean(),
        reason: z.string().max(500).nullable().optional(),
      })
      .strict(),
  })
  .strict();
const actionSchema = z
  .object({
    terminalId: iikoGuidSchema,
    saleId: z.uuid().toLowerCase(),
    leaseToken: z.uuid().toLowerCase(),
    action: z.enum([
      'creating',
      'created',
      'payment_started',
      'completed',
      'rejected',
      'needs_reconciliation',
    ]),
    frontOrderId: iikoGuidSchema.optional(),
    frontOrderNumber: z.union([z.string().max(50), z.number().int()]).optional(),
    error: z.string().max(1000).optional(),
  })
  .strict();
const terminalConfigSchema = z
  .object({ terminalId: iikoGuidSchema, enabled: z.boolean() })
  .strict();

module.exports = {
  saleSchema,
  saleParamsSchema,
  emptyQuerySchema,
  pollQuerySchema,
  snapshotSchema,
  actionSchema,
  terminalConfigSchema,
};

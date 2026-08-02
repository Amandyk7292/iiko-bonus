const { z } = require('../middlewares/validation.middleware');

const uuidSchema = z.string().trim().uuid();
const orderSubstitutionParamsSchema = z
  .object({
    id: uuidSchema,
  })
  .strict();
const orderSubstitutionRequestParamsSchema = z
  .object({
    id: uuidSchema,
    requestId: uuidSchema,
  })
  .strict();

const orderSubstitutionCreateBodySchema = z
  .object({
    lineKey: z.string().trim().min(1).max(220),
    quantity: z.coerce.number().int().min(1).max(99),
    action: z.enum(['remove_refund', 'call_customer', 'replace_with_approval']),
    replacementProductId: z.string().trim().min(1).max(100).optional(),
    note: z.string().trim().max(500).optional().default(''),
  })
  .strict()
  .refine((value) => value.action !== 'replace_with_approval' || value.replacementProductId, {
    path: ['replacementProductId'],
    message: 'Выберите товар для замены',
  });

const orderSubstitutionResponseBodySchema = z
  .object({
    approved: z.boolean(),
  })
  .strict();

module.exports = {
  orderSubstitutionCreateBodySchema,
  orderSubstitutionParamsSchema,
  orderSubstitutionRequestParamsSchema,
  orderSubstitutionResponseBodySchema,
};

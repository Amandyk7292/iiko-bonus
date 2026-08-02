const { z } = require('../middlewares/validation.middleware');

const customerIdSchema = z.string().trim().uuid();
const branchIdSchema = z.string().trim().uuid();
const phoneSchema = z
  .string()
  .trim()
  .regex(/^\+?[0-9]{10,15}$/, 'Телефон должен содержать от 10 до 15 цифр');

const adminCustomerListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(1_000_000).default(1),
    pageSize: z.coerce.number().int().min(10).max(100).default(50),
    search: z.string().trim().max(100).default(''),
    scopeBranchId: branchIdSchema.optional(),
  })
  .strict();

const adminCustomerBonusBodySchema = z
  .object({
    customerId: customerIdSchema,
    amount: z.coerce.number().finite().min(-1_000_000).max(1_000_000),
    reason: z.string().trim().min(5).max(240),
    branchId: branchIdSchema.optional(),
  })
  .strict();

const adminCustomerUpdateBodySchema = z
  .object({
    customerId: customerIdSchema,
    name: z.string().trim().max(160).optional(),
    phone: phoneSchema.optional(),
  })
  .strict()
  .refine((value) => value.name !== undefined || value.phone !== undefined, {
    message: 'Укажите имя или телефон для обновления',
  });

const adminCustomerParamsSchema = z
  .object({
    id: customerIdSchema,
  })
  .strict();

const adminCustomerBulkBodySchema = z
  .object({
    days: z.coerce.number().int().min(1).max(365).optional(),
  })
  .strict()
  .default({});

module.exports = {
  adminCustomerBonusBodySchema,
  adminCustomerBulkBodySchema,
  adminCustomerListQuerySchema,
  adminCustomerParamsSchema,
  adminCustomerUpdateBodySchema,
};

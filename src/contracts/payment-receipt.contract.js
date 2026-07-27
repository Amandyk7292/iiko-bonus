const { z } = require('../middlewares/validation.middleware');

const paymentReceiptParamsSchema = z
  .object({
    receiptId: z.string().trim().uuid(),
  })
  .strict();

const paymentReceiptQuerySchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{43}$/),
    expires: z.coerce.number().int().positive(),
    lang: z.enum(['ru', 'kk', 'en']).optional(),
  })
  .strict();

module.exports = {
  paymentReceiptParamsSchema,
  paymentReceiptQuerySchema,
};

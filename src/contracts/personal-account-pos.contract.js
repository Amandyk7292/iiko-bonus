const { z } = require('../middlewares/validation.middleware');
const base = {
  branchId: z.string().uuid(),
  orderId: z.string().uuid(),
  amount: z
    .number()
    .positive()
    .max(10000000)
    .refine((v) => Math.abs(v * 100 - Math.round(v * 100)) < 0.000001),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
};
const startSchema = z
  .object({
    ...base,
    requestId: z.string().uuid(),
    customerCode: z
      .string()
      .min(15)
      .max(200)
      .regex(/^(BULKA-OTP-|CARD-)/),
  })
  .strict();
const actionSchema = z
  .object({
    ...base,
    id: z.string().uuid(),
    action: z.enum(['confirm', 'pay', 'status', 'cancel', 'refund']),
    code: z
      .string()
      .regex(/^\d{6}$/)
      .optional(),
    transactionId: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'confirm' && !value.code)
      ctx.addIssue({ code: 'custom', message: 'Code required', path: ['code'] });
    if (value.action === 'pay' && !value.transactionId)
      ctx.addIssue({ code: 'custom', message: 'Transaction required', path: ['transactionId'] });
  });
module.exports = { startSchema, actionSchema };

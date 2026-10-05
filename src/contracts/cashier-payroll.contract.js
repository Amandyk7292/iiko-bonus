const { z } = require('../middlewares/validation.middleware');

const payrollMonthSchema = z.string().regex(/^(?!0000)\d{4}-(0[1-9]|1[0-2])$/);
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/);
const payrollReportQuerySchema = z.object({ month: payrollMonthSchema }).strict();
const payrollPaymentBodySchema = z
  .object({
    month: payrollMonthSchema,
    rowKey: digestSchema,
    snapshot: digestSchema,
    idempotencyKey: z.string().uuid(),
  })
  .strict();

module.exports = { payrollMonthSchema, payrollReportQuerySchema, payrollPaymentBodySchema };

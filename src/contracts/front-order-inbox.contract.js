const { z } = require('../middlewares/validation.middleware');
const frontOrdersQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10000).default(1),
    peek: z.enum(['true', 'false']).optional(),
  })
  .strict();
const frontOrderDecisionSchema = z
  .object({
    orderId: z.string().uuid(),
    terminalId: z.string().uuid(),
    action: z.enum(['accept', 'reject']),
  })
  .strict();
const frontOrderPollSchema = z.object({ terminalId: z.string().uuid() }).strict();
module.exports = { frontOrdersQuerySchema, frontOrderDecisionSchema, frontOrderPollSchema };

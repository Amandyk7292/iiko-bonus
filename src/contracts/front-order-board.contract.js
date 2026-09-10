const { z } = require('../middlewares/validation.middleware');
const { iikoGuidSchema } = require('./iiko-guid.schema');
const page = z.coerce.number().int().min(1).max(10000).default(1);
const frontBoardQuerySchema = z
  .object({ new: page, preparing: page, ready: page, handed_over: page })
  .strict();
const frontBoardActionSchema = z
  .object({
    orderId: z.string().uuid(),
    terminalId: iikoGuidSchema,
    action: z.enum(['accept', 'reject', 'ready', 'hand_over']),
  })
  .strict();
module.exports = { frontBoardQuerySchema, frontBoardActionSchema };

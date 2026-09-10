const { z } = require('../middlewares/validation.middleware');

const frontStockHeartbeatSchema = z
  .object({ terminalId: z.string().uuid(), connected: z.boolean() })
  .strict();
const frontStockSaleSchema = z
  .object({
    terminalId: z.string().uuid(),
    receiptId: z.string().uuid(),
    items: z
      .array(
        z
          .object({ productId: z.string().uuid(), quantity: z.number().int().positive().max(9999) })
          .strict(),
      )
      .min(1)
      .max(450),
    total: z.number().nonnegative().max(10000000).multipleOf(0.01),
    onlineNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  })
  .strict();
const frontStockFinishSchema = frontStockSaleSchema
  .omit({ onlineNumber: true })
  .extend({ state: z.enum(['closed', 'voided']) })
  .strict();

const frontStockRecountSchema = z
  .object({
    terminalId: z.string().uuid(),
    recountId: z.string().uuid(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            productName: z.string().max(160),
            quantity: z.number().int().min(0).max(100000),
          })
          .strict(),
      )
      .min(1)
      .max(450)
      .optional(),
  })
  .strict();
module.exports = {
  frontStockHeartbeatSchema,
  frontStockSaleSchema,
  frontStockFinishSchema,
  frontStockRecountSchema,
};

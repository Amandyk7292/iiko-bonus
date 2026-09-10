const { z } = require('../middlewares/validation.middleware');
const { iikoGuidSchema } = require('./iiko-guid.schema');
const { frontStockSaleSchema } = require('./front-stock-guard.contract');
const frontAutoReceiptPollSchema = z.object({ terminalId: iikoGuidSchema }).strict();
const frontAutoReceiptActionSchema = z
  .object({
    terminalId: iikoGuidSchema,
    orderId: z.string().uuid(),
    action: z.enum(['claim', 'bind', 'verify', 'complete', 'return', 'problem']),
    receiptId: iikoGuidSchema.nullable().optional(),
    items: frontStockSaleSchema.shape.items.optional(),
    total: frontStockSaleSchema.shape.total.optional(),
    error: z.string().max(400).optional(),
  })
  .strict()
  .refine(
    (v) =>
      !['verify', 'complete', 'return'].includes(v.action) ||
      (v.receiptId && v.items && v.total !== undefined),
    'Требуется полный состав чека',
  );
const frontOfflineReceiptSchema = frontStockSaleSchema
  .omit({ onlineNumber: true })
  .extend({ closedAt: z.string().datetime({ offset: true }) })
  .strict();
module.exports = {
  frontAutoReceiptPollSchema,
  frontAutoReceiptActionSchema,
  frontOfflineReceiptSchema,
};

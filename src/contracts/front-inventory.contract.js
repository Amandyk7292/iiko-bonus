const { z } = require('../middlewares/validation.middleware');

const frontInventorySnapshotSchema = z
  .object({
    terminalId: z.string().uuid(),
    terminalGroupId: z.string().uuid(),
    sessionId: z.string().uuid(),
    sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    capturedAt: z.iso.datetime(),
    items: z
      .array(
        z
          .object({
            productId: z.string().uuid(),
            productName: z.string().trim().min(1).max(160),
            quantity: z.number().int().min(0).max(100000),
          })
          .strict(),
      )
      .max(450),
  })
  .strict()
  .refine(
    (value) => new Set(value.items.map((item) => item.productId)).size === value.items.length,
    'Повторяющийся товар',
  );

module.exports = { frontInventorySnapshotSchema };

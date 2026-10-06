const { z } = require('../middlewares/validation.middleware');
const uuid = z.string().uuid();
const pickupPhotoParamsSchema = z.object({ id: uuid }).strict();
const pickupPhotoCapabilitySchema = z.object({ branchId: uuid }).strict();
const pickupPhotoPollSchema = z
  .object({ terminalId: uuid, photoGiftVersion: z.literal(1) })
  .strict();
const pickupPhotoActionSchema = z
  .object({
    terminalId: uuid,
    orderId: uuid,
    action: z.enum(['claim', 'complete', 'uncertain', 'release']),
    error: z.string().trim().max(400).optional(),
  })
  .strict();
const pickupPhotoPrintParamsSchema = z.object({ orderId: uuid }).strict();
const pickupPhotoPrintQuerySchema = z
  .object({
    terminalId: uuid,
    widthDots: z.coerce
      .number()
      .pipe(z.union([z.literal(384), z.literal(576)]))
      .optional()
      .default(384),
  })
  .strict();
module.exports = {
  pickupPhotoParamsSchema,
  pickupPhotoCapabilitySchema,
  pickupPhotoPollSchema,
  pickupPhotoActionSchema,
  pickupPhotoPrintParamsSchema,
  pickupPhotoPrintQuerySchema,
};

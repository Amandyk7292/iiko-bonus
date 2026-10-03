const { z } = require('../middlewares/validation.middleware');
const deliveryResolutionParamsSchema = z.object({ id: z.string().uuid() }).strict();
const deliveryResolutionChoiceSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('cancel') }).strict(),
  z
    .object({ action: z.literal('pickup'), pickupTime: z.string().datetime({ offset: true }) })
    .strict(),
]);
const deliveryResolutionReviewSchema = z
  .object({
    action: z.enum(['accept', 'reject']),
    resolutionId: z.string().uuid(),
  })
  .strict();
module.exports = {
  deliveryResolutionParamsSchema,
  deliveryResolutionChoiceSchema,
  deliveryResolutionReviewSchema,
};

const { z } = require('zod');
const { iikoGuidSchema } = require('./iiko-guid.schema');
const productionBindingParams = z.object({ id: z.uuid() }).strict();
const productionBindingQuery = z
  .object({
    serverId: z
      .string()
      .regex(/^[a-z0-9-]{1,100}$/)
      .optional(),
  })
  .strict();
const productionBindingBody = z
  .object({
    serverId: z.string().regex(/^[a-z0-9-]{1,100}$/),
    departmentId: iikoGuidSchema,
    sourceStoreId: iikoGuidSchema,
    targetStoreId: iikoGuidSchema,
    enabled: z.boolean(),
    postImmediately: z.boolean().default(false),
  })
  .strict();
const productionActParams = z.object({ id: z.uuid(), actId: z.uuid() }).strict();
const productionActResolution = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('created'),
      confirmed: z.literal(true),
      documentNumber: z
        .string()
        .trim()
        .min(1)
        .max(100)
        .regex(/^[^\p{Cc}]+$/u),
    })
    .strict(),
  z.object({ action: z.literal('not_created'), confirmed: z.literal(true) }).strict(),
]);
module.exports = {
  productionBindingParams,
  productionBindingQuery,
  productionBindingBody,
  productionActParams,
  productionActResolution,
};

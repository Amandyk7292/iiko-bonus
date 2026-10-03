const { z } = require('../middlewares/validation.middleware');
const cashierInviteTokenSchema = z.string().regex(/^[a-f0-9]{64}$/);
const cashierInviteParamsSchema = z.object({ token: cashierInviteTokenSchema }).strict();
const cashierDirectoryQuerySchema = z
  .object({
    city: z.string().trim().max(120).optional(),
    search: z.string().trim().max(100).optional(),
  })
  .strict();
module.exports = {
  cashierInviteTokenSchema,
  cashierInviteParamsSchema,
  cashierDirectoryQuerySchema,
};

const { z } = require('../middlewares/validation.middleware');

const paymentWidgetModeBodySchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict();

const paymentProbeBodySchema = z.object({}).strict().default({});

module.exports = {
  paymentProbeBodySchema,
  paymentWidgetModeBodySchema,
};

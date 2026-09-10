const { z } = require('../middlewares/validation.middleware');
const { iikoGuidSchema } = require('./iiko-guid.schema');

const pairingCodeSchema = z.object({}).strict();
const activatePosSchema = z
  .object({
    code: z.string().regex(/^[1-9][0-9]{5}$/),
    terminalId: iikoGuidSchema,
    terminalGroupId: iikoGuidSchema,
    terminalName: z.string().trim().min(1).max(100),
    terminalToken: z.string().regex(/^pt1_[a-f0-9]{64}$/),
    expectedBranchId: z.string().uuid().nullable().optional(),
  })
  .strict();

module.exports = { pairingCodeSchema, activatePosSchema };

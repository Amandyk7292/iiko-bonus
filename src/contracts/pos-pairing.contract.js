const { z } = require('../middlewares/validation.middleware');

const pairingCodeSchema = z.object({}).strict();
const activatePosSchema = z
  .object({
    code: z.string().regex(/^[1-9][0-9]{5}$/),
    terminalId: z.string().uuid(),
    terminalGroupId: z.string().uuid(),
    terminalName: z.string().trim().min(1).max(100),
    terminalToken: z.string().regex(/^pt1_[a-f0-9]{64}$/),
    expectedBranchId: z.string().uuid().nullable().optional(),
  })
  .strict();

module.exports = { pairingCodeSchema, activatePosSchema };

const { z } = require('../middlewares/validation.middleware');

const appleWalletRegistrationParamsSchema = z
  .object({
    deviceLibraryIdentifier: z.string().trim().min(1).max(255),
    passTypeIdentifier: z.string().trim().min(1).max(255),
    serialNumber: z.string().trim().min(1).max(255),
  })
  .strict();

const appleWalletRegistrationBodySchema = z
  .object({
    pushToken: z.string().trim().min(16).max(4096),
  })
  .strict();

const appleWalletLogBodySchema = z
  .object({
    logs: z.array(z.string().trim().min(1).max(1000)).max(10),
  })
  .strict();

module.exports = {
  appleWalletLogBodySchema,
  appleWalletRegistrationBodySchema,
  appleWalletRegistrationParamsSchema,
};

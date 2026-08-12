const { z } = require('../middlewares/validation.middleware');

const installationIdSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9._:-]{8,160}$/);
const platformSchema = z.enum(['ios', 'android']);

const staffPushDeviceBodySchema = z
  .object({
    fcmToken: z.string().trim().min(20).max(4096),
    installationId: installationIdSchema,
    platform: platformSchema,
  })
  .strict();

const staffPushDeviceIdentitySchema = z
  .object({
    installationId: installationIdSchema,
    platform: platformSchema,
  })
  .strict();

module.exports = {
  staffPushDeviceBodySchema,
  staffPushDeviceIdentitySchema,
};

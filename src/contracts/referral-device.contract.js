const { z } = require('../middlewares/validation.middleware');

const installationIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{8,160}$/);
const stableReferralDeviceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('android_id'), id: z.string().regex(/^[a-f0-9]{16}$/i) }).strict(),
  z.object({ kind: z.literal('ios_keychain'), id: z.string().regex(/^[a-f0-9]{64}$/i) }).strict(),
]);
const referralDeviceBodySchema = z
  .object({
    installationId: installationIdSchema.optional(),
    referralDevice: stableReferralDeviceSchema.optional(),
    proof: z
      .object({
        challenge: z.string().min(32).max(2000),
        token: z.string().min(16).max(20000),
      })
      .strict()
      .optional(),
  })
  .strict();

const referralDeviceChallengeSchema = referralDeviceBodySchema
  .pick({
    installationId: true,
    referralDevice: true,
  })
  .required({ referralDevice: true });

module.exports = {
  installationIdSchema,
  stableReferralDeviceSchema,
  referralDeviceBodySchema,
  referralDeviceChallengeSchema,
};

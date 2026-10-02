const { z } = require('../middlewares/validation.middleware');
const deviceId = z.string().regex(/^[a-f0-9]{64}$/);
const keyId = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const challenge = z.string().min(32).max(2500);
const proof = z
  .string()
  .min(16)
  .max(20000)
  .regex(/^[A-Za-z0-9+/]+={0,2}$/);
const walkingChallengeSchema = z
  .object({
    deviceId,
    keyId,
    purpose: z.enum(['register', 'steps']),
    dayOffset: z.number().int().min(0).max(6).default(0),
  })
  .strict();
const walkingRegistrationSchema = z
  .object({ deviceId, keyId, challenge, attestation: proof })
  .strict();
const walkingSyncSchema = z
  .object({
    deviceId,
    keyId,
    challenge,
    payload: z.string().min(16).max(4000),
    assertion: proof,
  })
  .strict();
const walkingPayloadSchema = z
  .object({
    challenge,
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    source: z.literal('ios_core_motion'),
    steps: z.number().int().min(0).max(150000),
    startAt: z.iso.datetime(),
    endAt: z.iso.datetime(),
  })
  .strict();
module.exports = {
  walkingChallengeSchema,
  walkingRegistrationSchema,
  walkingSyncSchema,
  walkingPayloadSchema,
};

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
    platform: z.enum(['ios', 'android']).default('ios'),
    purpose: z.enum(['register', 'steps']),
    dayOffset: z.number().int().min(0).max(6).default(0),
    dayOffsets: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  })
  .strict()
  .superRefine((body, ctx) => {
    if (
      body.dayOffsets &&
      (body.platform !== 'android' ||
        body.purpose !== 'steps' ||
        new Set(body.dayOffsets).size !== body.dayOffsets.length)
    )
      ctx.addIssue({ code: 'custom', message: 'Invalid walking periods', path: ['dayOffsets'] });
    if (body.platform === 'android' && body.dayOffset !== 0)
      ctx.addIssue({ code: 'custom', message: 'Use Android batch periods', path: ['dayOffset'] });
  });
// Integrity tokens are opaque and can contain URL-safe/JWE characters. Apple's
// CBOR proofs remain strictly base64, preserving the existing iOS contract.
const integrityProof = z
  .string()
  .min(16)
  .max(20000)
  .regex(/^[A-Za-z0-9_+/=.-]+$/);
const platformProofSchema = (ios, android) =>
  z.preprocess(
    (body) =>
      body && typeof body === 'object' && !Array.isArray(body) && !('platform' in body)
        ? { ...body, platform: 'ios' }
        : body,
    z.discriminatedUnion('platform', [ios, android]),
  );
const walkingRegistrationSchema = z
  .object({ deviceId, keyId, platform: z.literal('ios'), challenge, attestation: proof })
  .strict();
const walkingAndroidRegistrationSchema = z
  .object({
    deviceId,
    keyId,
    platform: z.literal('android'),
    challenge,
    attestation: integrityProof,
  })
  .strict();
const walkingSyncSchema = platformProofSchema(
  z
    .object({
      deviceId,
      keyId,
      platform: z.literal('ios'),
      challenge,
      payload: z.string().min(16).max(4000),
      assertion: proof,
    })
    .strict(),
  z
    .object({
      deviceId,
      keyId,
      platform: z.literal('android'),
      challenge,
      payload: z.string().min(16).max(8000),
      assertion: integrityProof,
    })
    .strict(),
);
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
const walkingAndroidPayloadSchema = z
  .object({
    challenge,
    source: z.literal('android_local_recording'),
    measurements: z
      .array(
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            steps: z.number().int().min(0).max(150000),
            startAt: z.iso.datetime(),
            endAt: z.iso.datetime(),
          })
          .strict(),
      )
      .min(1)
      .max(7),
  })
  .strict();
module.exports = {
  walkingChallengeSchema,
  walkingRegistrationSchema: platformProofSchema(
    walkingRegistrationSchema,
    walkingAndroidRegistrationSchema,
  ),
  walkingSyncSchema,
  walkingPayloadSchema,
  walkingAndroidPayloadSchema,
};

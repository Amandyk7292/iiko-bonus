const { z } = require('../middlewares/validation.middleware');

const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(24)
  .regex(/^[+()\s0-9-]+$/);
const requestTokenSchema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9]{12,64}$/);
const passwordSchema = z
  .string()
  .min(1)
  .refine((value) => Buffer.byteLength(value, 'utf8') <= 72, 'Password is too long');
const newPasswordSchema = passwordSchema
  .min(8)
  .refine((value) => /\p{L}/u.test(value) && /\p{N}/u.test(value), {
    message: 'Password must contain a letter and a digit',
  });
const refreshTokenSchema = z.string().trim().min(40).max(256);
const fcmTokenSchema = z.string().trim().min(20).max(4096);
const installationIdSchema = z
  .string()
  .trim()
  .min(8)
  .max(160)
  .regex(/^[A-Za-z0-9._:-]+$/);

const customerLoginBodySchema = z.object({ phone: phoneSchema, password: passwordSchema }).strict();
const customerRegistrationStartBodySchema = z
  .object({
    phone: phoneSchema,
    password: newPasswordSchema,
    token: requestTokenSchema,
  })
  .strict();
const customerPasswordResetStartBodySchema = z
  .object({ phone: phoneSchema, token: requestTokenSchema })
  .strict();
const customerPasswordResetCompleteBodySchema = z
  .object({
    phone: phoneSchema,
    code: z
      .string()
      .trim()
      .regex(/^\d{4}$/),
    password: newPasswordSchema,
  })
  .strict();
const customerOtpRequestBodySchema = z
  .object({ phone: phoneSchema, token: requestTokenSchema })
  .strict();
const customerOtpVerifyBodySchema = z
  .object({
    phone: phoneSchema,
    code: z
      .string()
      .trim()
      .regex(/^\d{4}$/),
  })
  .strict();
const customerSessionBodySchema = z
  .object({ refreshToken: refreshTokenSchema.optional() })
  .strict()
  .default({});

const customerFcmTokenBodySchema = z
  .object({
    fcmToken: fcmTokenSchema,
    language: z.enum(['ru', 'kk', 'kz', 'en']).optional(),
    platform: z.enum(['android', 'ios', 'web', 'unknown']).optional(),
    installationId: installationIdSchema.optional(),
  })
  .strict();
const customerFcmTokenDeleteBodySchema = z
  .object({
    fcmToken: fcmTokenSchema.optional(),
    installationId: installationIdSchema.optional(),
  })
  .strict()
  .default({});
const notificationParamsSchema = z.object({ id: z.string().trim().uuid() }).strict();
const guestProfileBodySchema = z
  .object({
    phone: phoneSchema.optional(),
    fcmToken: fcmTokenSchema.optional(),
  })
  .strict()
  .default({});

module.exports = {
  customerFcmTokenBodySchema,
  customerFcmTokenDeleteBodySchema,
  customerLoginBodySchema,
  customerOtpRequestBodySchema,
  customerOtpVerifyBodySchema,
  customerPasswordResetCompleteBodySchema,
  customerPasswordResetStartBodySchema,
  customerRegistrationStartBodySchema,
  customerSessionBodySchema,
  guestProfileBodySchema,
  notificationParamsSchema,
};

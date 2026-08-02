const { z } = require('../middlewares/validation.middleware');

const phoneSchema = z
  .string()
  .trim()
  .min(10)
  .max(24)
  .regex(/^[+()\s0-9-]+$/, 'Некорректный номер телефона');

const adminLoginBodySchema = z
  .object({
    username: z.string().trim().toLowerCase().min(1).max(160).default('admin'),
    password: z.string().min(1).max(512),
    code: z.preprocess(
      (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
      z
        .string()
        .trim()
        .regex(/^\d{6}$/)
        .optional(),
    ),
  })
  .strict();

const adminPhoneRequestBodySchema = z.object({ phone: phoneSchema }).strict();

const adminPhoneVerifyBodySchema = z
  .object({
    phone: phoneSchema,
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/, 'Введите шестизначный код'),
  })
  .strict();

const whatsappOperatorAccessBodySchema = z
  .object({
    token: z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9_-]{43,128}$/),
  })
  .strict();

module.exports = {
  adminLoginBodySchema,
  adminPhoneRequestBodySchema,
  adminPhoneVerifyBodySchema,
  whatsappOperatorAccessBodySchema,
};

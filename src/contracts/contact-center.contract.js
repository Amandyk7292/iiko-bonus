const { z } = require('../middlewares/validation.middleware');

const uuidSchema = z.string().trim().uuid();
const localizedTextSchema = (maxLength) =>
  z
    .object({
      ru: z.string().trim().min(1).max(maxLength),
      kk: z.string().trim().min(1).max(maxLength),
      en: z.string().trim().min(1).max(maxLength),
    })
    .strict();

const contactDisplayModeSchema = z.enum(['standard', 'compact']);
const contactActionTypeSchema = z.enum([
  'phone',
  'whatsapp',
  'telegram',
  'instagram',
  'vk',
  'email',
  'website',
  'online_chat',
  'custom_url',
]);
const contactIconKeySchema = z.enum([
  'bulka',
  'phone',
  'whatsapp',
  'telegram',
  'instagram',
  'vk',
  'email',
  'website',
  'chat',
  'link',
]);
const sortOrderSchema = z.coerce.number().int().min(0).max(2_147_483_647);
const targetSchema = z.string().trim().min(1).max(500);

const contactCardFields = {
  displayMode: contactDisplayModeSchema,
  titles: localizedTextSchema(120),
  iconKey: contactIconKeySchema,
  sortOrder: sortOrderSchema,
  isActive: z.boolean(),
};

const contactCardCreateBodySchema = z
  .object({
    displayMode: contactDisplayModeSchema.default('standard'),
    titles: contactCardFields.titles,
    iconKey: contactIconKeySchema.default('bulka'),
    sortOrder: sortOrderSchema.default(0),
    isActive: z.boolean().default(false),
  })
  .strict();

const contactCardUpdateBodySchema = z
  .object({
    displayMode: contactCardFields.displayMode.optional(),
    titles: contactCardFields.titles.optional(),
    iconKey: contactCardFields.iconKey.optional(),
    sortOrder: contactCardFields.sortOrder.optional(),
    isActive: contactCardFields.isActive.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Укажите хотя бы одно поле для обновления',
  });

const validateActionTarget = (value, context) => {
  if (value.target === undefined || value.type === undefined) return;
  const target = value.target;

  if (value.type === 'phone') {
    const digits = target.replace(/\D/g, '');
    if (!/^[+()\s0-9-]+$/.test(target) || digits.length < 10 || digits.length > 15) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Некорректный номер телефона',
      });
    }
    return;
  }

  if (value.type === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target) || target.length > 254) {
      context.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Некорректный адрес электронной почты',
      });
    }
    return;
  }

  try {
    const url = new URL(target);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('unsafe');
  } catch {
    context.addIssue({
      code: 'custom',
      path: ['target'],
      message: 'Укажите безопасную HTTPS-ссылку',
    });
  }
};

const contactActionFields = {
  type: contactActionTypeSchema,
  labels: localizedTextSchema(80),
  target: targetSchema,
  iconKey: contactIconKeySchema,
  sortOrder: sortOrderSchema,
  isActive: z.boolean(),
};

const contactActionCreateBodySchema = z
  .object({
    type: contactActionFields.type,
    labels: contactActionFields.labels,
    target: contactActionFields.target,
    iconKey: contactActionFields.iconKey.optional(),
    sortOrder: contactActionFields.sortOrder.default(0),
    isActive: contactActionFields.isActive.default(true),
  })
  .strict()
  .superRefine(validateActionTarget);

const contactActionUpdateBodySchema = z
  .object({
    type: contactActionFields.type.optional(),
    labels: contactActionFields.labels.optional(),
    target: contactActionFields.target.optional(),
    iconKey: contactActionFields.iconKey.optional(),
    sortOrder: contactActionFields.sortOrder.optional(),
    isActive: contactActionFields.isActive.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: 'Укажите хотя бы одно поле для обновления',
  })
  .superRefine(validateActionTarget);

const contactReorderBodySchema = z
  .object({
    ids: z
      .array(uuidSchema)
      .max(500)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: 'Идентификаторы не должны повторяться',
      }),
  })
  .strict();

const contactCardParamsSchema = z.object({ id: uuidSchema }).strict();
const contactCardActionParamsSchema = z.object({ cardId: uuidSchema }).strict();
const contactActionParamsSchema = z.object({ id: uuidSchema }).strict();

module.exports = {
  contactActionCreateBodySchema,
  contactActionParamsSchema,
  contactActionUpdateBodySchema,
  contactCardActionParamsSchema,
  contactCardCreateBodySchema,
  contactCardParamsSchema,
  contactCardUpdateBodySchema,
  contactReorderBodySchema,
};

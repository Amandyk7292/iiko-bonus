const { z } = require('../middlewares/validation.middleware');

const localeSchema = z.enum(['kk', 'ru']);
const taplinkBlockIdSchema = z
  .string()
  .trim()
  .regex(
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    'Некорректный идентификатор блока',
  );
const plainTextSchema = (maximum, minimum = 1) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[<>]/u.test(value), 'HTML-разметка не поддерживается');
const localizedTextSchema = (maximum, minimum = 1) =>
  z
    .object({
      kk: plainTextSchema(maximum, minimum),
      ru: plainTextSchema(maximum, minimum),
    })
    .strict();

const hasControlCharacters = (value) =>
  [...String(value || '')].some((character) => {
    const code = character.codePointAt(0);
    return code < 32 || code === 127;
  });

const isSafeHttpsUrl = (value) => {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' && !url.username && !url.password && !hasControlCharacters(value)
    );
  } catch {
    return false;
  }
};

const isSafeAssetUrl = (value) => {
  const text = String(value || '');
  if (!text || text.length > 2_000 || hasControlCharacters(text)) return false;
  if (/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/?#-]+$/u.test(text)) return true;
  return isSafeHttpsUrl(text);
};

const safeAssetUrlSchema = z
  .string()
  .trim()
  .max(2_000)
  .refine(isSafeAssetUrl, 'Укажите безопасный HTTPS или локальный URL изображения');

const whatsappTargetSchema = z
  .object({
    type: z.literal('whatsapp'),
    value: z
      .string()
      .trim()
      .min(10)
      .max(24)
      .refine((value) => {
        const digits = value.replace(/\D/g, '');
        return /^[+()\s0-9-]+$/.test(value) && digits.length >= 10 && digits.length <= 15;
      }, 'Укажите корректный номер WhatsApp')
      .transform((value) => value.replace(/\D/g, '')),
  })
  .strict();

const phoneTargetSchema = z
  .object({
    type: z.literal('phone'),
    value: z
      .string()
      .trim()
      .min(10)
      .max(24)
      .refine((value) => {
        const digits = value.replace(/\D/g, '');
        return /^[+()\s0-9-]+$/.test(value) && digits.length >= 10 && digits.length <= 15;
      }, 'Укажите корректный номер телефона'),
  })
  .strict();

const emailTargetSchema = z
  .object({
    type: z.literal('email'),
    value: z.email().max(254),
  })
  .strict();

const urlTargetSchema = z
  .object({
    type: z.literal('url'),
    value: z
      .string()
      .trim()
      .max(2_000)
      .refine(isSafeHttpsUrl, 'Разрешены только безопасные HTTPS-ссылки'),
  })
  .strict();

const taplinkTargetSchema = z.discriminatedUnion('type', [
  whatsappTargetSchema,
  phoneTargetSchema,
  emailTargetSchema,
  urlTargetSchema,
]);

const blockBase = {
  id: taplinkBlockIdSchema,
  enabled: z.boolean().default(true),
};

const taplinkSectionBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('section'),
    labels: localizedTextSchema(120),
  })
  .strict();

const taplinkLinkBlockSchema = z
  .object({
    ...blockBase,
    type: z.literal('link'),
    style: z.enum(['primary', 'standard', 'city']).default('standard'),
    labels: localizedTextSchema(120),
    subtitles: localizedTextSchema(180, 0).optional(),
    ariaLabels: localizedTextSchema(240, 0).optional(),
    icon: z
      .enum(['phone', 'whatsapp', '2gis', 'instagram', 'telegram', 'globe', 'location', 'none'])
      .default('none'),
    target: taplinkTargetSchema,
  })
  .strict();

const taplinkBlockSchema = z.discriminatedUnion('type', [
  taplinkSectionBlockSchema,
  taplinkLinkBlockSchema,
]);

const taplinkDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    defaultLocale: localeSchema,
    enabledLocales: z
      .array(localeSchema)
      .min(1)
      .max(2)
      .refine((locales) => new Set(locales).size === locales.length, 'Языки не должны повторяться'),
    profile: z
      .object({
        logoUrl: safeAssetUrlSchema.optional(),
        title: localizedTextSchema(120),
        description: localizedTextSchema(500),
        footer: localizedTextSchema(160),
      })
      .strict(),
    seo: z
      .object({
        title: localizedTextSchema(160),
        description: localizedTextSchema(500),
        ogImageUrl: safeAssetUrlSchema.optional(),
      })
      .strict(),
    theme: z
      .object({
        preset: z.literal('bulka'),
        backgroundImageUrl: safeAssetUrlSchema.optional(),
        buttonStyle: z.enum(['soft', 'outlined', 'solid']).default('soft'),
        radius: z.number().int().min(12).max(32).default(22),
      })
      .strict(),
    blocks: z.array(taplinkBlockSchema).max(40),
  })
  .strict()
  .superRefine((document, context) => {
    if (!document.enabledLocales.includes(document.defaultLocale)) {
      context.addIssue({
        code: 'custom',
        path: ['defaultLocale'],
        message: 'Основной язык должен быть включён',
      });
    }
    const ids = new Set();
    document.blocks.forEach((block, index) => {
      if (ids.has(block.id)) {
        context.addIssue({
          code: 'custom',
          path: ['blocks', index, 'id'],
          message: 'Идентификаторы блоков не должны повторяться',
        });
      }
      ids.add(block.id);
    });
    if (Buffer.byteLength(JSON.stringify(document), 'utf8') > 256 * 1024) {
      context.addIssue({
        code: 'custom',
        path: [],
        message: 'Конфигурация Taplink слишком большая',
      });
    }
  });

const taplinkDraftBodySchema = z
  .object({
    config: taplinkDocumentSchema,
    expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

const taplinkPublishBodySchema = z
  .object({
    expectedRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

module.exports = {
  isSafeAssetUrl,
  isSafeHttpsUrl,
  localizedTextSchema,
  taplinkDocumentSchema,
  taplinkDraftBodySchema,
  taplinkLinkBlockSchema,
  taplinkPublishBodySchema,
  taplinkSectionBlockSchema,
  taplinkTargetSchema,
};

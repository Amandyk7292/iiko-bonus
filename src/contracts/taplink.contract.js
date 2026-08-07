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
const hexColorSchema = z
  .string()
  .regex(/^#[0-9a-f]{6}$/i, 'Укажите цвет в формате #RRGGBB')
  .transform((value) => value.toUpperCase());

const relativeLuminance = (hexColor) => {
  const channels = [1, 3, 5].map((offset) =>
    Number.parseInt(hexColor.slice(offset, offset + 2), 16),
  );
  const [red, green, blue] = channels.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const contrastRatio = (firstColor, secondColor) => {
  const firstLuminance = relativeLuminance(firstColor);
  const secondLuminance = relativeLuminance(secondColor);
  const lighter = Math.max(firstLuminance, secondLuminance);
  const darker = Math.min(firstLuminance, secondLuminance);
  return (lighter + 0.05) / (darker + 0.05);
};

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

const taplinkLinkAppearanceSchema = z
  .object({
    buttonStyle: z.enum(['soft', 'outlined', 'solid']),
    backgroundColor: hexColorSchema,
    textColor: hexColorSchema,
    radius: z.number().int().min(12).max(32),
    buttonEffect: z.enum(['none', 'lift', 'glow', 'shine']),
  })
  .strict()
  .superRefine((appearance, context) => {
    if (contrastRatio(appearance.textColor, appearance.backgroundColor) < 4.5) {
      context.addIssue({
        code: 'custom',
        path: ['textColor'],
        message: 'Контраст текста и фона кнопки должен быть не ниже 4.5:1',
      });
    }
  });

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
    appearance: taplinkLinkAppearanceSchema.optional(),
  })
  .strict();

const taplinkBlockSchema = z.discriminatedUnion('type', [
  taplinkSectionBlockSchema,
  taplinkLinkBlockSchema,
]);

const taplinkThemeSchema = z
  .object({
    preset: z.literal('bulka'),
    backgroundImageUrl: safeAssetUrlSchema.optional(),
    buttonStyle: z.enum(['soft', 'outlined', 'solid']).default('soft'),
    radius: z.number().int().min(12).max(32).default(22),
    backgroundMode: z.enum(['brand', 'solid', 'gradient', 'image']).default('brand'),
    backgroundColor: hexColorSchema.default('#FFB814'),
    gradientFrom: hexColorSchema.default('#FFD56A'),
    gradientTo: hexColorSchema.default('#F4A916'),
    gradientDirection: z
      .enum([
        'top',
        'top-right',
        'right',
        'bottom-right',
        'bottom',
        'bottom-left',
        'left',
        'top-left',
      ])
      .default('bottom-right'),
    backgroundOverlayColor: hexColorSchema.default('#532814'),
    backgroundOverlayOpacity: z.number().int().min(0).max(70).default(0),
    textColor: hexColorSchema.default('#532814'),
    mutedTextColor: hexColorSchema.default('#78665D'),
    surfaceColor: hexColorSchema.default('#FFFFFF'),
    buttonBackgroundColor: hexColorSchema.default('#FFFFFF'),
    buttonTextColor: hexColorSchema.default('#532814'),
    primaryButtonBackgroundColor: hexColorSchema.default('#FFB814'),
    primaryButtonTextColor: hexColorSchema.default('#3F1D0E'),
    animation: z.enum(['none', 'fade', 'rise', 'stagger']).default('stagger'),
    buttonEffect: z.enum(['none', 'lift', 'glow', 'shine']).default('shine'),
  })
  .strict()
  .superRefine((theme, context) => {
    const contrastPairs = [
      {
        foreground: 'textColor',
        background: 'surfaceColor',
        message: 'Контраст текста и поверхности должен быть не ниже 4.5:1',
      },
      {
        foreground: 'mutedTextColor',
        background: 'surfaceColor',
        message: 'Контраст дополнительного текста и поверхности должен быть не ниже 4.5:1',
      },
      {
        foreground: 'buttonTextColor',
        background: 'buttonBackgroundColor',
        message: 'Контраст текста и фона кнопки должен быть не ниже 4.5:1',
      },
      {
        foreground: 'primaryButtonTextColor',
        background: 'primaryButtonBackgroundColor',
        message: 'Контраст текста и фона основной кнопки должен быть не ниже 4.5:1',
      },
    ];
    contrastPairs.forEach(({ foreground, background, message }) => {
      if (contrastRatio(theme[foreground], theme[background]) < 4.5) {
        context.addIssue({
          code: 'custom',
          path: [foreground],
          message,
        });
      }
    });
  });

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
    theme: taplinkThemeSchema,
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
  taplinkLinkAppearanceSchema,
  taplinkLinkBlockSchema,
  taplinkPublishBodySchema,
  taplinkSectionBlockSchema,
  taplinkTargetSchema,
};

const net = require('node:net');
const { emptyBodySchema, z } = require('../middlewares/validation.middleware');

const uuidSchema = z.string().trim().uuid();
const numericIdSchema = z
  .string()
  .trim()
  .regex(/^[1-9]\d{0,18}$/);
const safeResourceIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[0-9A-Za-z._:-]+$/);
const safeUsernameSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[+0-9A-Za-z@._:-]+$/);
const shortText = (maximum, minimum = 0) => z.string().trim().min(minimum).max(maximum);
const nullableText = (maximum) => z.string().trim().max(maximum).nullable();
const positiveInteger = (maximum = 2_147_483_647) => z.coerce.number().int().min(0).max(maximum);
const optionalPatch = (schema) =>
  schema.refine((value) => Object.keys(value).length > 0, {
    message: 'Укажите хотя бы одно поле для обновления',
  });
const routeParams = (shape) => z.object(shape).strict();
const withBody = (body) => ({ body });
const withParams = (params, body = emptyBodySchema) => ({ params, body });
const validDateTime = z
  .string()
  .trim()
  .max(40)
  .refine((value) => !Number.isNaN(Date.parse(value)), 'Укажите корректные дату и время');
const nullableDateTime = validDateTime.nullable();
const httpsUrl = z
  .string()
  .trim()
  .max(2_000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, 'Укажите безопасную HTTPS-ссылку');
const nullableHttpsUrl = z.union([httpsUrl, z.literal(''), z.null()]);
const localizedRequired = (maximum) =>
  z
    .object({
      ru: shortText(maximum, 1),
      kk: shortText(maximum, 1),
      en: shortText(maximum, 1),
    })
    .strict();
const localizedOptional = (maximum) =>
  z
    .object({
      ru: shortText(maximum).optional(),
      kk: shortText(maximum).optional(),
      en: shortText(maximum).optional(),
    })
    .strict();

const whatsappSettingsBodySchema = optionalPatch(
  z
    .object({
      assistantEnabled: z.boolean().optional(),
      autoReplyEnabled: z.boolean().optional(),
      memoryEnabled: z.boolean().optional(),
      provider: z.enum(['gemini', 'qwen', 'deepseek']).optional(),
      model: z
        .string()
        .trim()
        .regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,119}$/)
        .optional(),
      apiKey: z
        .string()
        .trim()
        .refine(
          (value) =>
            value === '' || (value.length >= 16 && value.length <= 512 && !/\s/.test(value)),
          'API-ключ должен содержать от 16 до 512 символов без пробелов',
        )
        .optional(),
      botName: shortText(80, 1).optional(),
      tone: z.enum(['friendly', 'warm', 'concise', 'formal']).optional(),
      supportedLanguages: z
        .array(z.enum(['ru', 'kk', 'en']))
        .min(1)
        .max(3)
        .refine((items) => new Set(items).size === items.length, {
          message: 'Языки не должны повторяться',
        })
        .optional(),
      historyMessages: z.coerce.number().int().min(0).max(30).optional(),
      businessDescription: shortText(4_000).optional(),
      customInstructions: shortText(6_000).optional(),
      welcomeMessage: shortText(500, 1).optional(),
      fallbackMessage: shortText(500, 1).optional(),
    })
    .strict(),
);
const whatsappConversationParamsSchema = routeParams({ id: uuidSchema });
const whatsappConversationUpdateBodySchema = optionalPatch(
  z
    .object({
      status: z.enum(['open', 'closed', 'spam']).optional(),
      assistantEnabled: z.boolean().optional(),
      displayName: shortText(160).optional(),
      markRead: z.boolean().optional(),
    })
    .strict(),
);
const whatsappMessageBodySchema = z
  .object({
    text: shortText(10_000, 1),
    clientMessageId: shortText(128, 1).optional(),
  })
  .strict();
const whatsappVoiceBodySchema = z
  .object({
    durationSeconds: z.coerce.number().int().min(1).max(120),
    clientMessageId: shortText(128, 1).optional(),
  })
  .strict();
const whatsappMemoryBodySchema = z
  .object({
    label: shortText(120, 1).optional(),
    content: shortText(2_000, 1),
    sourceType: z.enum(['manual', 'message', 'assistant']).optional(),
    sourceMessageId: uuidSchema.nullable().optional(),
    isActive: z.boolean().optional(),
  })
  .strict();
const whatsappMemoryParamsSchema = routeParams({
  id: uuidSchema,
  memoryId: uuidSchema,
});
const whatsappKnowledgeBodySchema = z
  .object({
    title: shortText(160, 1),
    category: shortText(60, 1).optional(),
    content: shortText(12_000, 1),
    isActive: z.boolean().optional(),
  })
  .strict();
const whatsappKnowledgeUpdateBodySchema = optionalPatch(
  z
    .object({
      title: shortText(160, 1).optional(),
      category: shortText(60, 1).optional(),
      content: shortText(12_000, 1).optional(),
      isActive: z.boolean().optional(),
    })
    .strict(),
);
const whatsappKnowledgeParamsSchema = routeParams({ id: uuidSchema });

const siteAccessBodySchema = z
  .object({
    enabled: z.boolean(),
    allowedIps: z
      .array(
        z
          .string()
          .trim()
          .max(80)
          .refine((value) => net.isIP(value) !== 0, 'Некорректный IP-адрес'),
      )
      .max(200)
      .refine((items) => new Set(items).size === items.length, {
        message: 'IP-адреса не должны повторяться',
      }),
  })
  .strict()
  .refine((value) => !value.enabled || value.allowedIps.length > 0, {
    path: ['allowedIps'],
    message: 'Добавьте хотя бы один IP-адрес',
  });

const percentSchema = z.coerce.number().min(0).max(100);
const moneySchema = z.coerce.number().min(0).max(999_999_999_999.99);
const settingsPromoSchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,32}$/),
    type: z.enum(['percent', 'fixed']),
    value: z.coerce.number().positive().max(999_999_999),
    min_order: moneySchema.optional().default(0),
  })
  .strict()
  .refine((value) => value.type !== 'percent' || value.value <= 100, {
    path: ['value'],
    message: 'Процент не может быть больше 100',
  });
const settingsBodySchema = optionalPatch(
  z
    .object({
      base_cashback_percent: percentSchema.optional(),
      tier_silver_th: moneySchema.optional(),
      tier_silver_cb: percentSchema.optional(),
      tier_gold_th: moneySchema.optional(),
      tier_gold_cb: percentSchema.optional(),
      tier_platinum_th: moneySchema.optional(),
      tier_platinum_cb: percentSchema.optional(),
      max_discount_percent: percentSchema.optional(),
      bonus_mode: z.enum(['cashback', 'discount']).optional(),
      bonus_activation: z
        .object({
          enabled: z.boolean(),
          delay_days: positiveInteger(3_650),
          first_transaction_bonus: moneySchema,
          first_transaction_notification: shortText(500),
        })
        .strict()
        .optional(),
      bonus_expiration: z
        .object({
          enabled: z.boolean(),
          expiration_days: z.coerce.number().int().min(1).max(3_650),
          notify_before_days: z.coerce.number().int().min(1).max(3_650),
          auto_write_off: z.boolean().optional(),
        })
        .strict()
        .optional(),
      bonus_birthday: z
        .object({
          enabled: z.boolean(),
          bonus_amount: moneySchema,
          expiration_days: z.coerce.number().int().min(1).max(3_650),
          message: shortText(500),
        })
        .strict()
        .optional(),
      bonus_promocodes: z
        .array(settingsPromoSchema)
        .max(100)
        .refine((items) => new Set(items.map((item) => item.code)).size === items.length, {
          message: 'Промокоды не должны повторяться',
        })
        .optional(),
      bonus_cross: z
        .object({
          enabled: z.boolean(),
          new_clients_bonus: moneySchema,
          loyal_clients_bonus: moneySchema,
          period: z.enum(['none', 'day', 'week', 'month']),
          city: shortText(160),
          min_check: moneySchema,
        })
        .strict()
        .optional(),
      bonus_referral: z
        .object({
          enabled: z.boolean(),
          inviter_bonus: moneySchema,
          friend_bonus: moneySchema,
          min_first_order: moneySchema,
        })
        .strict()
        .optional(),
      bonus_automailing: z
        .object({
          enabled: z.boolean(),
          inactive_days: z.coerce.number().int().min(1).max(3_650),
          message: shortText(1_000),
        })
        .strict()
        .optional(),
      bonus_card_media: z
        .object({
          banner_url: nullableHttpsUrl,
          logo_url: nullableHttpsUrl,
          card_title: shortText(120),
        })
        .strict()
        .optional(),
      bonus_corporate: z
        .object({
          enabled: z.boolean(),
          company_name: shortText(160),
          monthly_limit: moneySchema,
          employee_cashback_percent: percentSchema,
        })
        .strict()
        .optional(),
    })
    .strict(),
);

const tierBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_-]{1,31}$/),
    names: localizedRequired(80),
    descriptions: localizedRequired(240),
    minSpend: moneySchema,
    cashbackPercent: percentSchema,
    sortOrder: positiveInteger(1_000_000),
    isActive: z.boolean(),
  })
  .strict();
const tierParamsSchema = routeParams({ id: uuidSchema });
const tierReorderBodySchema = z
  .object({
    ids: z
      .array(uuidSchema)
      .min(1)
      .max(500)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Идентификаторы не должны повторяться',
      }),
  })
  .strict();
const tierActiveBodySchema = z.object({ isActive: z.boolean() }).strict();

const fulfillmentTypesSchema = z
  .array(z.enum(['pickup', 'delivery', 'preorder']))
  .min(1)
  .max(3)
  .refine((items) => new Set(items).size === items.length, {
    message: 'Типы заказа не должны повторяться',
  });
const storageConditionSchema = z
  .object({
    temperature: shortText(40, 1),
    duration_value: z.coerce.number().int().min(1).max(10_000).optional(),
    durationValue: z.coerce.number().int().min(1).max(10_000).optional(),
    duration_unit: z.enum(['hours', 'days', 'months']).optional(),
    durationUnit: z.enum(['hours', 'days', 'months']).optional(),
  })
  .strict()
  .refine((value) => value.duration_value !== undefined || value.durationValue !== undefined, {
    path: ['duration_value'],
    message: 'Укажите срок хранения',
  })
  .refine((value) => value.duration_unit !== undefined || value.durationUnit !== undefined, {
    path: ['duration_unit'],
    message: 'Укажите единицу срока хранения',
  });
const textListSchema = (maximumItems) =>
  z.union([z.array(shortText(80, 1)).max(maximumItems), shortText(maximumItems * 81)]);
const productFactsFields = {
  ingredients: nullableText(3_000).optional(),
  ingredients_translations: localizedOptional(3_000).nullable().optional(),
  allergens: textListSchema(30).optional(),
  dietary_tags: textListSchema(30).optional(),
  search_keywords: textListSchema(50).optional(),
  weight_grams: z.coerce.number().int().min(1).max(100_000).nullable().optional(),
  calories_kcal: z.coerce.number().min(0).max(100_000).nullable().optional(),
  protein_grams: z.coerce.number().min(0).max(100_000).nullable().optional(),
  fat_grams: z.coerce.number().min(0).max(100_000).nullable().optional(),
  carbs_grams: z.coerce.number().min(0).max(100_000).nullable().optional(),
  storage_conditions: z.array(storageConditionSchema).max(2).nullable().optional(),
};
const productOverrideSchema = optionalPatch(
  z
    .object({
      custom_name: nullableText(160).optional(),
      custom_description: nullableText(2_000).optional(),
      custom_image_url: nullableHttpsUrl.optional(),
      custom_price: z.coerce.number().int().min(1).max(10_000_000).nullable().optional(),
      preparation_minutes: z.coerce.number().int().min(1).max(240).nullable().optional(),
      is_hidden: z.boolean().optional(),
      is_stop_listed: z.boolean().optional(),
      sort_order: positiveInteger(1_000_000).optional(),
      fulfillment_types: fulfillmentTypesSchema.optional(),
      name_translations: localizedOptional(160).nullable().optional(),
      description_translations: localizedOptional(2_000).nullable().optional(),
      ...productFactsFields,
    })
    .strict(),
);
const categoryOverrideSchema = optionalPatch(
  z
    .object({
      custom_name: nullableText(160).optional(),
      custom_image_url: nullableHttpsUrl.optional(),
      is_hidden: z.boolean().optional(),
      sort_order: positiveInteger(1_000_000).optional(),
      name_translations: localizedOptional(160).nullable().optional(),
    })
    .strict(),
);
const productOverrideBodySchema = z
  .object({
    iikoProductId: safeResourceIdSchema,
    overrides: productOverrideSchema,
  })
  .strict();
const categoryOverrideBodySchema = z
  .object({
    iikoCategoryId: safeResourceIdSchema,
    overrides: categoryOverrideSchema,
  })
  .strict();
const customProductBodySchema = z
  .object({
    id: uuidSchema.nullable().optional(),
    name: shortText(160, 1),
    description: shortText(2_000).optional().default(''),
    price: z.coerce.number().int().min(1).max(10_000_000),
    category_name: shortText(160, 1),
    image_url: nullableHttpsUrl.optional(),
    is_available: z.boolean().optional(),
    sort_order: positiveInteger(1_000_000).optional(),
    preparation_minutes: z.coerce.number().int().min(1).max(240).nullable().optional(),
    fulfillment_types: fulfillmentTypesSchema.optional(),
    ...productFactsFields,
  })
  .strict();
const customProductParamsSchema = routeParams({ id: uuidSchema });
const translateBodySchema = z
  .object({
    text: shortText(10_000),
    targetLang: z.enum(['ru', 'kk', 'en']),
  })
  .strict();

const inventoryParamsSchema = routeParams({
  branchId: uuidSchema,
  productId: safeResourceIdSchema,
});
const inventoryBodySchema = z
  .object({
    productName: shortText(160).optional(),
    sourceQuantity: z.coerce.number().int().min(0).max(100_000).nullable(),
    manualStop: z.boolean(),
    preparationMinutes: z.coerce.number().int().min(1).max(240).nullable().optional(),
  })
  .strict();

const courierParamsSchema = routeParams({ id: uuidSchema });
const courierBodySchema = z
  .object({
    name: shortText(160, 2),
    phone: z
      .string()
      .trim()
      .max(32)
      .refine((value) => {
        const digits = value.replace(/\D/g, '');
        return /^7\d{10}$/.test(digits) || /^8\d{10}$/.test(digits);
      }, 'Введите номер в формате +7'),
    vehicle: nullableText(80).optional(),
    active: z.boolean(),
    availabilityStatus: z.enum(['offline', 'available', 'busy', 'break']).optional(),
    maxActiveOrders: z.coerce.number().int().min(1).max(20).optional(),
  })
  .strict();
const courierActiveBodySchema = z.object({ active: z.boolean() }).strict();
const orderParamsSchema = routeParams({ id: uuidSchema });
const assignCourierBodySchema = z
  .object({
    courierId: uuidSchema,
    estimatedDeliveryAt: nullableDateTime.optional(),
  })
  .strict();
const deliveryStatusBodySchema = z
  .object({
    status: z.enum(['unassigned', 'assigned', 'picked_up', 'en_route', 'cancelled']),
  })
  .strict();
const orderStatusBodySchema = z
  .object({
    status: z.enum(['new', 'accepted', 'preparing', 'ready', 'completed', 'cancelled']),
    cancellationReason: shortText(500).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.status !== 'cancelled' ||
      Boolean(value.cancellationReason && value.cancellationReason.length >= 3),
    {
      path: ['cancellationReason'],
      message: 'Укажите причину отмены',
    },
  );

const clockSchema = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const dayHoursSchema = z
  .object({
    open: clockSchema,
    close: clockSchema,
    closed: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.closed === true || value.open < value.close, {
    message: 'Время закрытия должно быть позже времени открытия',
  });
const hoursSchema = z
  .object({
    daily: dayHoursSchema.optional(),
    monday: dayHoursSchema.optional(),
    tuesday: dayHoursSchema.optional(),
    wednesday: dayHoursSchema.optional(),
    thursday: dayHoursSchema.optional(),
    friday: dayHoursSchema.optional(),
    saturday: dayHoursSchema.optional(),
    sunday: dayHoursSchema.optional(),
    mon: dayHoursSchema.optional(),
    tue: dayHoursSchema.optional(),
    wed: dayHoursSchema.optional(),
    thu: dayHoursSchema.optional(),
    fri: dayHoursSchema.optional(),
    sat: dayHoursSchema.optional(),
    sun: dayHoursSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Укажите расписание');
const deliveryZoneSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .regex(/^[0-9A-Za-z._:-]+$/),
    radiusKm: z.coerce.number().positive().max(100),
    fee: z.coerce.number().int().min(0).max(100_000),
    minOrder: z.coerce.number().int().min(0).max(10_000_000),
    color: z
      .string()
      .trim()
      .regex(/^#[0-9A-F]{6}$/i),
  })
  .strict();
const deliveryZonesSchema = z
  .array(deliveryZoneSchema)
  .min(1)
  .max(8)
  .refine((zones) => {
    const radii = zones.map((zone) => zone.radiusKm);
    return radii.every((radius, index) => index === 0 || radius > radii[index - 1]);
  }, 'Радиусы зон должны возрастать');
const locationCityBodySchema = z
  .object({
    name: shortText(100, 2),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
  })
  .strict();
const locationBodySchema = z
  .object({
    cityId: uuidSchema,
    name: shortText(160, 2),
    address: shortText(300, 3),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    active: z.boolean().optional(),
    pickupEnabled: z.boolean().optional(),
    preorderEnabled: z.boolean().optional(),
    deliveryEnabled: z.boolean().optional(),
    deliveryZones: deliveryZonesSchema.optional(),
    hours: hoursSchema.optional(),
    slotMinutes: z.coerce.number().int().min(15).max(240).optional(),
    pickupSlotCapacity: z.coerce.number().int().min(1).max(500).optional(),
    preorderSlotCapacity: z.coerce.number().int().min(1).max(500).optional(),
    deliverySlotCapacity: z.coerce.number().int().min(1).max(500).optional(),
  })
  .strict();
const locationUpdateBodySchema = optionalPatch(
  z
    .object({
      active: z.boolean().optional(),
      pickupEnabled: z.boolean().optional(),
      preorderEnabled: z.boolean().optional(),
      deliveryEnabled: z.boolean().optional(),
      deliveryRadiusKm: z.coerce.number().min(0).max(100).nullable().optional(),
      deliveryFee: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
      deliveryMinOrder: z.coerce.number().int().min(0).max(10_000_000).nullable().optional(),
      slotMinutes: z.coerce.number().int().min(15).max(240).optional(),
      pickupSlotCapacity: z.coerce.number().int().min(1).max(500).optional(),
      preorderSlotCapacity: z.coerce.number().int().min(1).max(500).optional(),
      deliverySlotCapacity: z.coerce.number().int().min(1).max(500).optional(),
      latitude: z.coerce.number().min(-90).max(90).optional(),
      longitude: z.coerce.number().min(-180).max(180).optional(),
      deliveryZones: deliveryZonesSchema.optional(),
      hours: hoursSchema.optional(),
    })
    .strict(),
);
const locationParamsSchema = routeParams({ id: uuidSchema });
const deliveryZonesBulkBodySchema = z
  .object({
    deliveryZones: deliveryZonesSchema,
    enableDelivery: z.boolean().optional(),
  })
  .strict();

const pushTestBodySchema = z
  .object({
    title: shortText(160, 1),
    body: shortText(2_000, 1),
    fcmToken: shortText(4_096, 16),
  })
  .strict();
const pushMassBodySchema = z
  .object({
    title: shortText(160, 1).optional(),
    body: shortText(2_000, 1).optional(),
    titleTranslations: localizedRequired(160).optional(),
    bodyTranslations: localizedRequired(2_000).optional(),
    titles: localizedRequired(160).optional(),
    bodies: localizedRequired(2_000).optional(),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        (value.title && value.body) ||
        (value.titleTranslations && value.bodyTranslations) ||
        (value.titles && value.bodies),
      ),
    'Укажите заголовок и текст на всех языках',
  );
const broadcastBodySchema = z.object({ message: shortText(10_000, 1) }).strict();
const uploadBodySchema = z
  .object({
    imageBase64: z
      .string()
      .max(2_100_000)
      .regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/),
    filename: shortText(255).optional(),
  })
  .strict();

const contentLocaleSchema = z
  .object({
    title: shortText(255),
    description: shortText(5_000),
    coverUrl: nullableHttpsUrl.optional(),
    contentUrl: nullableHttpsUrl.optional(),
    imageUrl: nullableHttpsUrl.optional(),
  })
  .strict();
const contentI18nSchema = z
  .object({
    ru: contentLocaleSchema,
    kk: contentLocaleSchema,
    en: contentLocaleSchema,
  })
  .strict();
const storyBodySchema = z
  .object({
    id: z.union([numericIdSchema, z.coerce.number().int().positive()]).optional(),
    title: shortText(255, 1),
    description: shortText(5_000).optional(),
    coverUrl: httpsUrl,
    contentUrl: httpsUrl,
    groupId: shortText(160, 1),
    groupTitle: shortText(255, 1),
    groupCoverUrl: nullableHttpsUrl.optional(),
    duration: z.coerce.number().int().min(3).max(120),
    sortOrder: positiveInteger(1_000_000),
    i18n: contentI18nSchema,
  })
  .strict();
const newsBodySchema = z
  .object({
    id: z.union([numericIdSchema, z.coerce.number().int().positive()]).optional(),
    title: shortText(255, 1),
    imageUrl: httpsUrl,
    description: shortText(5_000).optional(),
    i18n: contentI18nSchema,
  })
  .strict();
const numericParamsSchema = routeParams({ id: numericIdSchema });
const legacyI18nSchema = z
  .object({
    ru: z
      .object({
        name: shortText(200).optional(),
        address: shortText(500).optional(),
      })
      .strict()
      .optional(),
    kk: z
      .object({
        name: shortText(200).optional(),
        address: shortText(500).optional(),
      })
      .strict()
      .optional(),
    kz: z
      .object({
        name: shortText(200).optional(),
        address: shortText(500).optional(),
      })
      .strict()
      .optional(),
    en: z
      .object({
        name: shortText(200).optional(),
        address: shortText(500).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
const legacyCityBodySchema = z
  .object({
    name: shortText(160, 1),
    i18n: legacyI18nSchema.optional(),
  })
  .strict();
const legacyPointBodySchema = z
  .object({
    city_id: z.coerce.number().int().positive(),
    name: shortText(200, 1),
    address: shortText(500, 1),
    latitude: z.coerce.number().min(-90).max(90).nullable().optional(),
    longitude: z.coerce.number().min(-180).max(180).nullable().optional(),
    i18n: legacyI18nSchema.optional(),
  })
  .strict();
const legacyPointUpdateBodySchema = legacyPointBodySchema.omit({ city_id: true });

const optionTranslationSchema = localizedRequired(160);
const optionEntrySchema = z
  .object({
    id: uuidSchema.optional(),
    groupId: uuidSchema.optional(),
    code: safeResourceIdSchema,
    title: optionTranslationSchema,
    name: shortText(160).optional(),
    priceDelta: z.coerce.number().min(0).max(10_000_000),
    isDefault: z.boolean().optional(),
    active: z.boolean().optional(),
    sortOrder: positiveInteger(1_000_000).optional(),
  })
  .strict();
const modifierGroupSchema = z
  .object({
    id: uuidSchema.optional(),
    productId: safeResourceIdSchema.optional(),
    code: safeResourceIdSchema,
    title: optionTranslationSchema,
    name: shortText(160).optional(),
    selectionType: z.enum(['single', 'multiple']),
    required: z.boolean(),
    minSelected: positiveInteger(100),
    maxSelected: z.coerce.number().int().min(1).max(100),
    active: z.boolean().optional(),
    sortOrder: positiveInteger(1_000_000).optional(),
    options: z.array(optionEntrySchema).min(1).max(100),
  })
  .strict()
  .refine((value) => value.minSelected <= value.maxSelected, {
    path: ['minSelected'],
    message: 'Минимум не может быть больше максимума',
  });
const productConfigurationSchema = z
  .object({
    productId: safeResourceIdSchema.optional(),
    productKind: z.enum(['standard', 'cake', 'bakery']),
    enabled: z.boolean(),
    allowInscription: z.boolean(),
    inscriptionMaxLength: z.coerce.number().int().min(1).max(500),
    allowCandles: z.boolean(),
    allowReferenceUpload: z.boolean(),
    minLeadHours: positiveInteger(8_760),
    maxAdvanceDays: z.coerce.number().int().min(1).max(365),
    weightOptions: z.array(optionEntrySchema).max(100),
    fillingOptions: z.array(optionEntrySchema).max(100),
    designOptions: z.array(optionEntrySchema).max(100),
  })
  .strict();
const productOptionsBodySchema = z
  .object({
    configuration: productConfigurationSchema,
    modifierGroups: z.array(modifierGroupSchema).max(50),
  })
  .strict();
const productOptionsParamsSchema = routeParams({ productId: safeResourceIdSchema });

const dispatchOrderParamsSchema = routeParams({ orderId: uuidSchema });
const yandexCancelBodySchema = z.object({ allowPaid: z.boolean().optional() }).strict();
const courierAvailabilityBodySchema = z
  .object({ status: z.enum(['offline', 'available', 'busy', 'break']) })
  .strict();
const reviewBodySchema = z
  .object({ status: z.enum(['published', 'hidden', 'requires_attention', 'resolved']) })
  .strict();
const supportMessageBodySchema = z
  .object({
    body: shortText(4_000, 1).optional(),
    message: shortText(4_000, 1).optional(),
    internal: z.boolean().optional(),
    attachments: z
      .array(z.union([shortText(1_000, 1), z.object({ path: shortText(1_000, 1) }).strict()]))
      .max(3)
      .optional(),
  })
  .strict()
  .refine((value) => Boolean(value.body || value.message), 'Введите сообщение');
const supportUpdateBodySchema = optionalPatch(
  z
    .object({
      status: z.enum(['new', 'in_review', 'resolved', 'rejected']).optional(),
      priority: z.enum(['low', 'normal', 'high', 'urgent']).optional(),
      resolution: shortText(1_000).optional(),
      assignedTo: shortText(120).nullable().optional(),
      assignToMe: z.boolean().optional(),
    })
    .strict(),
);

const promotionBodySchema = z
  .object({
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9_-]{3,64}$/),
    title: shortText(160).optional(),
    description: shortText(1_000).optional(),
    discountType: z.enum(['percent', 'fixed']),
    discountValue: z.coerce.number().positive().max(100_000_000),
    minOrder: moneySchema,
    maxDiscount: z.coerce.number().positive().max(100_000_000).nullable(),
    customerIds: z.array(uuidSchema).max(10_000),
    customerTags: z.array(shortText(64, 1)).max(500),
    branchIds: z.array(uuidSchema).max(500).optional(),
    usageLimit: z.coerce.number().int().min(1).max(1_000_000).nullable(),
    perCustomerLimit: z.coerce.number().int().min(1).max(1_000),
    startsAt: nullableDateTime,
    endsAt: nullableDateTime,
    active: z.boolean(),
  })
  .strict()
  .refine((value) => value.discountType !== 'percent' || value.discountValue <= 100, {
    path: ['discountValue'],
    message: 'Процент скидки не может быть больше 100',
  })
  .refine(
    (value) =>
      !value.startsAt ||
      !value.endsAt ||
      new Date(value.endsAt).getTime() > new Date(value.startsAt).getTime(),
    {
      path: ['endsAt'],
      message: 'Дата окончания должна быть позже даты начала',
    },
  );
const giftCardBodySchema = z
  .object({
    amount: z.coerce.number().int().min(500).max(1_000_000),
    purchaserCustomerId: uuidSchema.nullable().optional(),
    recipientCustomerId: uuidSchema.nullable().optional(),
    recipientName: shortText(160).optional(),
    message: shortText(500).optional(),
    expiresAt: nullableDateTime,
  })
  .strict();
const automationConfigSchema = z
  .object({
    delayMinutes: z.coerce.number().int().min(1).max(525_600).optional(),
    cooldownHours: z.coerce.number().int().min(1).max(8_760).optional(),
    daysBefore: z.coerce.number().int().min(0).max(365).optional(),
    inactiveDays: z.coerce.number().int().min(1).max(3_650).optional(),
    cooldownDays: z.coerce.number().int().min(1).max(3_650).optional(),
    expirationDays: z.coerce.number().int().min(1).max(3_650).optional(),
  })
  .strict();
const automationBodySchema = z
  .object({
    titleTranslations: localizedOptional(160),
    bodyTranslations: localizedOptional(2_000),
    config: automationConfigSchema,
    active: z.boolean(),
  })
  .strict();

const staffRoleSchema = z.enum(['branch_manager', 'operator', 'marketer', 'courier', 'viewer']);
const accessCreateBodySchema = z
  .object({
    phone: z.string().trim().min(10).max(32),
    displayName: shortText(160, 1),
    role: staffRoleSchema,
    branchIds: z
      .array(uuidSchema)
      .max(50)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Филиалы не должны повторяться',
      }),
  })
  .strict();
const accessUpdateBodySchema = z
  .object({
    displayName: nullableText(160).optional(),
    role: z.enum(['owner', 'branch_manager', 'operator', 'marketer', 'courier', 'viewer']),
    branchIds: z
      .array(uuidSchema)
      .max(50)
      .refine((items) => new Set(items).size === items.length, {
        message: 'Филиалы не должны повторяться',
      }),
    active: z.boolean(),
  })
  .strict();

const adminMutationSchemas = {
  whatsappSettings: withBody(whatsappSettingsBodySchema),
  whatsappConversationUpdate: {
    params: whatsappConversationParamsSchema,
    body: whatsappConversationUpdateBodySchema,
  },
  whatsappMessage: {
    params: whatsappConversationParamsSchema,
    body: whatsappMessageBodySchema,
  },
  whatsappVoice: {
    params: whatsappConversationParamsSchema,
    body: whatsappVoiceBodySchema,
  },
  whatsappMemory: {
    params: whatsappConversationParamsSchema,
    body: whatsappMemoryBodySchema,
  },
  whatsappMemoryDelete: withParams(whatsappMemoryParamsSchema),
  whatsappKnowledge: withBody(whatsappKnowledgeBodySchema),
  whatsappKnowledgeUpdate: {
    params: whatsappKnowledgeParamsSchema,
    body: whatsappKnowledgeUpdateBodySchema,
  },
  whatsappKnowledgeDelete: withParams(whatsappKnowledgeParamsSchema),
  siteAccess: withBody(siteAccessBodySchema),
  settings: withBody(settingsBodySchema),
  tierCreate: withBody(tierBodySchema),
  tierUpdate: { params: tierParamsSchema, body: tierBodySchema },
  tierDelete: withParams(tierParamsSchema),
  tierReorder: withBody(tierReorderBodySchema),
  tierActive: { params: tierParamsSchema, body: tierActiveBodySchema },
  empty: withBody(emptyBodySchema),
  productOverride: withBody(productOverrideBodySchema),
  categoryOverride: withBody(categoryOverrideBodySchema),
  customProduct: withBody(customProductBodySchema),
  customProductDelete: withParams(customProductParamsSchema),
  translate: withBody(translateBodySchema),
  inventory: { params: inventoryParamsSchema, body: inventoryBodySchema },
  courierCreate: withBody(courierBodySchema),
  courierUpdate: { params: courierParamsSchema, body: courierBodySchema },
  courierActive: { params: courierParamsSchema, body: courierActiveBodySchema },
  courierEmpty: withParams(courierParamsSchema),
  assignCourier: { params: orderParamsSchema, body: assignCourierBodySchema },
  deliveryStatus: { params: orderParamsSchema, body: deliveryStatusBodySchema },
  orderStatus: { params: orderParamsSchema, body: orderStatusBodySchema },
  locationCity: withBody(locationCityBodySchema),
  locationCreate: withBody(locationBodySchema),
  locationBulk: withBody(deliveryZonesBulkBodySchema),
  locationUpdate: { params: locationParamsSchema, body: locationUpdateBodySchema },
  pushTest: withBody(pushTestBodySchema),
  pushMass: withBody(pushMassBodySchema),
  broadcast: withBody(broadcastBodySchema),
  upload: withBody(uploadBodySchema),
  storyCreate: withBody(storyBodySchema),
  storyUpdate: { params: numericParamsSchema, body: storyBodySchema },
  numericDelete: withParams(numericParamsSchema),
  newsCreate: withBody(newsBodySchema),
  newsUpdate: { params: numericParamsSchema, body: newsBodySchema },
  legacyCityCreate: withBody(legacyCityBodySchema),
  legacyCityUpdate: { params: numericParamsSchema, body: legacyCityBodySchema },
  legacyPointCreate: withBody(legacyPointBodySchema),
  legacyPointUpdate: { params: numericParamsSchema, body: legacyPointUpdateBodySchema },
  productOptions: { params: productOptionsParamsSchema, body: productOptionsBodySchema },
  dispatchEmpty: withParams(dispatchOrderParamsSchema),
  yandexCancel: { params: dispatchOrderParamsSchema, body: yandexCancelBodySchema },
  courierAvailability: {
    params: courierParamsSchema,
    body: courierAvailabilityBodySchema,
  },
  reviewStatus: { params: routeParams({ id: uuidSchema }), body: reviewBodySchema },
  supportMessage: {
    params: routeParams({ id: uuidSchema }),
    body: supportMessageBodySchema,
  },
  supportUpdate: {
    params: routeParams({ id: uuidSchema }),
    body: supportUpdateBodySchema,
  },
  promotionCreate: withBody(promotionBodySchema),
  promotionUpdate: {
    params: routeParams({ id: uuidSchema }),
    body: promotionBodySchema,
  },
  giftCard: withBody(giftCardBodySchema),
  automation: {
    params: routeParams({ id: uuidSchema }),
    body: automationBodySchema,
  },
  accessCreate: withBody(accessCreateBodySchema),
  accessUpdate: {
    params: routeParams({ username: safeUsernameSchema }),
    body: accessUpdateBodySchema,
  },
};

module.exports = {
  adminMutationSchemas,
};

import SelectControl from '../../components/SelectControl';

export interface IikoProduct {
  id: string;
  name: string;
  description?: string;
  price?: number;
  parentGroup?: string;
  sizePrices?: { price: { currentPrice: number } }[];
  imageLinks?: string[];
}

export interface IikoGroup {
  id: string;
  name: string;
  order?: number;
}

export type StorageDurationUnit = 'hours' | 'days' | 'months';

export interface ProductStorageCondition {
  temperature: string;
  duration_value?: number;
  duration_unit?: StorageDurationUnit | '';
}

export interface ProductOverride {
  iiko_product_id: string;
  custom_name?: string;
  name_translations?: Record<string, string>;
  custom_price?: number;
  custom_image_url?: string;
  custom_description?: string;
  description_translations?: Record<string, string>;
  is_hidden?: boolean;
  is_stop_listed?: boolean;
  ingredients?: string;
  ingredients_translations?: Record<string, string>;
  allergens?: string[] | string;
  dietary_tags?: string[] | string;
  search_keywords?: string[] | string;
  weight_grams?: number;
  calories_kcal?: number;
  protein_grams?: number;
  fat_grams?: number;
  carbs_grams?: number;
  storage_conditions?: ProductStorageCondition[];
  fulfillment_types?: FulfillmentType[];
}

export interface CategoryOverride {
  iiko_category_id: string;
  custom_name?: string | null;
  name_translations?: Record<string, string> | null;
  custom_image_url?: string;
  is_hidden?: boolean;
}

export const resolveIikoProductPrices = (products: IikoProduct[] = []): IikoProduct[] =>
  products.map((product) => ({
    ...product,
    price: product.price || (product.sizePrices?.[0]?.price?.currentPrice ?? 0),
  }));

export const indexProductOverrides = (
  overrides: ProductOverride[] = [],
): Record<string, ProductOverride> =>
  Object.fromEntries(overrides.map((override) => [override.iiko_product_id, override]));

export const indexCategoryOverrides = (
  overrides: CategoryOverride[] = [],
): Record<string, CategoryOverride> =>
  Object.fromEntries(overrides.map((override) => [override.iiko_category_id, override]));

export interface CustomProduct {
  id?: string;
  name: string;
  description?: string;
  price: number;
  category_name: string;
  image_url?: string;
  is_available?: boolean;
  sort_order?: number;
  preparation_minutes?: number | null;
  ingredients?: string;
  ingredients_translations?: Record<string, string>;
  allergens?: string[] | string;
  dietary_tags?: string[] | string;
  search_keywords?: string[] | string;
  weight_grams?: number;
  calories_kcal?: number;
  protein_grams?: number;
  fat_grams?: number;
  carbs_grams?: number;
  storage_conditions?: ProductStorageCondition[];
  fulfillment_types?: FulfillmentType[];
}

export type FulfillmentType = 'pickup' | 'delivery' | 'preorder';
export type MenuLanguage = 'ru' | 'kk' | 'en';

export const menuLanguages: ReadonlyArray<{ value: MenuLanguage; label: string }> = [
  { value: 'ru', label: 'Русский' },
  { value: 'kk', label: 'Қазақша' },
  { value: 'en', label: 'English' },
];

export const emptyTranslations = (): Record<MenuLanguage, string> => ({ ru: '', kk: '', en: '' });

export const normalizeTranslations = (value: unknown): Record<MenuLanguage, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return emptyTranslations();
  const source = value as Record<string, unknown>;
  return {
    ru: typeof source.ru === 'string' ? source.ru : '',
    kk: typeof source.kk === 'string' ? source.kk : '',
    en: typeof source.en === 'string' ? source.en : '',
  };
};

export const fulfillmentTypeOptions: ReadonlyArray<{
  value: FulfillmentType;
  label: string;
  shortLabel: string;
}> = [
  { value: 'pickup', label: 'Самовывоз', shortLabel: 'Самовывоз' },
  { value: 'delivery', label: 'Доставка', shortLabel: 'Доставка' },
  { value: 'preorder', label: 'Предзаказ', shortLabel: 'Предзаказ' },
];

export const defaultFulfillmentTypes = fulfillmentTypeOptions.map((option) => option.value);

export const normalizeFulfillmentTypes = (value?: string[]): FulfillmentType[] => {
  if (!Array.isArray(value)) return [...defaultFulfillmentTypes];
  const requested = new Set(value);
  return fulfillmentTypeOptions.map((option) => option.value).filter((type) => requested.has(type));
};

const productOverridePatchKeys = [
  'custom_name',
  'name_translations',
  'custom_price',
  'custom_image_url',
  'custom_description',
  'description_translations',
  'is_hidden',
  'is_stop_listed',
  'ingredients',
  'ingredients_translations',
  'allergens',
  'dietary_tags',
  'search_keywords',
  'weight_grams',
  'calories_kcal',
  'protein_grams',
  'fat_grams',
  'carbs_grams',
  'storage_conditions',
  'fulfillment_types',
] as const satisfies ReadonlyArray<keyof Omit<ProductOverride, 'iiko_product_id'>>;

export const normalizeStorageConditionsForSave = (
  value: unknown,
): ProductStorageCondition[] => {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > 2) {
    throw new Error('Условия хранения заполнены некорректно');
  }

  return value.flatMap((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new Error(`Условие хранения ${index + 1} заполнено некорректно`);
    }
    const source = raw as Record<string, unknown>;
    const temperature = String(source.temperature ?? '').trim();
    const rawDuration = source.duration_value ?? source.durationValue;
    const durationUnit = String(source.duration_unit ?? source.durationUnit ?? '').trim();
    const hasDuration = rawDuration !== undefined && rawDuration !== null && rawDuration !== '';

    if (!temperature && !hasDuration && !durationUnit) return [];
    if (!temperature) {
      throw new Error(`Укажите температуру для условия хранения ${index + 1}`);
    }
    if (temperature.length > 40) {
      throw new Error(`Температура в условии хранения ${index + 1} слишком длинная`);
    }
    const durationValue = Number(rawDuration);
    if (!Number.isInteger(durationValue) || durationValue < 1 || durationValue > 10_000) {
      throw new Error(`Укажите срок хранения от 1 до 10000 для условия ${index + 1}`);
    }
    if (!['hours', 'days', 'months'].includes(durationUnit)) {
      throw new Error(`Выберите единицу срока хранения ${index + 1}`);
    }
    return [
      {
        temperature,
        duration_value: durationValue,
        duration_unit: durationUnit as StorageDurationUnit,
      },
    ];
  });
};

export const sanitizeProductOverridePatch = (
  value: unknown,
): Omit<ProductOverride, 'iiko_product_id'> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Настройки товара заполнены некорректно');
  }
  const source = value as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const key of productOverridePatchKeys) {
    if (source[key] !== undefined) patch[key] = source[key];
  }
  if (source.storage_conditions !== undefined) {
    patch.storage_conditions = normalizeStorageConditionsForSave(source.storage_conditions);
  }
  return patch as Omit<ProductOverride, 'iiko_product_id'>;
};

export function FulfillmentTypeFields({
  value,
  onChange,
  idPrefix,
}: {
  value?: FulfillmentType[];
  onChange: (value: FulfillmentType[]) => void;
  idPrefix: string;
}) {
  const selected = normalizeFulfillmentTypes(value);
  return (
    <fieldset className="form-section">
      <legend>Каталоги заказа</legend>
      <p className="field-hint mb-3">
        Товар появится только в отмеченных каталогах. Выберите минимум один вариант.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {fulfillmentTypeOptions.map((option) => {
          const checked = selected.includes(option.value);
          return (
            <label
              key={option.value}
              htmlFor={`${idPrefix}-${option.value}`}
              className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 transition-colors ${
                checked
                  ? 'border-amber-400 bg-amber-50 text-amber-950'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-amber-200'
              }`}
            >
              <input
                id={`${idPrefix}-${option.value}`}
                type="checkbox"
                checked={checked}
                onChange={(event) => {
                  const next = event.target.checked
                    ? [...selected, option.value]
                    : selected.filter((type) => type !== option.value);
                  onChange(
                    fulfillmentTypeOptions
                      .map((item) => item.value)
                      .filter((type) => next.includes(type)),
                  );
                }}
                className="h-5 w-5 rounded border-gray-300 text-amber-600 focus:ring-amber-500"
              />
              <span className="text-sm font-semibold">{option.label}</span>
            </label>
          );
        })}
      </div>
      {selected.length === 0 && (
        <p className="mt-2 text-sm font-medium text-red-600" role="alert">
          Выберите хотя бы один каталог.
        </p>
      )}
    </fieldset>
  );
}

export const fulfillmentSummary = (value?: FulfillmentType[]) => {
  const selected = normalizeFulfillmentTypes(value);
  return fulfillmentTypeOptions
    .filter((option) => selected.includes(option.value))
    .map((option) => option.shortLabel)
    .join(' · ');
};

export type ProductFactKey =
  | 'allergens'
  | 'dietary_tags'
  | 'search_keywords'
  | 'weight_grams'
  | 'calories_kcal'
  | 'protein_grams'
  | 'fat_grams'
  | 'carbs_grams'
  | 'storage_conditions';

export interface ProductFactsDraft {
  allergens?: string[] | string;
  dietary_tags?: string[] | string;
  search_keywords?: string[] | string;
  weight_grams?: number;
  calories_kcal?: number;
  protein_grams?: number;
  fat_grams?: number;
  carbs_grams?: number;
  storage_conditions?: ProductStorageCondition[];
}

export interface ProductFactOption {
  value: string;
  label: string;
  icon: string;
  aliases?: string[];
}

export const allergenOptions: ProductFactOption[] = [
  { value: 'gluten', label: 'Глютен', icon: 'gluten', aliases: ['глютен'] },
  { value: 'milk', label: 'Молоко', icon: 'milk', aliases: ['молоко'] },
  { value: 'egg', label: 'Яйца', icon: 'egg', aliases: ['яйцо', 'яйца', 'eggs'] },
  { value: 'nuts', label: 'Орехи', icon: 'nuts', aliases: ['орехи', 'tree nuts'] },
  { value: 'peanut', label: 'Арахис', icon: 'peanut', aliases: ['арахис', 'peanuts'] },
  { value: 'sesame', label: 'Кунжут', icon: 'sesame', aliases: ['кунжут'] },
  { value: 'soy', label: 'Соя', icon: 'soy', aliases: ['соя'] },
];

export const productMarkOptions: ProductFactOption[] = [
  { value: 'halal', label: 'Halal', icon: 'halal', aliases: ['халяль'] },
  { value: 'eac', label: 'EAC', icon: 'eac' },
  { value: 'iso', label: 'ISO', icon: 'iso' },
  {
    value: 'traces_nuts_sesame',
    label: 'Возможны следы орехов и кунжута',
    icon: 'traces-nuts-sesame',
    aliases: ['может содержать следы орехов и кунжута'],
  },
  {
    value: 'not_for_under_3',
    label: 'Не рекомендуется детям до 3 лет',
    icon: 'under-3',
    aliases: ['не рекомендуется детям до 3 лет'],
  },
  {
    value: 'vegetarian',
    label: 'Вегетарианское',
    icon: 'vegetarian',
    aliases: ['вегетарианское'],
  },
  { value: 'vegan', label: 'Веганское', icon: 'vegan', aliases: ['веганское'] },
  {
    value: 'sugar_free',
    label: 'Без сахара',
    icon: 'sugar-free',
    aliases: ['без сахара', 'sugar free'],
  },
  {
    value: 'lactose_free',
    label: 'Без лактозы',
    icon: 'lactose-free',
    aliases: ['без лактозы', 'lactose free'],
  },
];

export const normalizeFactChoices = (
  value: string[] | string | undefined,
  options: ProductFactOption[],
) => {
  const source = Array.isArray(value) ? value : String(value || '').split(/[,;\n]/);
  const aliasMap = new Map<string, string>();
  for (const option of options) {
    for (const alias of [option.value, option.label, ...(option.aliases || [])]) {
      aliasMap.set(alias.trim().toLocaleLowerCase('ru-RU'), option.value);
    }
  }
  return [
    ...new Set(
      source
        .map((item) => aliasMap.get(String(item).trim().toLocaleLowerCase('ru-RU')))
        .filter((item): item is string => Boolean(item)),
    ),
  ];
};

export function ProductFactsFields({
  value,
  onChange,
  idPrefix,
}: {
  value: ProductFactsDraft;
  onChange: (
    key: ProductFactKey,
    value: string | string[] | number | ProductStorageCondition[] | undefined,
  ) => void;
  idPrefix: string;
}) {
  const numberField = (
    key: Exclude<
      ProductFactKey,
      'allergens' | 'dietary_tags' | 'search_keywords' | 'storage_conditions'
    >,
    label: string,
    step = '1',
  ) => (
    <div className="field-group">
      <label className="field-label" htmlFor={`${idPrefix}-${key}`}>
        {label}
      </label>
      <input
        id={`${idPrefix}-${key}`}
        type="number"
        min="0"
        step={step}
        value={value[key] ?? ''}
        onChange={(event) =>
          onChange(key, event.target.value === '' ? undefined : Number(event.target.value))
        }
        className="input-classic"
      />
    </div>
  );
  const choiceField = (
    key: 'allergens' | 'dietary_tags',
    label: string,
    hint: string,
    options: ProductFactOption[],
  ) => {
    const selected = normalizeFactChoices(value[key], options);
    return (
      <fieldset className="product-fact-choice-group">
        <legend>{label}</legend>
        <p>{hint}</p>
        <div className="product-fact-choice-grid">
          {options.map((option) => {
            const active = selected.includes(option.value);
            return (
              <label
                key={option.value}
                className={`product-fact-choice ${active ? 'is-selected' : ''}`}
              >
                <input
                  type="checkbox"
                  checked={active}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...selected, option.value]
                      : selected.filter((item) => item !== option.value);
                    onChange(key, next);
                  }}
                />
                <img
                  src={`${import.meta.env.BASE_URL}assets/product_marks/${option.icon}.png`}
                  alt=""
                  width="54"
                  height="54"
                  loading="lazy"
                />
                <span>{option.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>
    );
  };
  const storageRows: ProductStorageCondition[] = [0, 1].map((index) => ({
    temperature: value.storage_conditions?.[index]?.temperature || '',
    duration_value: value.storage_conditions?.[index]?.duration_value,
    duration_unit: value.storage_conditions?.[index]?.duration_unit || '',
  }));
  const updateStorageRow = (index: number, patch: Partial<ProductStorageCondition>) => {
    const next = storageRows.map((row, rowIndex) =>
      rowIndex === index ? { ...row, ...patch } : row,
    );
    onChange('storage_conditions', next);
  };
  return (
    <fieldset className="form-section">
      <legend>Карточка товара</legend>
      <p className="field-hint mb-3">
        Эти данные видит клиент. Значения КБЖУ указываются на весь товар.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {numberField('weight_grams', 'Вес, г')}
        {numberField('calories_kcal', 'Калорийность, ккал', '0.1')}
        {numberField('protein_grams', 'Белки, г', '0.1')}
        {numberField('fat_grams', 'Жиры, г', '0.1')}
        {numberField('carbs_grams', 'Углеводы, г', '0.1')}
      </div>
      <section className="product-storage-editor" aria-labelledby={`${idPrefix}-storage-title`}>
        <div className="product-storage-editor__heading">
          <strong id={`${idPrefix}-storage-title`}>Срок и условия хранения</strong>
          <p>Температура показывается как введена. Срок автоматически переводится в приложении.</p>
        </div>
        <div className="product-storage-editor__rows">
          {storageRows.map((condition, index) => (
            <div className="product-storage-row" key={`${idPrefix}-storage-${index}`}>
              <strong className="product-storage-row__title">
                {index === 0 ? 'Условие 1' : 'Условие 2 (необязательно)'}
              </strong>
              <div className="product-storage-row__fields">
                <div className="field-group">
                  <label
                    className="field-label"
                    htmlFor={`${idPrefix}-storage-temperature-${index}`}
                  >
                    Температура
                  </label>
                  <input
                    id={`${idPrefix}-storage-temperature-${index}`}
                    type="text"
                    value={condition.temperature}
                    onChange={(event) =>
                      updateStorageRow(index, { temperature: event.target.value })
                    }
                    className="input-classic"
                    placeholder={index === 0 ? '-18 °C' : '4±2 °C'}
                    maxLength={40}
                  />
                </div>
                <div className="field-group">
                  <label className="field-label" htmlFor={`${idPrefix}-storage-duration-${index}`}>
                    Срок
                  </label>
                  <input
                    id={`${idPrefix}-storage-duration-${index}`}
                    type="number"
                    min="1"
                    max="10000"
                    step="1"
                    value={condition.duration_value ?? ''}
                    onChange={(event) =>
                      updateStorageRow(index, {
                        duration_value:
                          event.target.value === '' ? undefined : Number(event.target.value),
                      })
                    }
                    className="input-classic"
                    placeholder={index === 0 ? '90' : '72'}
                  />
                </div>
                <div className="field-group">
                  <span className="field-label">Единица срока</span>
                  <SelectControl
                    id={`${idPrefix}-storage-unit-${index}`}
                    value={condition.duration_unit || ''}
                    onChange={(duration_unit) =>
                      updateStorageRow(index, {
                        duration_unit: duration_unit as StorageDurationUnit,
                      })
                    }
                    placeholder="Выберите"
                    ariaLabel={`Единица срока для условия ${index + 1}`}
                    options={[
                      { value: 'hours', label: 'Часы' },
                      { value: 'days', label: 'Дни' },
                      { value: 'months', label: 'Месяцы' },
                    ]}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
      <div className="mt-4 space-y-4">
        {choiceField(
          'allergens',
          'Аллергены',
          'Отметьте вещества, которые входят в состав товара.',
          allergenOptions,
        )}
        {choiceField(
          'dietary_tags',
          'Сертификаты и маркировка',
          'Выберите значки, которые клиент увидит в карточке товара.',
          productMarkOptions,
        )}
      </div>
    </fieldset>
  );
}

export const categoryNameKey = (value?: string | null) =>
  (value || '').normalize('NFKC').trim().toLocaleLowerCase('ru-RU');
export const categoryNameKeys = (group: IikoGroup, override?: CategoryOverride) =>
  [group.name, override?.custom_name, ...Object.values(override?.name_translations || {})]
    .map(categoryNameKey)
    .filter(Boolean);

export const menuNameCollator = new Intl.Collator(['ru-RU', 'kk-KZ'], {
  sensitivity: 'base',
  numeric: true,
  ignorePunctuation: true,
});

export const resolvedCategoryName = (group: IikoGroup, override?: CategoryOverride) => {
  const translations = normalizeTranslations(override?.name_translations);
  return translations.ru || override?.custom_name || group.name;
};

export const resolvedProductName = (product: IikoProduct, override?: ProductOverride) =>
  override?.custom_name || product.name;

export const compareMenuNames = (left: string, right: string) =>
  menuNameCollator.compare(left, right);

export const emptyProductOptions = {
  configuration: {
    productKind: 'standard',
    enabled: true,
    allowInscription: false,
    inscriptionMaxLength: 80,
    allowCandles: false,
    allowReferenceUpload: false,
    minLeadHours: 0,
    maxAdvanceDays: 30,
    weightOptions: [] as any[],
    fillingOptions: [] as any[],
    designOptions: [] as any[],
  },
  modifierGroups: [] as any[],
};

export type BuilderOptionKey = 'weightOptions' | 'fillingOptions' | 'designOptions';
export type OptionLanguage = 'ru' | 'kk' | 'en';

export const optionLanguages: Array<{ code: OptionLanguage; label: string }> = [
  { code: 'ru', label: 'Название RU' },
  { code: 'kk', label: 'Атауы KZ' },
  { code: 'en', label: 'Name EN' },
];

export const modifierGroupTemplates: Record<string, Record<OptionLanguage, string>> = {
  Размер: { ru: 'Размер', kk: 'Өлшем', en: 'Size' },
  Добавки: { ru: 'Добавки', kk: 'Қоспалар', en: 'Add-ons' },
  Упаковка: { ru: 'Упаковка', kk: 'Қаптама', en: 'Packaging' },
};

export const builderOptionSections: Array<{
  key: BuilderOptionKey;
  prefix: string;
  title: string;
  description: string;
  placeholder: string;
}> = [
  {
    key: 'weightOptions',
    prefix: 'weight',
    title: 'Вес',
    description: 'Какой вес сможет выбрать клиент.',
    placeholder: 'Например, 1,5 кг',
  },
  {
    key: 'fillingOptions',
    prefix: 'filling',
    title: 'Начинка',
    description: 'Доступные вкусы и их доплата.',
    placeholder: 'Например, Красный бархат',
  },
  {
    key: 'designOptions',
    prefix: 'design',
    title: 'Оформление',
    description: 'Варианты внешнего оформления.',
    placeholder: 'Например, Фотопечать',
  },
];

export const draftCode = (prefix: string) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

export const createBuilderOption = (prefix: string) => ({
  code: draftCode(prefix),
  title: { ru: '', kk: '', en: '' },
  priceDelta: 0,
});

export const createModifierOption = () => ({
  code: draftCode('option'),
  title: { ru: '', kk: '', en: '' },
  priceDelta: 0,
  isDefault: false,
});

export const createModifierGroup = (
  title = '',
  selectionType: 'single' | 'multiple' = 'single',
  required = false,
) => ({
  code: draftCode('group'),
  title: {
    ...(modifierGroupTemplates[title] || { ru: title, kk: '', en: '' }),
  },
  selectionType,
  required,
  minSelected: required ? 1 : 0,
  maxSelected: selectionType === 'single' ? 1 : 3,
  options: [createModifierOption()],
});

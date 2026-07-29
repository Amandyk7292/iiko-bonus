const { supabase } = require('../config/supabase');
const { MENU_FULFILLMENT_TYPES } = require('../utils/menu-visibility.util');

const menuError = (message, statusCode = 400) => Object.assign(new Error(message), { statusCode });
const cleanText = (value, maximum, required = false) => {
  const text = String(value ?? '')
    .replace(/\p{Cc}/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maximum);
  if (required && !text) throw menuError('Заполните обязательные поля товара');
  return text;
};
const cleanId = (value, label) => {
  const id = cleanText(value, 160, true);
  if (!/^[0-9A-Za-z._:-]+$/.test(id)) throw menuError(`Некорректный ${label}`);
  return id;
};
const cleanUrl = (value) => {
  const url = cleanText(value, 2000);
  if (!url) return null;
  try {
    if (new URL(url).protocol !== 'https:') throw new Error('https required');
  } catch {
    throw menuError('Адрес изображения должен быть HTTPS URL');
  }
  return url;
};
const cleanTranslations = (value, maximum) => {
  if (value === undefined) return undefined;
  // Older rows created before translation support contain SQL NULL here.
  // Treat it as an intentionally empty value so an unrelated patch (photo,
  // visibility, etc.) cannot fail because of legacy data.
  if (value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw menuError('Переводы заданы некорректно');
  }
  return Object.fromEntries(
    ['ru', 'kk', 'en'].map((language) => [language, cleanText(value[language], maximum)]),
  );
};
const cleanInteger = (value, label, { minimum = 0, maximum = 10000000 } = {}) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw menuError(`Поле ${label} содержит некорректное число`);
  }
  return number;
};
const cleanDecimal = (value, label, { minimum = 0, maximum = 100000 } = {}) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw menuError(`Поле ${label} содержит некорректное число`);
  }
  return Math.round(number * 100) / 100;
};
const cleanTextList = (value, label, { maximumItems = 30, maximumLength = 80 } = {}) => {
  if (value === undefined) return undefined;
  const source = typeof value === 'string' ? value.split(/[,;\n]/) : value;
  if (!Array.isArray(source)) throw menuError(`Поле ${label} задано некорректно`);
  const cleaned = [
    ...new Set(source.map((item) => cleanText(item, maximumLength)).filter(Boolean)),
  ];
  if (cleaned.length > maximumItems) {
    throw menuError(`Поле ${label} содержит слишком много значений`);
  }
  return cleaned;
};

const cleanFulfillmentTypes = (value) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw menuError('Типы заказа заданы некорректно');
  const requested = new Set(
    value.map((item) =>
      String(item || '')
        .trim()
        .toLowerCase(),
    ),
  );
  const invalid = [...requested].filter((item) => !MENU_FULFILLMENT_TYPES.includes(item));
  if (invalid.length > 0 || requested.size === 0) {
    throw menuError('Выберите хотя бы один допустимый тип заказа');
  }
  return MENU_FULFILLMENT_TYPES.filter((item) => requested.has(item));
};

const STORAGE_DURATION_UNITS = new Set(['hours', 'days', 'months']);
const cleanStorageConditions = (value) => {
  if (value === undefined) return undefined;
  if (value === null) return [];
  if (!Array.isArray(value) || value.length > 2) {
    throw menuError('Условия хранения заданы некорректно');
  }

  return value
    .map((raw, index) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw menuError(`Условие хранения ${index + 1} задано некорректно`);
      }
      const temperature = cleanText(raw.temperature, 40);
      const rawDuration = raw.duration_value ?? raw.durationValue;
      const durationUnit = cleanText(raw.duration_unit ?? raw.durationUnit, 16).toLowerCase();
      const hasDuration = rawDuration !== undefined && rawDuration !== null && rawDuration !== '';
      const isEmpty = !temperature && !hasDuration && !durationUnit;
      if (isEmpty || !temperature || !hasDuration || !durationUnit) return null;
      if (!STORAGE_DURATION_UNITS.has(durationUnit)) {
        throw menuError(`Выберите единицу срока хранения ${index + 1}`);
      }
      return {
        temperature,
        duration_value: cleanInteger(rawDuration, `срок хранения ${index + 1}`, {
          minimum: 1,
          maximum: 10000,
        }),
        duration_unit: durationUnit,
      };
    })
    .filter(Boolean);
};

const productFactsInput = (product = {}) => {
  const result = {};
  if (product.ingredients !== undefined)
    result.ingredients = cleanText(product.ingredients, 3000) || null;
  const ingredientTranslations = cleanTranslations(product.ingredients_translations, 3000);
  if (ingredientTranslations !== undefined)
    result.ingredients_translations = ingredientTranslations;
  for (const [field, label, maximumItems] of [
    ['allergens', 'аллергены', 30],
    ['dietary_tags', 'диетические метки', 30],
    ['search_keywords', 'ключевые слова', 50],
  ]) {
    const list = cleanTextList(product[field], label, { maximumItems });
    if (list !== undefined) result[field] = list;
  }
  if (product.weight_grams !== undefined) {
    result.weight_grams =
      product.weight_grams === null || product.weight_grams === ''
        ? null
        : cleanInteger(product.weight_grams, 'вес', { minimum: 1, maximum: 100000 });
  }
  for (const [field, label] of [
    ['calories_kcal', 'калорийность'],
    ['protein_grams', 'белки'],
    ['fat_grams', 'жиры'],
    ['carbs_grams', 'углеводы'],
  ]) {
    const value = cleanDecimal(product[field], label);
    if (value !== undefined) result[field] = value;
  }
  const storageConditions = cleanStorageConditions(product.storage_conditions);
  if (storageConditions !== undefined) result.storage_conditions = storageConditions;
  return result;
};

const productOverrideInput = (overrides = {}) => {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) {
    throw menuError('Некорректные настройки товара');
  }
  const result = {};
  if (overrides.custom_name !== undefined)
    result.custom_name = cleanText(overrides.custom_name, 160) || null;
  if (overrides.custom_description !== undefined)
    result.custom_description = cleanText(overrides.custom_description, 2000) || null;
  if (overrides.custom_image_url !== undefined)
    result.custom_image_url = cleanUrl(overrides.custom_image_url);
  if (overrides.custom_price !== undefined) {
    result.custom_price =
      overrides.custom_price === null || overrides.custom_price === ''
        ? null
        : cleanInteger(overrides.custom_price, 'цена', { minimum: 1 });
  }
  if (overrides.preparation_minutes !== undefined) {
    result.preparation_minutes =
      overrides.preparation_minutes === null || overrides.preparation_minutes === ''
        ? null
        : cleanInteger(overrides.preparation_minutes, 'время приготовления', {
            minimum: 1,
            maximum: 240,
          });
  }
  for (const key of ['is_hidden', 'is_stop_listed']) {
    if (overrides[key] !== undefined) {
      if (typeof overrides[key] !== 'boolean') throw menuError(`Поле ${key} должно быть boolean`);
      result[key] = overrides[key];
    }
  }
  if (overrides.sort_order !== undefined)
    result.sort_order = cleanInteger(overrides.sort_order, 'порядок', { maximum: 1000000 });
  const fulfillmentTypes = cleanFulfillmentTypes(overrides.fulfillment_types);
  if (fulfillmentTypes !== undefined) result.fulfillment_types = fulfillmentTypes;
  const names = cleanTranslations(overrides.name_translations, 160);
  const descriptions = cleanTranslations(overrides.description_translations, 2000);
  if (names !== undefined) result.name_translations = names;
  if (descriptions !== undefined) result.description_translations = descriptions;
  return { ...result, ...productFactsInput(overrides) };
};

const categoryOverrideInput = (overrides = {}) => {
  const result = productOverrideInput(overrides);
  for (const key of [
    'custom_description',
    'custom_price',
    'description_translations',
    'is_stop_listed',
    'preparation_minutes',
    'fulfillment_types',
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
  ]) {
    delete result[key];
  }
  return result;
};

const customProductInput = (product = {}) => {
  if (!product || typeof product !== 'object' || Array.isArray(product)) {
    throw menuError('Некорректный товар');
  }
  const result = {
    name: cleanText(product.name, 160, true),
    description: cleanText(product.description, 2000),
    price: cleanInteger(product.price, 'цена', { minimum: 1 }),
    category_name: cleanText(product.category_name, 160, true),
    image_url: cleanUrl(product.image_url),
    is_available: product.is_available !== false,
    sort_order: cleanInteger(product.sort_order ?? 0, 'порядок', { maximum: 1000000 }),
    preparation_minutes:
      product.preparation_minutes === null || product.preparation_minutes === undefined
        ? null
        : cleanInteger(product.preparation_minutes, 'время приготовления', {
            minimum: 1,
            maximum: 240,
          }),
    fulfillment_types: cleanFulfillmentTypes(product.fulfillment_types) || [
      ...MENU_FULFILLMENT_TYPES,
    ],
    ...productFactsInput(product),
    updated_at: new Date(),
  };
  if (product.is_available !== undefined && typeof product.is_available !== 'boolean') {
    throw menuError('Поле is_available должно быть boolean');
  }
  if (product.id !== undefined && product.id !== null) {
    const id = String(product.id);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
      throw menuError('Некорректный id товара');
    }
    result.id = id;
  }
  return result;
};

class MenuService {
  /**
   * Получает все оверрайды товаров
   */
  async getProductOverrides({ strict = false } = {}) {
    const { data, error } = await supabase.from('menu_overrides').select('*');
    if (error) {
      if (strict) throw new Error('Ошибка при получении оверрайдов товаров: ' + error.message);
      console.error('Ошибка при получении оверрайдов товаров:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Сохраняет оверрайд для товара
   */
  async setProductOverride(iikoProductId, overrides) {
    const id = cleanId(iikoProductId, 'iikoProductId');
    const input = productOverrideInput(overrides);
    const { error } = await supabase.from('menu_overrides').upsert(
      {
        iiko_product_id: id,
        ...input,
        updated_at: new Date(),
      },
      { onConflict: 'iiko_product_id' },
    );
    if (error) throw new Error('Ошибка сохранения настроек товара: ' + error.message);
  }

  /**
   * Получает все оверрайды категорий
   */
  async getCategoryOverrides({ strict = false } = {}) {
    const { data, error } = await supabase.from('menu_category_overrides').select('*');
    if (error) {
      if (strict) throw new Error('Ошибка при получении оверрайдов категорий: ' + error.message);
      console.error('Ошибка при получении оверрайдов категорий:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Сохраняет оверрайд для категории
   */
  async setCategoryOverride(iikoCategoryId, overrides) {
    const id = cleanId(iikoCategoryId, 'iikoCategoryId');
    const input = categoryOverrideInput(overrides);
    const { error } = await supabase.from('menu_category_overrides').upsert(
      {
        iiko_category_id: id,
        ...input,
        updated_at: new Date(),
      },
      { onConflict: 'iiko_category_id' },
    );
    if (error) throw new Error('Ошибка сохранения настроек категории: ' + error.message);
  }

  /**
   * Получает все кастомные товары
   */
  async getCustomProducts({ strict = false } = {}) {
    const { data, error } = await supabase
      .from('custom_products')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      if (strict) throw new Error('Ошибка при получении кастомных товаров: ' + error.message);
      console.error('Ошибка при получении кастомных товаров:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Добавляет или обновляет кастомный товар
   */
  async upsertCustomProduct(product) {
    const input = customProductInput(product);
    const { error } = await supabase.from('custom_products').upsert(input);
    if (error) throw new Error('Ошибка сохранения кастомного товара: ' + error.message);
  }

  /**
   * Удаляет кастомный товар
   */
  async deleteCustomProduct(id) {
    const normalized = String(id || '');
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(normalized)
    ) {
      throw menuError('Некорректный id товара');
    }
    const { error } = await supabase.from('custom_products').delete().eq('id', normalized);
    if (error) throw new Error('Ошибка удаления кастомного товара: ' + error.message);
  }
}

module.exports = new MenuService();

const { supabase } = require('../config/supabase');

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
  for (const key of ['is_hidden', 'is_stop_listed']) {
    if (overrides[key] !== undefined) {
      if (typeof overrides[key] !== 'boolean') throw menuError(`Поле ${key} должно быть boolean`);
      result[key] = overrides[key];
    }
  }
  if (overrides.sort_order !== undefined)
    result.sort_order = cleanInteger(overrides.sort_order, 'порядок', { maximum: 1000000 });
  const names = cleanTranslations(overrides.name_translations, 160);
  const descriptions = cleanTranslations(overrides.description_translations, 2000);
  if (names !== undefined) result.name_translations = names;
  if (descriptions !== undefined) result.description_translations = descriptions;
  return result;
};

const categoryOverrideInput = (overrides = {}) => {
  const result = productOverrideInput(overrides);
  for (const key of [
    'custom_description',
    'custom_price',
    'description_translations',
    'is_stop_listed',
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
    const { error } = await supabase.from('menu_overrides').upsert(
      {
        iiko_product_id: id,
        ...productOverrideInput(overrides),
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
    const { error } = await supabase.from('menu_category_overrides').upsert(
      {
        iiko_category_id: id,
        ...categoryOverrideInput(overrides),
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
    const { error } = await supabase.from('custom_products').upsert(customProductInput(product));
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

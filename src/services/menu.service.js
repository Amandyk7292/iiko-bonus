const { supabase } = require('../config/supabase');

class MenuService {
  /**
   * Получает все оверрайды товаров
   */
  async getProductOverrides() {
    const { data, error } = await supabase.from('menu_overrides').select('*');
    if (error) {
      console.error('Ошибка при получении оверрайдов товаров:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Сохраняет оверрайд для товара
   */
  async setProductOverride(iikoProductId, overrides) {
    const { error } = await supabase.from('menu_overrides').upsert(
      {
        iiko_product_id: iikoProductId,
        ...overrides,
        updated_at: new Date(),
      },
      { onConflict: 'iiko_product_id' },
    );
    if (error) throw new Error('Ошибка сохранения настроек товара: ' + error.message);
  }

  /**
   * Получает все оверрайды категорий
   */
  async getCategoryOverrides() {
    const { data, error } = await supabase.from('menu_category_overrides').select('*');
    if (error) {
      console.error('Ошибка при получении оверрайдов категорий:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Сохраняет оверрайд для категории
   */
  async setCategoryOverride(iikoCategoryId, overrides) {
    const { error } = await supabase.from('menu_category_overrides').upsert(
      {
        iiko_category_id: iikoCategoryId,
        ...overrides,
        updated_at: new Date(),
      },
      { onConflict: 'iiko_category_id' },
    );
    if (error) throw new Error('Ошибка сохранения настроек категории: ' + error.message);
  }

  /**
   * Получает все кастомные товары
   */
  async getCustomProducts() {
    const { data, error } = await supabase
      .from('custom_products')
      .select('*')
      .order('sort_order', { ascending: true });
    if (error) {
      console.error('Ошибка при получении кастомных товаров:', error.message);
      return [];
    }
    return data || [];
  }

  /**
   * Добавляет или обновляет кастомный товар
   */
  async upsertCustomProduct(product) {
    const { error } = await supabase.from('custom_products').upsert(product);
    if (error) throw new Error('Ошибка сохранения кастомного товара: ' + error.message);
  }

  /**
   * Удаляет кастомный товар
   */
  async deleteCustomProduct(id) {
    const { error } = await supabase.from('custom_products').delete().eq('id', id);
    if (error) throw new Error('Ошибка удаления кастомного товара: ' + error.message);
  }
}

module.exports = new MenuService();

const fetch = require('node-fetch');
const { supabase } = require('../config/supabase');

const KASPI_URL = process.env.KASPI_MICROSERVICE_URL || `http://127.0.0.1:${process.env.PORT || 3000}/kaspi-pos`;

const digitsOnly = (value) => String(value ?? '').replace(/\D/g, '');

const normalizeKaspiPhoneNumber = (value) => {
  const digits = digitsOnly(value);

  if (digits.length === 10) return `7${digits}`;
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 11 && digits.startsWith('8')) return `7${digits.slice(1)}`;

  return null;
};

class KaspiService {
  /**
   * Отправляет запрос на микросервис Kaspi для создания счета
   */
  async createInvoice(phone, amount, customerId, cartItems = []) {
    const normalizedPhone = normalizeKaspiPhoneNumber(phone);
    if (!normalizedPhone) throw new Error('Invalid phoneNumber format');

    // 1. Создаем счет через микросервис Kaspi
    const response = await fetch(`${KASPI_URL}/api/invoice/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Заголовки сессии (если они хранятся централизованно на бэкенде, 
        // их нужно передавать сюда. Для простоты предполагается, 
        // что микросервис сам может хранить сессию, если его так настроить, 
        // либо мы передаем заглушку, которую нужно заменить на реальные данные)
        'x-token-sn': process.env.KASPI_TOKEN_SN || '',
        'x-profile-id': process.env.KASPI_PROFILE_ID || '',
        'x-vtoken-secret': process.env.KASPI_VTOKEN_SECRET || '',
      },
      body: JSON.stringify({
        phoneNumber: normalizedPhone,
        amount: amount,
        comment: 'Оплата заказа Bulka',
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Kaspi Service Error: ${err}`);
    }

    const data = await response.json();
    
    if (!data.Data || !data.Data.Id) {
      throw new Error('Не удалось получить operationId от Kaspi');
    }

    const operationId = data.Data.Id;

    // 2. Сохраняем заказ в БД
    const { error } = await supabase.from('kaspi_orders').insert([
      {
        customer_id: customerId,
        operation_id: String(operationId),
        phone: normalizedPhone,
        amount: amount,
        status: 'pending',
        cart_items: cartItems,
      },
    ]);

    if (error) {
      console.error('Ошибка сохранения kaspi_orders в БД:', error);
      // Мы не прерываем выполнение, так как счет уже отправлен клиенту
    }

    return {
      success: true,
      operationId: operationId,
      kaspiResponse: data,
    };
  }

  /**
   * Получение статуса заказа из нашей БД
   */
  async getOrderStatus(operationId) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .select('*')
      .eq('operation_id', String(operationId))
      .maybeSingle();

    if (error) throw new Error('DB Error: ' + error.message);
    if (!data) return { status: 'not_found' };

    return data;
  }

  /**
   * Обновление статуса заказа (вызывается из вебхука)
   */
  async updateOrderStatus(operationId, newStatus) {
    const { data, error } = await supabase
      .from('kaspi_orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('operation_id', String(operationId))
      .select()
      .maybeSingle();

    if (error) {
      console.error('Ошибка обновления kaspi_orders:', error);
      throw error;
    }
    
    return data;
  }
}

module.exports = new KaspiService();

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

    let comment = 'Оплата заказа Bulka';
    if (cartItems && cartItems.length > 0) {
      const itemsList = cartItems.map(item => `${item.name} x${item.quantity}`).join(', ');
      comment += `\n${itemsList}`;
    }

    // 1. Создаем счет через микросервис Kaspi
    const response = await fetch(`${KASPI_URL}/api/invoice/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phoneNumber: normalizedPhone,
        amount: amount,
        comment: comment,
      }),
    });

    let data;
    if (response.ok) {
      data = await response.json();
    } else {
      const err = await response.text();
      data = { ErrorMessage: err };
    }
    
    let operationId = data?.Data?.Id || data?.Data?.QrOperationId;

    // Если нет operationId, это значит счет выставить не удалось (например, нет Kaspi у клиента).
    // FALLBACK: Пробуем сгенерировать QR-код!
    if (!operationId) {
      console.log('Invoice creation failed, falling back to QR code...', data);
      const qrResponse = await fetch(`${KASPI_URL}/api/qr/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: amount, comment: comment }),
      });

      if (!qrResponse.ok) {
        const qrErr = await qrResponse.text();
        throw new Error(`Kaspi QR Service Error: ${qrErr}`);
      }

      const qrData = await qrResponse.json();
      operationId = qrData?.Data?.Id || qrData?.Data?.QrOperationId;
      const qrToken = qrData?.Data?.QrToken;

      if (!qrData.Data || !operationId || !qrToken) {
        throw new Error('Не удалось получить QR-код от Kaspi: ' + JSON.stringify(qrData));
      }

      // Сохраняем QR-заказ в БД
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

      if (error) console.error('Ошибка сохранения kaspi_orders в БД:', error);

      return {
        success: true,
        method: 'qr',
        operationId: operationId,
        qrToken: qrToken,
        kaspiResponse: qrData,
      };
    }

    // Если счет (invoice) успешно выставлен:
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

    if (error) console.error('Ошибка сохранения kaspi_orders в БД:', error);

    return {
      success: true,
      method: 'invoice',
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

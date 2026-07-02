const { supabase } = require('./supabase');

/**
 * Получение клиента по номеру телефона
 * Если клиента нет, он создается с балансом 0
 */
async function getOrCreateCustomerByPhone(phone, name = 'Новый Гость') {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  
  // Ищем клиента в таблице customers
  const { data: existingCustomer, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', cleanPhone)
    .maybeSingle();

  if (fetchError) {
    throw new Error('Error fetching customer: ' + fetchError.message);
  }

  if (!existingCustomer) {
    // Создаем нового клиента
    const newCustomer = {
      phone: cleanPhone,
      balance: 0,
      name: name
    };
    
    const { data: createdCustomer, error: insertError } = await supabase
      .from('customers')
      .insert([newCustomer])
      .select()
      .single();

    if (insertError) {
      throw new Error('Error creating customer: ' + insertError.message);
    }
    
    return createdCustomer;
  }
  
  return existingCustomer;
}

/**
 * Обновление баланса клиента
 */
async function updateCustomerBalance(customerId, amountChange) {
  // Получаем текущий баланс
  const { data: doc, error: fetchError } = await supabase
    .from('customers')
    .select('balance')
    .eq('id', customerId)
    .single();
    
  if (fetchError || !doc) {
    throw new Error('Customer not found');
  }
  
  const newBalance = Number(doc.balance) + Number(amountChange);
  
  // Обновляем баланс
  const { error: updateError } = await supabase
    .from('customers')
    .update({ balance: newBalance })
    .eq('id', customerId);
    
  if (updateError) {
    throw new Error('Error updating balance: ' + updateError.message);
  }
}

/**
 * Запись транзакции
 */
async function logTransaction(transactionData) {
  const { error } = await supabase
    .from('transactions')
    .insert([
      {
        customer_id: transactionData.customerId,
        order_id: transactionData.orderId,
        type: transactionData.type,
        amount: transactionData.amount
      }
    ]);
    
  if (error) {
    console.error('Error logging transaction:', error.message);
  }
}

module.exports = {
  getOrCreateCustomerByPhone,
  updateCustomerBalance,
  logTransaction
};

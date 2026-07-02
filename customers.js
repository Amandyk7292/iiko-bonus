const { supabase } = require('./supabase');

/**
 * Получение клиента по номеру телефона
 * Если клиента нет, он создается с балансом 0
 */
async function getCustomerByPhone(phone) {
  const cleanPhone = phone.replace(/[^0-9+]/g, '');
  const { data: existingCustomer, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', cleanPhone)
    .maybeSingle();

  if (fetchError) throw new Error('Error fetching customer: ' + fetchError.message);
  return existingCustomer;
}

/**
 * Получение клиента по номеру телефона
 * Если клиента нет, он создается с балансом 0
 */
async function getOrCreateCustomerByPhone(phone, name = 'Новый Гость') {
  const existingCustomer = await getCustomerByPhone(phone);

  if (!existingCustomer) {
    const cleanPhone = phone.replace(/[^0-9+]/g, '');
    // Создаем нового клиента
    const newCustomer = {
      phone: cleanPhone,
      balance: 0,
      total_spent: 0,
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
 * Запись транзакции и обновление total_spent, если это покупка (deposit)
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

  // Обновляем total_spent при покупке (даже если клиент расплачивается бонусами, мы можем добавлять к total_spent только реально потраченные деньги)
  if (transactionData.type === 'deposit' && transactionData.orderTotal) {
    // В transactionData мы будем передавать orderTotal как "реально уплаченные деньги" (orderTotal - discountAmount)
    const { data: doc } = await supabase
      .from('customers')
      .select('total_spent')
      .eq('id', transactionData.customerId)
      .single();

    if (doc) {
      const newTotalSpent = Number(doc.total_spent || 0) + Number(transactionData.orderTotal);
      await supabase
        .from('customers')
        .update({ total_spent: newTotalSpent })
        .eq('id', transactionData.customerId);
    }
  }
}

// ==========================================
// ФУНКЦИИ ДЛЯ CRM И АДМИН-ПАНЕЛИ
// ==========================================

async function getAllCustomers() {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

async function getTransactions() {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, customers(phone, name)')
    .order('timestamp', { ascending: false })
    .limit(100);
  if (error) throw new Error(error.message);
  return data;
}

async function getStats() {
  const { data: customers } = await supabase.from('customers').select('balance, total_spent, created_at');
  let totalIssued = 0;
  let totalSpent = 0;
  let newCustomersLast30Days = 0;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));

  if (customers) {
    customers.forEach(c => {
      totalSpent += Number(c.total_spent || 0);
      totalIssued += Number(c.balance || 0);
      if (c.created_at && new Date(c.created_at) >= thirtyDaysAgo) {
        newCustomersLast30Days++;
      }
    });
  }

  const { data: txs } = await supabase.from('transactions').select('type, amount, timestamp');
  let totalBurned = 0;
  let totalEarned = 0;
  let earnedLast30Days = 0;
  let burnedLast30Days = 0;

  if (txs) {
    txs.forEach(t => {
      const amt = Number(t.amount || 0);
      const isRecent = t.timestamp && new Date(t.timestamp) >= thirtyDaysAgo;
      if (t.type === 'withdrawal' || t.type === 'manual_withdrawal') {
        totalBurned += amt;
        if (isRecent) burnedLast30Days += amt;
      }
      if (t.type === 'deposit' || t.type === 'manual_deposit' || t.type === 'manual') {
        totalEarned += amt;
        if (isRecent) earnedLast30Days += amt;
      }
    });
  }

  const totalGrossRevenue = totalSpent + totalBurned;
  const bonusPaymentPercent = totalGrossRevenue > 0 ? ((totalBurned / totalGrossRevenue) * 100).toFixed(1) : "0.0";

  return {
    totalCustomers: customers ? customers.length : 0,
    newCustomersLast30Days,
    totalSales: totalSpent,
    totalEarned,
    totalBurned,
    earnedLast30Days,
    burnedLast30Days,
    bonusPaymentPercent,
    currentLiabilities: totalIssued
  };
}

async function addManualBonus(customerId, amount, reason) {
  await updateCustomerBalance(customerId, amount);
  await logTransaction({ 
    customerId, 
    orderId: 'MANUAL', 
    type: amount >= 0 ? 'manual_deposit' : 'manual_withdrawal', 
    amount: Math.abs(amount) 
  });
}

async function searchCustomers(query) {
  const cleanPhoneQuery = query.replace(/[^0-9+]/g, '');
  
  // Создаем строку для .or()
  let orQuery = `name.ilike.%${query}%`;
  if (cleanPhoneQuery.length > 0) {
    orQuery += `,phone.ilike.%${cleanPhoneQuery}%`;
  }

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(orQuery)
    .limit(10);

  if (error) throw new Error(error.message);
  return data;
}

async function updateCustomerInfo(customerId, { name, phone, balance, total_spent }) {
  const updates = {};
  if (name !== undefined && name !== null) updates.name = name;
  if (phone !== undefined && phone !== null) updates.phone = phone;
  if (balance !== undefined && balance !== null) updates.balance = Number(balance);
  if (total_spent !== undefined && total_spent !== null) updates.total_spent = Number(total_spent);

  const { error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', customerId);
  if (error) throw new Error(error.message);
}

module.exports = {
  getCustomerByPhone,
  getOrCreateCustomerByPhone,
  searchCustomers,
  updateCustomerBalance,
  updateCustomerInfo,
  logTransaction,
  getAllCustomers,
  getTransactions,
  getStats,
  addManualBonus
};

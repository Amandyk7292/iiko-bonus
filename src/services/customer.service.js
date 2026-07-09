const { supabase } = require('../config/supabase');
const { sendPushNotification } = require('./push.service');
const crypto = require('crypto');

/**
 * Генерирует секретный идентификатор карты для Google/Apple Wallet
 */
function getSecretWalletCardNumber(customer) {
  if (!customer || !customer.id) return 'CARD-UNKNOWN';
  const secret = process.env.BULKA_SECRET;
  if (!secret) throw new Error('BULKA_SECRET is required');
  const secretString = `${customer.id}:${customer.phone}:${secret}`;
  const hash = crypto.createHash('sha256').update(secretString).digest('hex').slice(0, 10).toUpperCase();
  return `CARD-${customer.id}-${hash}`;
}

/**
 * Получение клиента по номеру телефона
 * Если клиента нет, он создается с балансом 0
 */
async function getCustomerByPhone(phone) {
  const digitsOnly = phone.replace(/[^0-9]/g, '');
  
  // 1. Попытка точного совпадения (по исходной строке)
  let { data: customers, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .order('balance', { ascending: false })
    .limit(1);
    
  if (customers && customers.length > 0) return customers[0];

  // 2. Попытка точного совпадения (только цифры)
  ({ data: customers, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', digitsOnly)
    .order('balance', { ascending: false })
    .limit(1));
    
  if (customers && customers.length > 0) return customers[0];
  
  // 3. Попытка точного совпадения (с плюсом)
  ({ data: customers, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', '+' + digitsOnly)
    .order('balance', { ascending: false })
    .limit(1));
    
  if (customers && customers.length > 0) return customers[0];

  // 4. Поиск по последним 10 цифрам (ilike) как запасной вариант
  const searchPattern = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;
  ({ data: customers, error: fetchError } = await supabase
    .from('customers')
    .select('*')
    .ilike('phone', `%${searchPattern}%`)
    .order('balance', { ascending: false })
    .limit(1));

  if (fetchError) throw new Error('Error fetching customer: ' + fetchError.message);
  return customers && customers.length > 0 ? customers[0] : null;
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
  const { data, error } = await supabase.rpc('increment_customer_balance', {
    p_customer_id: customerId,
    p_amount_change: Number(amountChange)
  });

  if (error) throw new Error('Error updating balance atomically: ' + error.message);
  if (!data || data.length === 0) throw new Error('Customer not found');
  return data[0];
}

async function applyLoyaltyTransaction({ customerId, orderId, discountAmount, earnedBonus, orderTotal, realMoneyPaid, activationDelayDays = 0, items = null }) {
  const { data, error } = await supabase.rpc('apply_loyalty_transaction', {
    p_customer_id: customerId,
    p_order_id: String(orderId),
    p_discount_amount: Number(discountAmount || 0),
    p_earned_bonus: Number(earnedBonus || 0),
    p_order_total: Number(orderTotal || 0),
    p_real_money_paid: Number(realMoneyPaid || 0),
    p_activation_delay_days: Number(activationDelayDays || 0),
    p_items: items ? items : null
  });

  if (error) throw new Error('Error applying loyalty transaction: ' + error.message);
  if (!data) throw new Error('Empty loyalty transaction result');
  return Array.isArray(data) ? data[0] : data;
}

async function activatePendingBonuses() {
  const { data, error } = await supabase.rpc('activate_pending_bonus_transactions');
  if (error) throw new Error('Error activating pending bonuses: ' + error.message);
  return data || { activated_count: 0, activated_amount: 0 };
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
        amount: transactionData.amount,
        order_total: transactionData.orderTotal || null,
        description: transactionData.description || null,
        items: transactionData.items || null
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
      if (t.type === 'withdrawal' || t.type === 'manual_withdrawal' || t.type === 'expiration') {
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
  if (!query) return [];
  const trimQuery = query.trim();

  // 1. Проверка динамического 5-минутного QR-кода приложения (TOTP)
  if (trimQuery.startsWith('BULKA-OTP-')) {
    const parts = trimQuery.split('-');
    // BULKA, OTP, phone, timeWindow, hash
    if (parts.length >= 5) {
      const phone = parts[2];
      const timeWindow = parseInt(parts[3], 10);
      const hash = parts[4];
      const currentWindow = Math.floor(Date.now() / 300000); // 300000 ms = 5 minutes
      
      if (isNaN(timeWindow) || Math.abs(currentWindow - timeWindow) > 1) {
        throw new Error('Срок действия QR-кода истек. Попросите гостя обновить QR-код в приложении.');
      }
      
      const secret = process.env.BULKA_SECRET;
      if (!secret) throw new Error('BULKA_SECRET is required');
      const expectedHash = crypto.createHash('sha256').update(`${phone}:${timeWindow}:${secret}`).digest('hex').slice(0, 8);
      if (hash !== expectedHash) {
        throw new Error('Недействительный или поддельный QR-код.');
      }
      
      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .ilike('phone', `%${phone.slice(-10)}%`)
        .limit(1);
      if (error || !data || data.length === 0) throw new Error('Клиент по динамическому коду не найден');
      return data;
    }
  }

  // 2. Проверка зашифрованной карты Wallet (CARD-UUID-HASH)
  if (trimQuery.startsWith('CARD-')) {
    const lastDash = trimQuery.lastIndexOf('-');
    if (lastDash > 5) {
      const customerId = trimQuery.slice(5, lastDash);
      const hashSuffix = trimQuery.slice(lastDash + 1);
      
      const { data: customer, error } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
        
      if (!error && customer) {
        const secret = process.env.BULKA_SECRET;
        if (!secret) throw new Error('BULKA_SECRET is required');
        const expectedSuffix = crypto.createHash('sha256').update(`${customer.id}:${customer.phone}:${secret}`).digest('hex').slice(0, 10).toUpperCase();
        if (hashSuffix === expectedSuffix) {
          return [customer];
        }
      }
      throw new Error('Недействительная карта лояльности Wallet.');
    }
  }

  // 3. Обычный поиск по имени или телефону
  const digitsOnly = query.replace(/[^0-9]/g, '');
  const searchPattern = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : query.replace(/[^0-9+]/g, '');
  
  // Создаем строку для .or()
  let orQuery = `name.ilike.%${query}%`;
  if (searchPattern.length > 0) {
    orQuery += `,phone.ilike.%${searchPattern}%`;
  }

  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .or(orQuery)
    .order('balance', { ascending: false })
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

async function updateFcmToken(phone, fcmToken) {
  if (!phone || !fcmToken) return false;
  const digits = phone.replace(/[^0-9]/g, '');
  const searchPattern = digits.length >= 10 ? digits.slice(-10) : digits;
  const { error } = await supabase
    .from('customers')
    .update({ fcm_token: fcmToken })
    .ilike('phone', `%${searchPattern}%`);
  if (error) console.error("Error updating FCM token:", error.message);
  return !error;
}

/**
 * Автоматическое сгорание баллов у неактивных клиентов (> inactivityDays дней, например 90)
 */
async function checkAndExpireInactiveBonuses(inactivityDays = 90) {
  // 1. Получаем всех клиентов с положительным балансом
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .gt('balance', 0);

  if (error || !customers) {
    console.error('Error fetching customers for bonus expiration:', error?.message);
    return { expiredCount: 0, totalExpiredAmount: 0 };
  }

  // 2. Получаем последние транзакции для каждого из этих клиентов
  const { data: txs } = await supabase
    .from('transactions')
    .select('customer_id, timestamp')
    .order('timestamp', { ascending: false });

  const latestTxMap = {};
  if (txs) {
    txs.forEach(t => {
      if (!latestTxMap[t.customer_id]) {
        latestTxMap[t.customer_id] = new Date(t.timestamp);
      }
    });
  }

  const now = new Date();
  const cutoffTime = now.getTime() - (inactivityDays * 24 * 60 * 60 * 1000);
  let expiredCount = 0;
  let totalExpiredAmount = 0;

  for (const c of customers) {
    const lastActivityDate = latestTxMap[c.id] || (c.created_at ? new Date(c.created_at) : new Date(0));
    
    if (lastActivityDate.getTime() < cutoffTime) {
      const expiredAmt = Number(c.balance);
      if (expiredAmt > 0) {
        // Списываем баланс до нуля
        const { error: updateErr } = await supabase
          .from('customers')
          .update({ balance: 0 })
          .eq('id', c.id);

        if (!updateErr) {
          // Записываем транзакцию в историю
          await logTransaction({
            customerId: c.id,
            orderId: 'EXPIRED_90_DAYS',
            type: 'expiration',
            amount: expiredAmt
          });
          expiredCount++;
          totalExpiredAmount += expiredAmt;
          console.log(`Expired ${expiredAmt} bonuses for inactive customer ${c.name || c.phone} (inactive since ${lastActivityDate.toISOString()})`);
        }
      }
    }
  }

  return { expiredCount, totalExpiredAmount };
}

/**
 * Автоматическое уведомление клиентов, которые не приходили более N дней (по умолчанию 30 дней)
 */
async function checkAndNotifyInactiveCustomers(inactivityDays = 30) {
  // 1. Получаем клиентов с балансом > 0
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .gt('balance', 0);

  if (error || !customers) {
    console.error('Error fetching customers for churn reminders:', error?.message);
    return { notifiedCount: 0, totalNotifiedBalance: 0 };
  }

  // 2. Получаем все транзакции, чтобы определить последнюю активность и последние напоминания
  const { data: txs } = await supabase
    .from('transactions')
    .select('customer_id, type, timestamp')
    .order('timestamp', { ascending: false });

  const latestActivityMap = {};
  const latestReminderMap = {};

  if (txs) {
    txs.forEach(t => {
      if (t.type === 'churn_reminder') {
        if (!latestReminderMap[t.customer_id]) {
          latestReminderMap[t.customer_id] = new Date(t.timestamp);
        }
      } else if (t.type !== 'expiration') {
        if (!latestActivityMap[t.customer_id]) {
          latestActivityMap[t.customer_id] = new Date(t.timestamp);
        }
      }
    });
  }

  const now = new Date();
  const cutoffTime = now.getTime() - (inactivityDays * 24 * 60 * 60 * 1000);
  const expireCutoffTime = now.getTime() - (90 * 24 * 60 * 60 * 1000); // 90 дней, после которых баллы сгорают
  const reminderCooldown = now.getTime() - (30 * 24 * 60 * 60 * 1000); // Не отправлять чаще 1 раза в 30 дней

  let notifiedCount = 0;
  let totalNotifiedBalance = 0;

  const { sendMessage } = require('./telegram.service');

  for (const c of customers) {
    const lastActivityDate = latestActivityMap[c.id] || (c.created_at ? new Date(c.created_at) : new Date(0));
    const lastReminderDate = latestReminderMap[c.id] ? new Date(latestReminderMap[c.id]) : null;
    
    // Если клиент был неактивен дольше 30 дней, но еще не дольше 90 дней (когда баллы уже сгорели)
    if (lastActivityDate.getTime() < cutoffTime && lastActivityDate.getTime() >= expireCutoffTime) {
      // Проверяем, что напоминание не отправлялось в последние 30 дней
      if (!lastReminderDate || lastReminderDate.getTime() < reminderCooldown) {
        const daysInactive = Math.floor((now.getTime() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000));
        const daysLeft = Math.max(1, 90 - daysInactive);
        
        const message = `Вы давно не заглядывали к нам! На вашем счету <b>${c.balance} бонусов</b>, они сгорят через ${daysLeft} дней.\n\nЗагляните к нам за свежей выпечкой и ароматным кофе!`;
        
        try {
          const { sendMessage } = require('./telegram.service');
          const { sendPushNotification } = require('./push.service');
          if (c.telegram_id) await sendMessage(c.telegram_id, message).catch(() => {});
          if (c.fcm_token) await sendPushNotification(c.fcm_token, "Мы скучаем! Ваши бонусы скоро сгорят", `На счету ${c.balance} бонусов, они сгорят через ${daysLeft} дней. Загляните к нам за кофе!`).catch(() => {});
          
          await logTransaction({
            customerId: c.id,
            orderId: 'REMINDER_30_DAYS',
            type: 'churn_reminder',
            amount: 0,
            description: `Отправлено напоминание о сгорании ${c.balance} бонусов`
          });
          
          notifiedCount++;
          totalNotifiedBalance += Number(c.balance);
          console.log(`Sent churn reminder to ${c.name || c.phone} (inactive ${daysInactive} days, balance ${c.balance})`);
          await new Promise(r => setTimeout(r, 100)); // Задержка для защиты от лимитов Telegram
        } catch (err) {
          console.error(`Failed to send churn reminder to ${c.phone}:`, err.message);
        }
      }
    }
  }

  return { notifiedCount, totalNotifiedBalance };
}

/**
 * Удаление клиента и всех его транзакций
 */
async function deleteCustomer(customerId) {
  // Сначала удаляем все транзакции клиента, чтобы не было ошибки внешнего ключа (foreign key constraint)
  await supabase.from('transactions').delete().eq('customer_id', customerId);
  
  // Затем удаляем самого клиента
  const { error } = await supabase.from('customers').delete().eq('id', customerId);
  if (error) throw new Error(error.message);
  return true;
}

async function checkAndNotifyBirthdays() {
  const { sendPushNotification } = require('./push.service');
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentDay = now.getDate();

  // Ищем клиентов, у которых сегодня день рождения (нужно разобрать birthdate: YYYY-MM-DD или DD.MM.YYYY)
  const { data: customers, error } = await supabase.from('customers').select('*').not('birthdate', 'is', null);
  if (error || !customers) return;

  for (const c of customers) {
    if (!c.birthdate) continue;
    let bMonth, bDay;
    if (c.birthdate.includes('-')) {
      // YYYY-MM-DD
      const parts = c.birthdate.split('-');
      if (parts.length === 3) {
        bMonth = parseInt(parts[1], 10);
        bDay = parseInt(parts[2], 10);
      }
    } else if (c.birthdate.includes('.')) {
      // DD.MM.YYYY
      const parts = c.birthdate.split('.');
      if (parts.length === 3) {
        bDay = parseInt(parts[0], 10);
        bMonth = parseInt(parts[1], 10);
      }
    }

    if (bMonth === currentMonth && bDay === currentDay) {
      if (c.fcm_token) {
        await sendPushNotification(c.fcm_token, "С днём рождения!", "Поздравляем с днём рождения! Заходите к нам за праздничным кофе и выпечкой!");
      }
    }
  }
}

async function activatePendingBonusesSafe() {
  try {
    const result = await activatePendingBonuses();
    const count = Number(result?.activated_count || 0);
    if (count > 0) {
      console.log(`Activated ${count} pending bonus transaction(s).`);
    }
  } catch (e) {
    console.error('Failed to activate pending bonuses:', e);
  }
}

module.exports = {
  activatePendingBonusesSafe,
  checkAndNotifyBirthdays,
  getCustomerByPhone,
  getOrCreateCustomerByPhone,
  searchCustomers,
  updateCustomerBalance,
  updateCustomerInfo,
  logTransaction,
  getAllCustomers,
  getTransactions,
  getStats,
  addManualBonus,
  checkAndExpireInactiveBonuses,
  checkAndNotifyInactiveCustomers,
  deleteCustomer,
  updateFcmToken,
  getSecretWalletCardNumber,
  applyLoyaltyTransaction,
  activatePendingBonuses
};

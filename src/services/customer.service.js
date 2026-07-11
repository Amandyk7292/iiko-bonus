const { supabase } = require('../config/supabase');
const crypto = require('crypto');

/**
 * Генерирует секретный идентификатор карты для Google/Apple Wallet
 */
function getSecretWalletCardNumber(customer) {
  if (!customer?.id || !customer?.phone) {
    throw new Error('A valid customer is required to generate a wallet card number');
  }
  const secret = process.env.BULKA_SECRET;
  if (!secret) throw new Error('BULKA_SECRET is required');
  const hash = crypto
    .createHmac('sha256', secret)
    .update(`${customer.id}:${customer.phone}`)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `CARD-${customer.id}-${hash}`;
}

/**
 * Получение клиента по номеру телефона
 * Если клиента нет, он создается с балансом 0
 */
async function getCustomerByPhone(phone) {
  if (!phone) return null;
  const digitsOnly = phone.replace(/[^0-9]/g, '');
  if (digitsOnly.length < 10) return null;

  // 1. Попытка точного совпадения (по исходной строке)
  let { data: customers } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', phone)
    .order('balance', { ascending: false })
    .limit(1);

  if (customers && customers.length > 0) return customers[0];

  // 2. Попытка точного совпадения (только цифры)
  ({ data: customers } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', digitsOnly)
    .order('balance', { ascending: false })
    .limit(1));

  if (customers && customers.length > 0) return customers[0];

  // 3. Попытка точного совпадения (с плюсом)
  ({ data: customers } = await supabase
    .from('customers')
    .select('*')
    .eq('phone', '+' + digitsOnly)
    .order('balance', { ascending: false })
    .limit(1));

  if (customers && customers.length > 0) return customers[0];

  return null;
}

async function getCustomerById(customerId) {
  const { data, error } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customerId)
    .single();
  if (error) return null;
  return data;
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
      name: name,
    };

    const { data: createdCustomer, error: insertError } = await supabase
      .from('customers')
      .insert([newCustomer])
      .select()
      .single();

    if (insertError) {
      if (insertError.code === '23505') return getCustomerByPhone(cleanPhone);
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
    p_amount_change: Number(amountChange),
  });

  if (error) throw new Error('Error updating balance atomically: ' + error.message);
  if (!data || data.length === 0) throw new Error('Customer not found');
  return data[0];
}

async function applyLoyaltyTransaction({
  customerId,
  orderId,
  discountAmount,
  earnedBonus,
  orderTotal,
  realMoneyPaid,
  activationDelayDays = 0,
  items = null,
}) {
  if (!customerId || !orderId) {
    const validationError = new Error('customerId and orderId are required');
    validationError.statusCode = 400;
    throw validationError;
  }
  const { data, error } = await supabase.rpc('apply_loyalty_transaction', {
    p_customer_id: customerId,
    p_order_id: String(orderId),
    p_discount_amount: Number(discountAmount || 0),
    p_earned_bonus: Number(earnedBonus || 0),
    p_order_total: Number(orderTotal || 0),
    p_real_money_paid: Number(realMoneyPaid || 0),
    p_activation_delay_days: Number(activationDelayDays || 0),
    p_items: items ? items : null,
  });

  if (error) {
    const message = String(error.message || '');
    const transactionError = new Error('Could not apply loyalty transaction');
    if (message.includes('insufficient balance')) {
      transactionError.message = 'Insufficient bonus balance';
      transactionError.statusCode = 409;
    } else if (message.includes('already belongs to another customer')) {
      transactionError.message = 'orderId is already assigned to another customer';
      transactionError.statusCode = 409;
    } else if (message.includes('invalid loyalty transaction values')) {
      transactionError.message = 'Invalid loyalty transaction values';
      transactionError.statusCode = 400;
    } else if (message.includes('order_id is required')) {
      transactionError.message = 'orderId is required';
      transactionError.statusCode = 400;
    }
    throw transactionError;
  }
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
  const { error } = await supabase.from('transactions').insert([
    {
      customer_id: transactionData.customerId,
      order_id: transactionData.orderId,
      type: transactionData.type,
      amount: transactionData.amount,
      order_total: transactionData.orderTotal || null,
      description: transactionData.description || null,
      items: transactionData.items || null,
    },
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
  const { data: customers } = await supabase
    .from('customers')
    .select('balance, total_spent, created_at');
  let totalIssued = 0;
  let totalSpent = 0;
  let newCustomersLast30Days = 0;
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  if (customers) {
    customers.forEach((c) => {
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
    txs.forEach((t) => {
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
  const bonusPaymentPercent =
    totalGrossRevenue > 0 ? ((totalBurned / totalGrossRevenue) * 100).toFixed(1) : '0.0';

  return {
    totalCustomers: customers ? customers.length : 0,
    newCustomersLast30Days,
    totalSales: totalSpent,
    totalEarned,
    totalBurned,
    earnedLast30Days,
    burnedLast30Days,
    bonusPaymentPercent,
    currentLiabilities: totalIssued,
  };
}

async function addManualBonus(customerId, amount, reason) {
  const { data, error } = await supabase.rpc('apply_manual_bonus', {
    p_customer_id: customerId,
    p_amount_change: amount,
    p_reason: reason || null,
  });
  if (error) throw new Error(error.message);
  return data;
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
        throw new Error(
          'Срок действия QR-кода истек. Попросите гостя обновить QR-код в приложении.',
        );
      }

      const secret = process.env.BULKA_SECRET;
      if (!secret) throw new Error('BULKA_SECRET is required');
      const expectedHash = crypto
        .createHmac('sha256', secret)
        .update(`${phone}:${timeWindow}`)
        .digest('hex')
        .slice(0, 16);
      if (hash !== expectedHash) {
        throw new Error('Недействительный или поддельный QR-код.');
      }

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .in('phone', [phone, `+${phone}`])
        .limit(1);
      if (error || !data || data.length === 0)
        throw new Error('Клиент по динамическому коду не найден');
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
        const expectedSuffix = crypto
          .createHmac('sha256', secret)
          .update(`${customer.id}:${customer.phone}`)
          .digest('hex')
          .slice(0, 16)
          .toUpperCase();
        if (hashSuffix === expectedSuffix) {
          return [customer];
        }
      }
      throw new Error('Недействительная карта лояльности Wallet.');
    }
  }

  // 3. Обычный поиск по имени или телефону
  const digitsOnly = query.replace(/[^0-9]/g, '');
  const searchPattern =
    digitsOnly.length >= 10 ? digitsOnly.slice(-10) : query.replace(/[^0-9+]/g, '');

  // Создаем строку для .or()
  const safeQuery = query.replace(/[,()]/g, ' ').slice(0, 160);
  let orQuery = `name.ilike.%${safeQuery}%`;
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

async function updateCustomerInfo(
  customerId,
  { name, last_name, gender, email, region, birth_date, phone, balance, total_spent },
) {
  const updates = {};
  if (name !== undefined && name !== null) updates.name = name;
  if (last_name !== undefined) updates.last_name = last_name;
  if (gender !== undefined) updates.gender = gender;
  if (email !== undefined) updates.email = email;
  if (region !== undefined) updates.region = region;
  if (birth_date !== undefined) updates.birth_date = birth_date || null;
  if (phone !== undefined && phone !== null) updates.phone = phone;
  if (balance !== undefined && balance !== null) updates.balance = Number(balance);
  if (total_spent !== undefined && total_spent !== null) updates.total_spent = Number(total_spent);

  const { error } = await supabase.from('customers').update(updates).eq('id', customerId);
  if (error) throw new Error(error.message);
}

async function updateFcmTokenByCustomerId(customerId, fcmToken, language = null) {
  if (!customerId || !fcmToken) return false;
  const updates = { fcm_token: fcmToken };
  if (language && ['ru', 'kk', 'kz', 'en'].includes(String(language).toLowerCase())) {
    const norm = String(language).toLowerCase() === 'kz' ? 'kk' : String(language).toLowerCase();
    updates.preferred_language = norm;
  }
  const { error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', customerId);
  if (error) {
    // If preferred_language column doesn't exist yet, fallback to updating only fcm_token
    const { error: fallbackErr } = await supabase
      .from('customers')
      .update({ fcm_token: fcmToken })
      .eq('id', customerId);
    if (fallbackErr) throw new Error(fallbackErr.message);
  }
  return true;
}

/**
 * Автоматическое сгорание баллов у неактивных клиентов (> inactivityDays дней, например 90)
 */
async function checkAndExpireInactiveBonuses(inactivityDays = 90) {
  // 1. Получаем всех клиентов с положительным балансом
  const { data: customers, error } = await supabase.from('customers').select('*').gt('balance', 0);

  if (error || !customers) {
    console.error('Error fetching customers for bonus expiration:', error?.message);
    return { expiredCount: 0, totalExpiredAmount: 0 };
  }

  // 2. Получаем последние транзакции для каждого из этих клиентов
  const { data: txs } = await supabase
    .from('transactions')
    .select('customer_id, timestamp')
    .neq('type', 'churn_reminder')
    .order('timestamp', { ascending: false });

  const latestTxMap = {};
  if (txs) {
    txs.forEach((t) => {
      if (!latestTxMap[t.customer_id]) {
        latestTxMap[t.customer_id] = new Date(t.timestamp);
      }
    });
  }

  const now = new Date();
  const cutoffTime = now.getTime() - inactivityDays * 24 * 60 * 60 * 1000;
  let expiredCount = 0;
  let totalExpiredAmount = 0;

  for (const c of customers) {
    const lastActivityDate =
      latestTxMap[c.id] || (c.created_at ? new Date(c.created_at) : new Date(0));

    if (lastActivityDate.getTime() < cutoffTime) {
      const expiredAmt = Number(c.balance);
      if (expiredAmt > 0) {
        const orderId = `EXPIRED_${inactivityDays}_DAYS_${now.toISOString().slice(0, 10)}`;
        const { data: expired, error: updateErr } = await supabase.rpc('expire_customer_bonus', {
          p_customer_id: c.id,
          p_expected_balance: expiredAmt,
          p_order_id: orderId,
        });

        if (!updateErr && Number(expired) > 0) {
          expiredCount++;
          totalExpiredAmount += Number(expired);
        }
      }
    }
  }

  return { expiredCount, totalExpiredAmount };
}

/**
 * Автоматическое уведомление клиентов, которые не приходили более N дней (по умолчанию 30 дней)
 */
async function checkAndNotifyInactiveCustomers(inactivityDays = 30, expirationDays = 90) {
  // 1. Получаем клиентов с балансом > 0
  const { data: customers, error } = await supabase.from('customers').select('*').gt('balance', 0);

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
    txs.forEach((t) => {
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
  const cutoffTime = now.getTime() - inactivityDays * 24 * 60 * 60 * 1000;
  const expireCutoffTime = now.getTime() - expirationDays * 24 * 60 * 60 * 1000;
  const reminderCooldown = now.getTime() - 30 * 24 * 60 * 60 * 1000;

  let notifiedCount = 0;
  let totalNotifiedBalance = 0;

  for (const c of customers) {
    const lastActivityDate =
      latestActivityMap[c.id] || (c.created_at ? new Date(c.created_at) : new Date(0));
    const lastReminderDate = latestReminderMap[c.id] ? new Date(latestReminderMap[c.id]) : null;

    // Если клиент был неактивен дольше 30 дней, но еще не дольше 90 дней (когда баллы уже сгорели)
    if (lastActivityDate.getTime() < cutoffTime && lastActivityDate.getTime() >= expireCutoffTime) {
      // Проверяем, что напоминание не отправлялось в последние 30 дней
      if (!lastReminderDate || lastReminderDate.getTime() < reminderCooldown) {
        const daysInactive = Math.floor(
          (now.getTime() - lastActivityDate.getTime()) / (24 * 60 * 60 * 1000),
        );
        const daysLeft = Math.max(1, expirationDays - daysInactive);

        const message = `Вы давно не заглядывали к нам! На вашем счету <b>${c.balance} бонусов</b>, они сгорят через ${daysLeft} дней.\n\nЗагляните к нам за свежей выпечкой и ароматным кофе!`;

        try {
          const { sendMessage } = require('./telegram.service');
          const { sendPushNotification } = require('./push.service');
          if (c.telegram_id) await sendMessage(c.telegram_id, message).catch(() => {});
          if (c.fcm_token)
            await sendPushNotification(
              c.fcm_token,
              'Мы скучаем! Ваши бонусы скоро сгорят',
              `На счету ${c.balance} бонусов, они сгорят через ${daysLeft} дней. Загляните к нам за кофе!`,
            ).catch(() => {});

          await logTransaction({
            customerId: c.id,
            orderId: 'REMINDER_30_DAYS',
            type: 'churn_reminder',
            amount: 0,
            description: `Отправлено напоминание о сгорании ${c.balance} бонусов`,
          });

          notifiedCount++;
          totalNotifiedBalance += Number(c.balance);
          await new Promise((r) => setTimeout(r, 100)); // Задержка для защиты от лимитов Telegram
        } catch (err) {
          console.error('Failed to send churn reminder:', err.message);
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
  const { error } = await supabase.from('customers').delete().eq('id', customerId);
  if (error) throw new Error(error.message);
  return true;
}

async function checkAndNotifyBirthdays(settings = {}) {
  const { sendPushNotification } = require('./push.service');
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentDay = now.getDate();

  // Ищем клиентов, у которых сегодня день рождения (нужно разобрать birthdate: YYYY-MM-DD или DD.MM.YYYY)
  if (settings.bonus_birthday?.enabled === false) return { notifiedCount: 0 };
  const { data: customers, error } = await supabase
    .from('customers')
    .select('*')
    .not('birth_date', 'is', null);
  if (error || !customers) return;

  let notifiedCount = 0;

  for (const c of customers) {
    if (!c.birth_date) continue;
    let bMonth, bDay;
    if (c.birth_date.includes('-')) {
      // YYYY-MM-DD
      const parts = c.birth_date.split('-');
      if (parts.length === 3) {
        bMonth = parseInt(parts[1], 10);
        bDay = parseInt(parts[2], 10);
      }
    } else if (c.birth_date.includes('.')) {
      // DD.MM.YYYY
      const parts = c.birth_date.split('.');
      if (parts.length === 3) {
        bDay = parseInt(parts[0], 10);
        bMonth = parseInt(parts[1], 10);
      }
    }

    if (bMonth === currentMonth && bDay === currentDay) {
      if (c.fcm_token) {
        await sendPushNotification(
          c.fcm_token,
          'С днём рождения!',
          settings.bonus_birthday?.message ||
            'Поздравляем с днём рождения! Заходите к нам за праздничным кофе и выпечкой!',
        );
        notifiedCount++;
      }
    }
  }
  return { notifiedCount };
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
  getCustomerById,
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
  updateFcmTokenByCustomerId,
  getSecretWalletCardNumber,
  applyLoyaltyTransaction,
  activatePendingBonuses,
};

const { supabase } = require('../config/supabase');
const realtime = require('./realtime.service');
const crypto = require('crypto');
const { localDateBoundaryIso } = require('../utils/date.util');
const { getSecretWalletCardNumber } = require('../utils/wallet-card.util');
const { queueCustomerLoyaltySync } = require('./loyalty-sync.service');

const customerError = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode });

const safeHashEquals = (actual, expected) => {
  const actualBuffer = Buffer.from(String(actual).toLowerCase());
  const expectedBuffer = Buffer.from(String(expected).toLowerCase());
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
};

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
  queueCustomerLoyaltySync(customerId);
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
  branchId = null,
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
  if (branchId) {
    const { error: branchError } = await supabase
      .from('transactions')
      .update({ branch_id: branchId })
      .eq('customer_id', customerId)
      .eq('order_id', String(orderId))
      .is('branch_id', null);
    if (branchError) throw new Error('Could not scope loyalty transaction to branch');
  }
  const result = Array.isArray(data) ? data[0] : data;
  if (!result?.duplicate) queueCustomerLoyaltySync(customerId);
  return result;
}

async function activatePendingBonuses() {
  const { data, error } = await supabase.rpc('activate_pending_bonus_transactions');
  if (error) throw new Error('Error activating pending bonuses: ' + error.message);
  const result = data || { activated_count: 0, activated_amount: 0 };
  for (const customerId of result.customer_ids || []) queueCustomerLoyaltySync(customerId);
  return result;
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
      branch_id: transactionData.branchId || null,
    },
  ]);

  if (error) {
    console.error('Error logging transaction:', error.message);
  } else {
    realtime.publish(
      'transaction.created',
      {
        customerId: transactionData.customerId,
        orderId: transactionData.orderId,
        type: transactionData.type,
        amount: transactionData.amount,
        branchId: transactionData.branchId || null,
      },
      {
        customerId: transactionData.customerId,
        includeAdmins: Boolean(transactionData.branchId),
        branchId: transactionData.branchId || null,
      },
    );
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

async function getAllCustomers({ page = 1, pageSize = 50, search = '', branchIds = null } = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 50));
  const cleanSearch = String(search).trim().replace(/[,()]/g, ' ').slice(0, 100);
  const scopedBranches = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  if (scopedBranches.length) {
    const { data, error } = await supabase.rpc('admin_scoped_customers', {
      p_branch_ids: scopedBranches,
      p_search: cleanSearch,
      p_limit: safePageSize,
      p_offset: (safePage - 1) * safePageSize,
    });
    if (error) throw new Error(error.message);
    const result = Array.isArray(data) ? data[0] : data || {};
    return {
      customers: Array.isArray(result.customers) ? result.customers : [],
      total: Number(result.total || 0),
      page: safePage,
      pageSize: safePageSize,
    };
  }
  let query = supabase.from('customers').select('*', { count: 'exact' });
  if (cleanSearch) query = query.or(`name.ilike.%${cleanSearch}%,phone.ilike.%${cleanSearch}%`);
  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .range(from, from + safePageSize - 1);
  if (error) throw new Error(error.message);
  return { customers: data || [], total: count || 0, page: safePage, pageSize: safePageSize };
}

async function getTransactions({
  branchIds = null,
  page = 1,
  pageSize = 50,
  search = '',
  dateFrom = '',
  dateTo = '',
  type = '',
} = {}) {
  const safePage = Math.max(1, Number.parseInt(page, 10) || 1);
  const safePageSize = Math.min(100, Math.max(10, Number.parseInt(pageSize, 10) || 50));
  const needle = String(search || '')
    .trim()
    .replace(/[%_,()]/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 100);
  let query = supabase.from('transactions').select('*, customers(phone, name)', { count: 'exact' });
  const scopedBranches = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  if (scopedBranches.length) query = query.in('branch_id', scopedBranches);
  const startAt = localDateBoundaryIso(dateFrom);
  const endAt = localDateBoundaryIso(dateTo, { nextDay: true });
  if (startAt) query = query.gte('timestamp', startAt);
  if (endAt) query = query.lt('timestamp', endAt);
  if (
    type &&
    [
      'deposit',
      'pending_deposit',
      'withdrawal',
      'manual_deposit',
      'manual_withdrawal',
      'manual',
      'expiration',
      'refund_reversal',
      'refund_bonus_restore',
      'cancelled_deposit',
      'order',
    ].includes(String(type))
  ) {
    query = query.eq('type', String(type));
  }
  if (needle) {
    const { data: matchedCustomers, error: customerError } = await supabase
      .from('customers')
      .select('id')
      .or(`name.ilike.%${needle}%,phone.ilike.%${needle}%`)
      .limit(200);
    if (customerError) throw new Error(customerError.message);
    const predicates = [
      `order_id.ilike.%${needle}%`,
      `description.ilike.%${needle}%`,
      ...((matchedCustomers || []).length
        ? [`customer_id.in.(${matchedCustomers.map((customer) => customer.id).join(',')})`]
        : []),
    ];
    query = query.or(predicates.join(','));
  }
  const from = (safePage - 1) * safePageSize;
  const { data, error, count } = await query
    .order('timestamp', { ascending: false })
    .range(from, from + safePageSize - 1);
  if (error) throw new Error(error.message);
  return {
    transactions: data || [],
    total: count || 0,
    page: safePage,
    pageSize: safePageSize,
  };
}

async function getStats({ branchIds = null } = {}) {
  const scopedBranches = Array.isArray(branchIds) ? branchIds.map(String).filter(Boolean) : [];
  const attachFunnel = async (stats) => {
    const { data, error } = await supabase.rpc('get_app_funnel', {
      p_branch_ids: scopedBranches.length ? scopedBranches : null,
    });
    if (error) {
      console.warn('Не удалось получить уникальную воронку приложения:', error.message);
      return stats;
    }
    const payload = Array.isArray(data) ? data[0] : data;
    const funnel = payload?.funnel && typeof payload.funnel === 'object' ? payload.funnel : {};
    const funnelStartEvent = payload?.funnelStartEvent || 'app_open';
    const steps = [
      funnelStartEvent,
      ...(funnelStartEvent === 'app_open' ? ['catalog_view'] : []),
      'add_to_cart',
      'checkout_started',
      'payment_started',
      'payment_paid',
    ];
    const funnelConversions = {};
    steps.forEach((eventType, index) => {
      if (index === 0) {
        funnelConversions[eventType] = Number(funnel[eventType] || 0) > 0 ? 100 : 0;
        return;
      }
      const previous = Number(funnel[steps[index - 1]] || 0);
      const current = Number(funnel[eventType] || 0);
      funnelConversions[eventType] =
        previous > 0 ? Math.round((current / previous) * 1000) / 10 : 0;
    });
    return { ...stats, funnel, funnelConversions, funnelStartEvent };
  };
  if (scopedBranches.length) {
    const { data, error } = await supabase.rpc('get_admin_stats_scoped', {
      p_branch_ids: scopedBranches,
    });
    if (error) throw new Error(error.message);
    return attachFunnel(Array.isArray(data) ? data[0] : data);
  }
  const { data: aggregate, error: aggregateError } = await supabase.rpc('get_admin_stats');
  if (!aggregateError && aggregate) return attachFunnel(aggregate);

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

  const { data: txs } = await supabase
    .from('transactions')
    .select('type, amount, timestamp, order_id');
  let totalBurned = 0;
  let totalRedeemed = 0;
  let totalEarned = 0;
  let earnedLast30Days = 0;
  let burnedLast30Days = 0;
  let bonusRestored = 0;
  let bonusRestoredLast30Days = 0;
  let earnedReversed = 0;
  let earnedReversedLast30Days = 0;

  if (txs) {
    txs.forEach((t) => {
      const amt = Number(t.amount || 0);
      const isRecent = t.timestamp && new Date(t.timestamp) >= thirtyDaysAgo;
      if (t.type === 'withdrawal' || t.type === 'manual_withdrawal' || t.type === 'expiration') {
        totalBurned += amt;
        if (isRecent) burnedLast30Days += amt;
      }
      // Only a withdrawal attached to a real order represents payment with
      // bonuses. Expirations and manual write-offs affect the liability
      // balance but must not inflate the payment mix.
      if (t.type === 'withdrawal' && t.order_id) totalRedeemed += amt;
      if (t.type === 'refund_bonus_restore') {
        bonusRestored += amt;
        if (isRecent) bonusRestoredLast30Days += amt;
      }
      if (
        t.type === 'deposit' ||
        t.type === 'pending_deposit' ||
        t.type === 'manual_deposit' ||
        t.type === 'manual'
      ) {
        totalEarned += amt;
        if (isRecent) earnedLast30Days += amt;
      }
      if (t.type === 'refund_reversal') {
        earnedReversed += amt;
        if (isRecent) earnedReversedLast30Days += amt;
      }
    });
  }

  // The transaction query has no ordering guarantee. Apply compensating
  // refund entries after summing the original movements so an older debit
  // cannot be added back accidentally when its restore row is returned first.
  totalRedeemed = Math.max(0, totalRedeemed - bonusRestored);
  totalBurned = Math.max(0, totalBurned - bonusRestored);
  burnedLast30Days = Math.max(0, burnedLast30Days - bonusRestoredLast30Days);
  totalEarned = Math.max(0, totalEarned - earnedReversed);
  earnedLast30Days = Math.max(0, earnedLast30Days - earnedReversedLast30Days);

  const totalGrossRevenue = totalSpent + totalRedeemed;
  const bonusPaymentPercent =
    totalGrossRevenue > 0 ? ((totalRedeemed / totalGrossRevenue) * 100).toFixed(1) : '0.0';

  return attachFunnel({
    totalCustomers: customers ? customers.length : 0,
    newCustomersLast30Days,
    totalSales: totalSpent,
    totalEarned,
    totalBurned,
    totalRedeemed,
    earnedLast30Days,
    burnedLast30Days,
    bonusPaymentPercent,
    currentLiabilities: totalIssued,
  });
}

async function addManualBonus(customerId, amount, reason, { branchId = null } = {}) {
  const { data, error } = await supabase.rpc('apply_manual_bonus_scoped', {
    p_customer_id: customerId,
    p_amount_change: amount,
    p_reason: reason || null,
    p_branch_id: branchId,
  });
  if (error) throw new Error(error.message);
  realtime.publish(
    'transaction.created',
    {
      customerId,
      type: Number(amount) >= 0 ? 'manual_deposit' : 'manual_withdrawal',
      amount: Math.abs(Number(amount)),
      branchId,
    },
    {
      customerId,
      includeAdmins: true,
      branchId,
      roles: branchId ? undefined : ['owner', 'admin'],
    },
  );
  queueCustomerLoyaltySync(customerId);
  return data;
}

async function searchCustomers(query) {
  if (!query) return [];
  const trimQuery = query.trim();

  // 1. Проверка динамического 5-минутного QR-кода приложения (TOTP)
  if (trimQuery.startsWith('BULKA-OTP-')) {
    const parts = trimQuery.split('-');
    // BULKA, OTP, phone, timeWindow, hash
    if (parts.length === 5) {
      const phone = parts[2];
      const timeWindow = parseInt(parts[3], 10);
      const hash = parts[4];
      const currentWindow = Math.floor(Date.now() / 300000); // 300000 ms = 5 minutes

      if (!/^\d{10,15}$/.test(phone) || !/^\d+$/.test(parts[3]) || !/^[0-9a-f]{16}$/i.test(hash)) {
        throw customerError('Некорректный QR-код клиента');
      }
      if (Number.isNaN(timeWindow) || Math.abs(currentWindow - timeWindow) > 1) {
        throw customerError(
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
      if (!safeHashEquals(hash, expectedHash)) {
        throw customerError('Недействительный или поддельный QR-код.', 401);
      }

      const { data, error } = await supabase
        .from('customers')
        .select('*')
        .in('phone', [phone, `+${phone}`])
        .limit(1);
      if (error) throw error;
      if (!data || data.length === 0)
        throw customerError('Клиент по динамическому коду не найден', 404);
      return data;
    }
    throw customerError('Некорректный QR-код клиента');
  }

  // 2. Проверка зашифрованной карты Wallet (CARD-UUID-HASH)
  if (trimQuery.startsWith('CARD-')) {
    const lastDash = trimQuery.lastIndexOf('-');
    if (lastDash > 5) {
      const customerId = trimQuery.slice(5, lastDash);
      const hashSuffix = trimQuery.slice(lastDash + 1);
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          customerId,
        ) ||
        !/^[0-9a-f]{16}$/i.test(hashSuffix)
      ) {
        throw customerError('Некорректный код карты Wallet');
      }

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
        if (safeHashEquals(hashSuffix, expectedSuffix)) {
          return [customer];
        }
      }
      if (error) throw error;
      throw customerError('Недействительная карта лояльности Wallet.', 401);
    }
    throw customerError('Некорректный код карты Wallet');
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
  { name, last_name, gender, email, region, birth_date, phone, avatar_key },
) {
  const updates = {};
  if (name !== undefined && name !== null) updates.name = name;
  if (last_name !== undefined) updates.last_name = last_name;
  if (gender !== undefined) updates.gender = gender;
  if (email !== undefined) updates.email = email;
  if (region !== undefined) updates.region = region;
  if (birth_date !== undefined) updates.birth_date = birth_date || null;
  if (phone !== undefined && phone !== null) updates.phone = phone;
  if (avatar_key !== undefined) updates.avatar_key = avatar_key || null;
  const { error } = await supabase.from('customers').update(updates).eq('id', customerId);
  if (error) throw new Error(error.message);
  if (['name', 'phone'].some((key) => key in updates)) {
    queueCustomerLoyaltySync(customerId);
  }
}

const PUSH_SCHEMA_MISSING_CODES = new Set(['42P01', '42883', 'PGRST202', 'PGRST205']);

const isMissingPushSchemaError = (error) =>
  Boolean(error && PUSH_SCHEMA_MISSING_CODES.has(String(error.code || '')));

async function registerPushTokenByCustomerId(
  customerId,
  fcmToken,
  { language = null, platform = 'unknown', installationId = null } = {},
) {
  const token = String(fcmToken || '').trim();
  const deviceId = String(installationId || `legacy:${customerId}`).trim();
  if (!customerId || token.length < 20 || token.length > 4096) {
    throw customerError('Некорректный push-токен');
  }
  if (!/^[A-Za-z0-9._:-]{8,160}$/.test(deviceId)) {
    throw customerError('Некорректный идентификатор установки');
  }

  const normalizedPlatform = ['android', 'ios', 'web'].includes(
    String(platform || '').toLowerCase(),
  )
    ? String(platform).toLowerCase()
    : 'unknown';
  const normalizedLanguage = String(language || '').toLowerCase();
  const { error } = await supabase.rpc('register_customer_push_token', {
    p_customer_id: customerId,
    p_token: token,
    p_platform: normalizedPlatform,
    p_installation_id: deviceId,
    p_language: normalizedLanguage || null,
  });
  if (!error) return true;
  if (!isMissingPushSchemaError(error)) throw new Error(error.message);

  // Keep older databases usable during a rolling deployment. The migration
  // upgrades this legacy single-token column to per-installation rows.
  const updates = { fcm_token: token };
  if (['ru', 'kk', 'kz', 'en'].includes(normalizedLanguage)) {
    updates.preferred_language = normalizedLanguage === 'kz' ? 'kk' : normalizedLanguage;
  }
  const { error: fallbackError } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', customerId);
  if (fallbackError) throw new Error(fallbackError.message);
  return true;
}

async function unregisterPushTokenByCustomerId(
  customerId,
  { installationId = null, fcmToken = null } = {},
) {
  if (!customerId) return false;
  const deviceId = String(installationId || `legacy:${customerId}`).trim();
  const token = String(fcmToken || '').trim() || null;
  const { error } = await supabase.rpc('unregister_customer_push_token', {
    p_customer_id: customerId,
    p_installation_id: deviceId,
    p_token: token,
  });
  if (!error) return true;
  if (!isMissingPushSchemaError(error)) throw new Error(error.message);

  let query = supabase.from('customers').update({ fcm_token: null }).eq('id', customerId);
  if (token) query = query.eq('fcm_token', token);
  const { error: fallbackError } = await query;
  if (fallbackError) throw new Error(fallbackError.message);
  return true;
}

async function updateFcmTokenByCustomerId(customerId, fcmToken, language = null) {
  return registerPushTokenByCustomerId(customerId, fcmToken, { language });
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
          queueCustomerLoyaltySync(c.id);
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
          const { sendPushToCustomer } = require('./push.service');
          if (c.telegram_id) await sendMessage(c.telegram_id, message).catch(() => {});
          await sendPushToCustomer(
            c.id,
            'Мы скучаем! Ваши бонусы скоро сгорят',
            `На счету ${c.balance} бонусов, они сгорят через ${daysLeft} дней. Загляните к нам за кофе!`,
            {},
            c.fcm_token,
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

async function checkAndNotifyBirthdays(settings = {}) {
  const { sendPushToCustomer } = require('./push.service');
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
      const pushResult = await sendPushToCustomer(
        c.id,
        'С днём рождения!',
        settings.bonus_birthday?.message ||
          'Поздравляем с днём рождения! Заходите к нам за праздничным кофе и выпечкой!',
        {},
        c.fcm_token,
      );
      if (pushResult.delivered > 0 || pushResult.queued) {
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
  registerPushTokenByCustomerId,
  unregisterPushTokenByCustomerId,
  updateFcmTokenByCustomerId,
  getSecretWalletCardNumber,
  applyLoyaltyTransaction,
  activatePendingBonuses,
};

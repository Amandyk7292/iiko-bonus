const { supabase } = require('../config/supabase');
const { getSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');
const { parseMoney } = require('../utils/money.util');
const {
  getOrCreateCustomerByPhone,
  searchCustomers,
  activatePendingBonusesSafe,
  applyLoyaltyTransaction,
} = require('../services/customer.service');
const { sendPushNotification, notifyBonusChange } = require('../services/push.service');
const { sendAppleWalletPush } = require('../services/wallet.service');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requestError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function validateCustomerId(customerId) {
  if (!UUID_PATTERN.test(String(customerId || ''))) {
    throw requestError('customerId must be a valid UUID');
  }
  return String(customerId);
}

function validateOrderId(orderId) {
  const value = String(orderId || '').trim();
  const hasControlCharacters = [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127;
  });
  if (!value || value.length > 200 || hasControlCharacters) {
    throw requestError('orderId must contain 1-200 printable characters');
  }
  return value;
}

async function logIikoOperation(payload, result, errorMsg) {
  try {
    if (!payload?.orderId) return;
    const { error } = await supabase.from('iiko_operation_logs').insert([
      {
        order_id: String(payload.orderId),
        customer_id: payload.customerId || null,
        status: errorMsg ? 'error' : result?.duplicate ? 'duplicate' : 'success',
        duplicate: Boolean(result?.duplicate),
        discount_amount: Number(payload.discountAmount || 0),
        earned_bonus: Number(payload.earnedBonus || 0),
        order_total: Number(payload.orderTotal || 0),
        cashback_percent: payload.cashbackPercent ?? null,
        balance: result?.balance ?? null,
        error_message: errorMsg || null,
        payload: payload || null,
      },
    ]);
    if (error) console.error('Failed to log iiko operation:', error.message);
  } catch (err) {
    console.error('Failed to log iiko operation:', err.message);
  }
}

async function configCheck(req, res) {
  try {
    const settings = await getSettings();
    const loyaltyTiers = await getActiveLoyaltyTiers(settings);
    res.json({
      success: true,
      service: 'Bulka Bonus loyalty',
      timestamp: new Date().toISOString(),
      settings: {
        base_cashback_percent: settings.base_cashback_percent,
        tier_silver_th: settings.tier_silver_th,
        tier_silver_cb: settings.tier_silver_cb,
        tier_gold_th: settings.tier_gold_th,
        tier_gold_cb: settings.tier_gold_cb,
        tier_platinum_th: settings.tier_platinum_th,
        tier_platinum_cb: settings.tier_platinum_cb,
        max_discount_percent: settings.max_discount_percent,
      },
      loyaltyTiers,
    });
  } catch (_error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getCustomerInfo(req, res) {
  try {
    const { phone, name } = req.body;
    const normalizedPhone = String(phone || '').replace(/[^0-9+]/g, '');
    const phoneDigits = normalizedPhone.replace(/[^0-9]/g, '');
    if (phoneDigits.length < 10 || phoneDigits.length > 15) {
      throw requestError('phone must contain 10-15 digits');
    }
    const customer = await getOrCreateCustomerByPhone(
      normalizedPhone,
      String(name || 'Новый Гость')
        .trim()
        .slice(0, 160),
    );
    const settings = await getSettings();
    const loyaltyTiers = await getActiveLoyaltyTiers(settings);

    const tier = getTierInfo(customer.total_spent, loyaltyTiers, settings);
    const currentCashbackPercent = tier.percent;

    res.json({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.created_at || '',
        totalSpent: customer.total_spent || 0,
        cashbackPercent: currentCashbackPercent,
        tier: tier,
        maxDiscountPercent: settings.max_discount_percent,
        balances: [{ walletId: 'bonus-wallet', name: 'Бонусы', balance: customer.balance }],
      },
    });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.statusCode ? error.message : 'Internal server error' });
  }
}

async function searchCustomersHandler(req, res) {
  try {
    const query = String(req.body?.query || '').trim();
    if (!query) return res.status(400).json({ error: 'Query is required' });
    if (query.length > 160) return res.status(400).json({ error: 'Query is too long' });

    await activatePendingBonusesSafe();
    const customers = await searchCustomers(query);
    const settings = await getSettings();
    const loyaltyTiers = await getActiveLoyaltyTiers(settings);

    const formattedCustomers = customers.map((customer) => {
      const tier = getTierInfo(customer.total_spent, loyaltyTiers, settings);
      const currentCashbackPercent = tier.percent;

      return {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        createdAt: customer.created_at || '',
        totalSpent: customer.total_spent || 0,
        cashbackPercent: currentCashbackPercent,
        tier: tier,
        maxDiscountPercent: settings.max_discount_percent,
        balances: [{ walletId: 'bonus-wallet', name: 'Бонусы', balance: customer.balance }],
      };
    });

    res.json({ customers: formattedCustomers });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

async function calculateBonus(req, res) {
  try {
    const { customerId, orderTotal, requestedBonusAmount } = req.body;
    await activatePendingBonusesSafe();
    const total = parseMoney(orderTotal, 'orderTotal');
    const requested = parseMoney(requestedBonusAmount || 0, 'requestedBonusAmount');
    const settings = await getSettings();
    let customer = { data: null, error: null };
    if (customerId) {
      validateCustomerId(customerId);
      customer = await supabase
        .from('customers')
        .select('balance')
        .eq('id', customerId)
        .maybeSingle();
      if (customer.error) throw new Error('Could not load customer balance');
      if (!customer.data) throw requestError('Customer not found', 404);
    }
    const balance = Number(customer.data?.balance || 0);
    const maxByPercent = total * (Number(settings.max_discount_percent || 0) / 100);
    const discountAmount = Math.min(requested, balance, maxByPercent, total);
    res.json({
      discountAmount: Number(discountAmount.toFixed(2)),
      maxDiscountPercent: settings.max_discount_percent,
      availableBalance: balance,
      message: 'Расчет успешен',
    });
  } catch (error) {
    res
      .status(error.statusCode || 500)
      .json({ error: error.statusCode ? error.message : 'Internal server error' });
  }
}

async function applyBonus(req, res) {
  let logPayload = null;
  try {
    const { customerId, orderId, discountAmount, orderTotal, items } = req.body;
    await activatePendingBonusesSafe();
    const discount = parseMoney(discountAmount || 0, 'discountAmount');
    const total = parseMoney(orderTotal, 'orderTotal');
    validateCustomerId(customerId);
    const normalizedOrderId = validateOrderId(orderId);
    if (items !== undefined && items !== null && !Array.isArray(items)) {
      throw requestError('items must be an array');
    }
    if (Array.isArray(items) && items.length > 500) {
      throw requestError('items must not contain more than 500 entries');
    }
    const settings = await getSettings();

    const customerBefore = await supabase
      .from('customers')
      .select('balance,total_spent')
      .eq('id', customerId)
      .maybeSingle();
    if (customerBefore.error) throw new Error('Could not load customer');
    if (!customerBefore.data) throw requestError('Customer not found', 404);
    const loyaltyTiers = await getActiveLoyaltyTiers(settings);
    const tier = getTierInfo(customerBefore.data.total_spent, loyaltyTiers, settings);
    const currentCashbackPercent = tier.percent;
    const balance = Number(customerBefore.data.balance || 0);
    const maxByPercent = total * (Number(settings.max_discount_percent || 0) / 100);
    const maxAllowedDiscount = Math.min(balance, maxByPercent, total);
    if (discount > maxAllowedDiscount + 0.001) {
      const error = new Error(
        `discountAmount exceeds allowed maximum ${maxAllowedDiscount.toFixed(2)}`,
      );
      error.statusCode = 400;
      throw error;
    }

    const realMoneyPaid = total - discount;
    let earnedBonus = 0;
    if (realMoneyPaid > 0) {
      earnedBonus = Number((realMoneyPaid * (currentCashbackPercent / 100)).toFixed(2));
    }

    const activationDelayDays =
      settings.bonus_activation?.enabled === false
        ? 0
        : Number(settings.bonus_activation?.delay_days || 0);
    logPayload = {
      customerId,
      orderId: normalizedOrderId,
      discountAmount: discount,
      earnedBonus,
      orderTotal: total,
      cashbackPercent: currentCashbackPercent,
      items,
    };

    const result = await applyLoyaltyTransaction({
      customerId,
      orderId: normalizedOrderId,
      discountAmount: discount,
      earnedBonus,
      orderTotal: total,
      realMoneyPaid,
      activationDelayDays,
      items,
    });

    await logIikoOperation(logPayload, result, null);

    // Push notification logic
    if (!result.duplicate)
      try {
        const { data: cData } = await supabase
          .from('customers')
          .select('fcm_token, preferred_language, language')
          .eq('id', customerId)
          .single();
        if (cData) {
          await notifyBonusChange({
            customerId,
            fcmToken: cData.fcm_token,
            language: cData.preferred_language || cData.language || 'ru',
            amount: earnedBonus - discount,
            balance: result.balance,
            isOrder: true,
            total,
            discount,
            earnedBonus,
          });
        }
        sendAppleWalletPush(customerId).catch((err) => console.error(err));
      } catch (pushErr) {
        console.error('Push notification failed:', pushErr);
      }

    res.json({
      success: true,
      newBalance: result.balance,
      discountApplied: result.duplicate ? 0 : discount,
      earnedBonus: result.duplicate ? 0 : earnedBonus,
      duplicate: Boolean(result.duplicate),
      activationDelayDays: activationDelayDays,
      message: result.duplicate
        ? 'Transaction was already recorded.'
        : 'Transaction recorded successfully.',
    });
  } catch (error) {
    if (logPayload) await logIikoOperation(logPayload, null, error.message);
    res
      .status(error.statusCode || 500)
      .json({ error: error.statusCode ? error.message : 'Internal server error' });
  }
}

module.exports = {
  configCheck,
  getCustomerInfo,
  searchCustomersHandler,
  calculateBonus,
  applyBonus,
};

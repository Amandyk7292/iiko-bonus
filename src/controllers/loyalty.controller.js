const { supabase } = require('../config/supabase');
const { getSettings } = require('../services/settings.service');
const { getTierInfo } = require('../utils/tier.util');
const { parseMoney } = require('../utils/money.util');
const { 
  getOrCreateCustomerByPhone, 
  searchCustomers, 
  activatePendingBonusesSafe, 
  applyLoyaltyTransaction 
} = require('../services/customer.service');
const { sendPushNotification } = require('../services/push.service');
const { sendAppleWalletPush } = require('../services/wallet.service');

async function logIikoOperation(payload, balance, errorMsg) {
  try {
    await supabase.from('iiko_operations').insert([{
      balance: balance ?? null,
      error_message: errorMsg || null,
      payload: payload || null
    }]);
  } catch (err) {
    console.error('Failed to log iiko operation:', err.message);
  }
}

async function configCheck(req, res) {
  try {
    const settings = await getSettings();
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
        max_discount_percent: settings.max_discount_percent
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Internal server error' });
  }
}

async function getCustomerInfo(req, res) {
  try {
    const { phone, name } = req.body;
    const customer = await getOrCreateCustomerByPhone(phone, name || 'Новый Гость');
    const settings = await getSettings();
    
    const tier = getTierInfo(customer.total_spent, settings);
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
        balances: [{ walletId: 'bonus-wallet', name: 'Бонусы', balance: customer.balance }]
      }
    });
  } catch (error) { res.status(500).json({ error: 'Internal server error' }); }
}

async function searchCustomersHandler(req, res) {
  try {
    const { query } = req.body;
    if (!query) return res.status(400).json({ error: 'Query is required' });

    await activatePendingBonusesSafe();
    const customers = await searchCustomers(query);
    const settings = await getSettings();

    const formattedCustomers = customers.map(customer => {
      const tier = getTierInfo(customer.total_spent, settings);
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
        balances: [{ walletId: 'bonus-wallet', name: 'Бонусы', balance: customer.balance }]
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
    const customer = customerId
      ? await supabase.from('customers').select('balance').eq('id', customerId).single()
      : { data: null };
    const balance = Number(customer.data?.balance || 0);
    const maxByPercent = total * (Number(settings.max_discount_percent || 0) / 100);
    const discountAmount = Math.min(requested, balance, maxByPercent, total);
    res.json({
      discountAmount: Number(discountAmount.toFixed(2)),
      maxDiscountPercent: settings.max_discount_percent,
      availableBalance: balance,
      message: "Расчет успешен"
    });
  } catch (error) { res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Internal server error' }); }
}

async function applyBonus(req, res) {
  let logPayload = null;
  try {
    const { customerId, orderId, discountAmount, orderTotal, items } = req.body;
    await activatePendingBonusesSafe();
    const discount = parseMoney(discountAmount || 0, 'discountAmount');
    const total = parseMoney(orderTotal, 'orderTotal');
    if (!customerId || !orderId) return res.status(400).json({ error: 'customerId and orderId are required' });
    logPayload = { customerId, orderId, discountAmount: discount, orderTotal: total, items, payload: req.body };
    const settings = await getSettings();

    const customerBefore = await supabase.from('customers').select('total_spent').eq('id', customerId).single();
    if (!customerBefore.data) throw new Error("Customer not found");
    const tier = getTierInfo(customerBefore.data.total_spent, settings);
    const currentCashbackPercent = tier.percent;

    const realMoneyPaid = total - discount;
    let earnedBonus = 0;
    if (realMoneyPaid > 0) {
      earnedBonus = realMoneyPaid * (currentCashbackPercent / 100);
    }
    
    const activationDelayDays = settings.activation_delay_days || 0;

    const result = await applyLoyaltyTransaction(
      customerId,
      orderId,
      discount,
      earnedBonus,
      total,
      realMoneyPaid,
      activationDelayDays,
      items
    );

    await logIikoOperation(logPayload, result.balance, null);

    // Push notification logic
    try {
      const { data: cData } = await supabase.from('customers').select('fcm_token').eq('id', customerId).single();
      if (cData && cData.fcm_token) {
        let pushBody = `Счет: ${total} ₸. `;
        if (discount > 0) pushBody += `Списано: ${discount} б. `;
        if (earnedBonus > 0 && activationDelayDays > 0) pushBody += `Будет зачислен через ${activationDelayDays} д.: ${earnedBonus} б. `;
        else if (earnedBonus > 0) pushBody += `Начислено: ${earnedBonus} б. `;
        pushBody += `Текущий баланс: ${result.balance} б.`;

        await sendPushNotification(cData.fcm_token, 'Ваш заказ оформлен!', pushBody);
      }
      sendAppleWalletPush(customerId).catch(err => console.error(err));
    } catch (pushErr) {
      console.error('Push notification failed:', pushErr);
    }

    res.json({
      success: true,
      newBalance: result.balance,
      discountApplied: discount,
      earnedBonus: earnedBonus,
      activationDelayDays: activationDelayDays,
      message: 'Transaction recorded successfully.'
    });

  } catch (error) {
    if (logPayload) await logIikoOperation(logPayload, null, error.message);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

module.exports = {
  configCheck,
  getCustomerInfo,
  searchCustomersHandler,
  calculateBonus,
  applyBonus
};

const { supabase } = require('../config/supabase');
const { getSettings, updateSettings } = require('../services/settings.service');
const { parseMoney } = require('../utils/money.util');
const { sendPushNotification } = require('../services/push.service');
const { sendMessage } = require('../services/telegram.service');
const { sendAppleWalletPush } = require('../services/wallet.service');
const {
  getAllCustomers,
  getTransactions,
  getStats,
  addManualBonus,
  updateCustomerInfo,
  checkAndExpireInactiveBonuses,
  checkAndNotifyInactiveCustomers,
  deleteCustomer,
  activatePendingBonusesSafe
} = require('../services/customer.service');
const { getStories, addStory, updateStory, deleteStory } = require('../services/story.service');
const { getNews, addNews, updateNews, deleteNews } = require('../services/news.service');
const { getAdminLocations, addLocation, updateLocation, deleteLocation } = require('../services/location.service');

// Settings
const getSettingsHandler = async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const updateSettingsHandler = async (req, res) => {
  try {
    await updateSettings(req.body);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Customers
const getCustomersHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const data = await getAllCustomers();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const getTransactionsHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const data = await getTransactions();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const getStatsHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const data = await getStats();
    res.json(data);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const getIikoOperationsHandler = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('iiko_operation_logs')
      .select('*, customers(phone, name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      if (error.code === '42P01') return res.json([]);
      throw error;
    }
    res.json(data || []);
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Push
const pushTestHandler = async (req, res) => {
  try {
    const { title, body, fcmToken } = req.body;
    if (!title || !body || !fcmToken) return res.status(400).json({ error: 'title, body, fcmToken required' });
    const success = await sendPushNotification(fcmToken, title, body);
    res.json({ success });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const pushMassHandler = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });
    
    const { data: customers } = await supabase.from('customers').select('fcm_token').not('fcm_token', 'is', null);
    if (!customers || customers.length === 0) return res.json({ success: true, count: 0 });

    let count = 0;
    for (const c of customers) {
      if (c.fcm_token) {
        await sendPushNotification(c.fcm_token, title, body);
        count++;
      }
    }
    res.json({ success: true, count });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Customer specific
const addBonusHandler = async (req, res) => {
  try {
    const { customerId, amount, reason } = req.body;
    const parsedAmount = parseMoney(amount, 'amount', { min: -100000000 });
    await addManualBonus(customerId, parsedAmount, reason);
    sendAppleWalletPush(customerId).catch(err => console.error('Push error:', err));
    
    try {
      const { data: c } = await supabase.from('customers').select('*').eq('id', customerId).single();
      if (c) {
        const actionTxt = amount >= 0 ? `Начислено: +${amount} бонусов` : `Списано: ${amount} бонусов`;
        const msg = `<b>Изменение баланса баллов!</b>\n\n${actionTxt}\n<b>Причина:</b> ${reason || 'Корректировка администратором'}\n<b>Текущий баланс:</b> ${c.balance} бон.`;
        if (c.telegram_id) sendMessage(c.telegram_id, msg).catch(() => {});
        if (c.fcm_token) sendPushNotification(c.fcm_token, "Bulka Bonus: Баланс обновлен", `${actionTxt}. Баланс: ${c.balance} бон.`).catch(() => {});
      }
    } catch (e) { console.error("Notify bonus error:", e); }

    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const updateCustomerHandler = async (req, res) => {
  try {
    const { customerId, name, phone, balance, total_spent } = req.body;
    await updateCustomerInfo(customerId, { name, phone, balance, total_spent });
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const expireInactiveHandler = async (req, res) => {
  try {
    const days = req.body.days || 90;
    const result = await checkAndExpireInactiveBonuses(days);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const notifyInactiveHandler = async (req, res) => {
  try {
    const days = req.body.days || 30;
    const result = await checkAndNotifyInactiveCustomers(days);
    res.json({ success: true, ...result });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const deleteCustomerHandler = async (req, res) => {
  try {
    await deleteCustomer(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

const broadcastHandler = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const { data: customers } = await supabase.from('customers').select('telegram_id, fcm_token').not('telegram_id', 'is', null);
    
    if (!customers || customers.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    let count = 0;
    (async () => {
      for (const c of customers) {
        if (c.telegram_id || c.fcm_token) {
          if (c.telegram_id) await sendMessage(c.telegram_id, message).catch(() => {});
          if (c.fcm_token) {
            const cleanText = message.replace(/<[^>]*>/g, '');
            await sendPushNotification(c.fcm_token, "Bulka Bonus: Новая акция!", cleanText).catch(() => {});
          }
          count++;
          await new Promise(r => setTimeout(r, 100));
        }
      }
      console.log(`Broadcast finished. Sent to ${count} customers.`);
    })();

    res.json({ success: true, count: customers.length });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Stories
const getStoriesHandler = async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const addStoryHandler = async (req, res) => {
  try {
    const story = await addStory(req.body);
    res.json({ success: true, story });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const updateStoryHandler = async (req, res) => {
  try {
    const story = await updateStory(req.params.id, req.body);
    res.json({ success: true, story });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const deleteStoryHandler = async (req, res) => {
  try {
    await deleteStory(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// News
const getNewsHandler = async (req, res) => {
  try {
    const news = await getNews();
    res.json({ success: true, news });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const addNewsHandler = async (req, res) => {
  try {
    const newsItem = await addNews(req.body);
    res.json({ success: true, news: newsItem });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const updateNewsHandler = async (req, res) => {
  try {
    const newsItem = await updateNews(req.params.id, req.body);
    res.json({ success: true, news: newsItem });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const deleteNewsHandler = async (req, res) => {
  try {
    await deleteNews(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

// Locations
const getLocationsHandler = async (req, res) => {
  try {
    const locs = await getAdminLocations();
    res.json({ success: true, locations: locs });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const addLocationHandler = async (req, res) => {
  try {
    const loc = await addLocation(req.body);
    res.json({ success: true, location: loc });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const updateLocationHandler = async (req, res) => {
  try {
    const loc = await updateLocation(req.params.id, req.body);
    res.json({ success: true, location: loc });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
const deleteLocationHandler = async (req, res) => {
  try {
    await deleteLocation(req.params.id);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

module.exports = {
  getSettingsHandler, updateSettingsHandler,
  getCustomersHandler, getTransactionsHandler, getStatsHandler, getIikoOperationsHandler,
  pushTestHandler, pushMassHandler,
  addBonusHandler, updateCustomerHandler, expireInactiveHandler, notifyInactiveHandler, deleteCustomerHandler, broadcastHandler,
  getStoriesHandler, addStoryHandler, updateStoryHandler, deleteStoryHandler,
  getNewsHandler, addNewsHandler, updateNewsHandler, deleteNewsHandler,
  getLocationsHandler, addLocationHandler, updateLocationHandler, deleteLocationHandler
};

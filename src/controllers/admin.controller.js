const { supabase } = require('../config/supabase');
const crypto = require('crypto');
const { getSettings, updateSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { parseMoney } = require('../utils/money.util');
const { getTierInfo } = require('../utils/tier.util');
const { sendPushNotification, notifyBonusChange } = require('../services/push.service');
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
  activatePendingBonusesSafe,
} = require('../services/customer.service');
const { getStories, addStory, updateStory, deleteStory } = require('../services/story.service');
const { getNews, addNews, updateNews, deleteNews } = require('../services/news.service');
const {
  getCitiesWithPoints,
  createCity,
  updateCity,
  deleteCity,
  createPoint,
  updatePoint,
  deletePoint,
} = require('../services/location.service');

// Settings
const getSettingsHandler = async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateSettingsHandler = async (req, res) => {
  try {
    await updateSettings(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Customers
const getCustomersHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const result = await getAllCustomers({
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search,
    });
    const settings = await getSettings();
    const tiers = await getActiveLoyaltyTiers(settings);
    res.json({
      ...result,
      customers: result.customers.map((customer) => {
        const tier = getTierInfo(customer.total_spent, tiers, settings);
        return { ...customer, cashbackPercent: tier.percent, tier };
      }),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getTransactionsHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const data = await getTransactions();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getStatsHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const data = await getStats();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Push
const pushTestHandler = async (req, res) => {
  try {
    const { title, body, fcmToken } = req.body;
    if (!title || !body || !fcmToken)
      return res.status(400).json({ error: 'title, body, fcmToken required' });
    const success = await sendPushNotification(fcmToken, title, body);
    res.json({ success });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const pushMassHandler = async (req, res) => {
  try {
    const { title, body } = req.body;
    if (!title || !body) return res.status(400).json({ error: 'title and body required' });

    const { data: customers } = await supabase.from('customers').select('id, fcm_token');
    if (!customers || customers.length === 0) return res.json({ success: true, count: 0 });

    const { data: savedNotifications, error: notificationError } = await supabase
      .from('customer_notifications')
      .insert(
        customers.map((customer) => ({
          customer_id: customer.id,
          title: String(title).slice(0, 160),
          body: String(body).slice(0, 2000),
          type: 'broadcast',
        })),
      )
      .select('id, customer_id');
    if (notificationError) throw notificationError;
    const notificationByCustomer = new Map(
      (savedNotifications || []).map((notification) => [notification.customer_id, notification.id]),
    );

    let count = 0;
    let totalTokens = 0;
    for (const c of customers) {
      if (c.fcm_token && c.fcm_token.trim()) {
        totalTokens++;
        const delivered = await sendPushNotification(c.fcm_token, title, body, {
          notificationId: String(notificationByCustomer.get(c.id) || ''),
          type: 'broadcast',
        });
        if (delivered) count++;
      }
    }
    console.log(
      `[PUSH MASS] Всего клиентов: ${customers.length}, с fcm_token: ${totalTokens}, успешно отправлено push: ${count}`,
    );
    res.json({ success: true, count, savedCount: customers.length, totalTokens });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Customer specific
const addBonusHandler = async (req, res) => {
  try {
    const { customerId, amount, reason } = req.body;
    const parsedAmount = parseMoney(amount, 'amount', { min: -100000000 });
    await addManualBonus(customerId, parsedAmount, reason);
    sendAppleWalletPush(customerId).catch((err) => console.error('Push error:', err));

    try {
      const { data: c } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
      if (c) {
        const actionTxt =
          amount >= 0 ? `Начислено: +${amount} бонусов` : `Списано: ${amount} бонусов`;
        const msg = `<b>Изменение баланса баллов!</b>\n\n${actionTxt}\n<b>Причина:</b> ${reason || 'Корректировка администратором'}\n<b>Текущий баланс:</b> ${c.balance} бон.`;
        if (c.telegram_id) sendMessage(c.telegram_id, msg).catch(() => {});
        await notifyBonusChange({
          customerId: c.id,
          fcmToken: c.fcm_token,
          language: c.preferred_language || c.language || 'ru',
          amount: Number(amount),
          balance: Number(c.balance),
          reason: reason || '',
          isOrder: false,
        });
      }
    } catch (e) {
      console.error('Notify bonus error:', e);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateCustomerHandler = async (req, res) => {
  try {
    const { customerId, name, phone, balance, total_spent } = req.body;
    if (!customerId) return res.status(400).json({ error: 'customerId is required' });
    const updates = {
      name: name === undefined ? undefined : String(name).trim().slice(0, 160),
      phone:
        phone === undefined
          ? undefined
          : String(phone)
              .replace(/[^0-9+]/g, '')
              .slice(0, 32),
      balance: balance === undefined ? undefined : parseMoney(balance, 'balance'),
      total_spent: total_spent === undefined ? undefined : parseMoney(total_spent, 'total_spent'),
    };
    await updateCustomerInfo(customerId, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const expireInactiveHandler = async (req, res) => {
  try {
    const days = req.body.days || 90;
    const result = await checkAndExpireInactiveBonuses(days);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const notifyInactiveHandler = async (req, res) => {
  try {
    const days = req.body.days || 30;
    const result = await checkAndNotifyInactiveCustomers(days);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteCustomerHandler = async (req, res) => {
  try {
    await deleteCustomer(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const broadcastHandler = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const { data: customers } = await supabase.from('customers').select('telegram_id, fcm_token');

    if (!customers || customers.length === 0) {
      return res.json({ success: true, count: 0 });
    }

    let count = 0;
    const cleanText = message.replace(/<[^>]*>/g, '');
    const recipients = customers.filter((customer) => customer.telegram_id || customer.fcm_token);
    for (let offset = 0; offset < recipients.length; offset += 50) {
      const batch = recipients.slice(offset, offset + 50);
      await Promise.all(
        batch.flatMap((customer) => [
          ...(customer.telegram_id
            ? [sendMessage(customer.telegram_id, message).catch(() => false)]
            : []),
          ...(customer.fcm_token
            ? [
                sendPushNotification(
                  customer.fcm_token,
                  'Bulka Bonus: Новая акция!',
                  cleanText,
                ).catch(() => false),
              ]
            : []),
        ]),
      );
      count += batch.length;
    }

    res.json({ success: true, count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const uploadPhotoHandler = async (req, res) => {
  try {
    const raw = String(req.body.imageBase64 || '');
    const match = raw.match(/^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/);
    if (!match)
      return res.status(400).json({ error: 'Only PNG, JPEG and WebP data URLs are supported' });
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > 1500000)
      return res.status(413).json({ error: 'Image must not exceed 1.5 MB' });
    const isJpeg = buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    const isPng = buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const isWebp =
      buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
      buffer.subarray(8, 12).toString('ascii') === 'WEBP';
    const signatureMatches =
      (match[1] === 'image/jpeg' && isJpeg) ||
      (match[1] === 'image/png' && isPng) ||
      (match[1] === 'image/webp' && isWebp);
    if (!signatureMatches) return res.status(400).json({ error: 'Image content is invalid' });
    const extension = match[1] === 'image/jpeg' ? 'jpg' : match[1].split('/')[1];
    const objectPath = `admin/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${extension}`;
    const { error } = await supabase.storage.from('stories').upload(objectPath, buffer, {
      contentType: match[1],
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from('stories').getPublicUrl(objectPath);
    res.json({ success: true, url: data.publicUrl });
  } catch (_err) {
    res.status(500).json({ error: 'Image upload failed' });
  }
};

// Stories
const getStoriesHandler = async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const addStoryHandler = async (req, res) => {
  try {
    const story = await addStory(req.body);
    res.json({ success: true, story });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const updateStoryHandler = async (req, res) => {
  try {
    const story = await updateStory(req.params.id, req.body);
    res.json({ success: true, story });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const deleteStoryHandler = async (req, res) => {
  try {
    await deleteStory(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// News
const getNewsHandler = async (req, res) => {
  try {
    const news = await getNews();
    res.json({ success: true, news });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const addNewsHandler = async (req, res) => {
  try {
    const newsItem = await addNews(req.body);
    res.json({ success: true, news: newsItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const updateNewsHandler = async (req, res) => {
  try {
    const newsItem = await updateNews(req.params.id, req.body);
    res.json({ success: true, news: newsItem });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
const deleteNewsHandler = async (req, res) => {
  try {
    await deleteNews(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Cities and Points
const getCitiesHandler = async (req, res) => {
  try {
    const cities = await getCitiesWithPoints();
    res.json({ success: true, cities });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const addCityHandler = async (req, res) => {
  try {
    const city = await createCity(req.body.name, req.body.i18n);
    res.json({ success: true, city });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updateCityHandler = async (req, res) => {
  try {
    const city = await updateCity(req.params.id, req.body.name, req.body.i18n);
    res.json({ success: true, city });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteCityHandler = async (req, res) => {
  try {
    await deleteCity(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const addPointHandler = async (req, res) => {
  try {
    const { city_id, name, address, latitude, longitude, i18n } = req.body;
    const point = await createPoint(city_id, name, address, latitude, longitude, i18n);
    res.json({ success: true, point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const updatePointHandler = async (req, res) => {
  try {
    const { name, address, latitude, longitude, i18n } = req.body;
    const point = await updatePoint(req.params.id, name, address, latitude, longitude, i18n);
    res.json({ success: true, point });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deletePointHandler = async (req, res) => {
  try {
    await deletePoint(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

module.exports = {
  getSettingsHandler,
  updateSettingsHandler,
  getCustomersHandler,
  getTransactionsHandler,
  getStatsHandler,
  getIikoOperationsHandler,
  pushTestHandler,
  pushMassHandler,
  addBonusHandler,
  updateCustomerHandler,
  expireInactiveHandler,
  notifyInactiveHandler,
  deleteCustomerHandler,
  broadcastHandler,
  uploadPhotoHandler,
  getStoriesHandler,
  addStoryHandler,
  updateStoryHandler,
  deleteStoryHandler,
  getNewsHandler,
  addNewsHandler,
  updateNewsHandler,
  deleteNewsHandler,
  getCitiesHandler,
  addCityHandler,
  updateCityHandler,
  deleteCityHandler,
  addPointHandler,
  updatePointHandler,
  deletePointHandler,
};

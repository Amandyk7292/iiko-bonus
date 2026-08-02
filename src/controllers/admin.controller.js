const { supabase } = require('../config/supabase');
const crypto = require('crypto');
const { getSettings, updateSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { parseMoney } = require('../utils/money.util');
const { getTierInfo } = require('../utils/tier.util');
const { branchScopeForAdmin, hasGlobalBranchAccess } = require('../utils/admin-scope.util');
const { optimizeUploadedImage } = require('../utils/image.util');
const {
  notifyBonusChange,
  sendPushNotification,
  sendPushToCustomer,
} = require('../services/push.service');
const { sendMessage } = require('../services/telegram.service');
const {
  getAllCustomers,
  getTransactions,
  getStats,
  addManualBonus,
  updateCustomerInfo,
  checkAndExpireInactiveBonuses,
  checkAndNotifyInactiveCustomers,
  activatePendingBonusesSafe,
} = require('../services/customer.service');
const { deleteCustomerData } = require('../services/privacy.service');
const { setAdminAuditContext } = require('../services/admin-audit.service');
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

const boundedPositiveNumber = (value, fallback, maximum) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
};

const manualBonusLimitForAdmin = (admin) =>
  hasGlobalBranchAccess(admin)
    ? boundedPositiveNumber(process.env.ADMIN_MANUAL_BONUS_LIMIT, 1_000_000, 1_000_000)
    : boundedPositiveNumber(process.env.DELEGATED_MANUAL_BONUS_LIMIT, 100_000, 1_000_000);

const normalizeManualBonusReason = (value) => {
  const reason = String(value || '').trim();
  if (reason.length < 5 || reason.length > 240) {
    throw Object.assign(new Error('Укажите причину корректировки от 5 до 240 символов'), {
      statusCode: 400,
      code: 'MANUAL_BONUS_REASON_REQUIRED',
    });
  }
  return reason;
};

// Settings
const getSettingsHandler = async (req, res) => {
  try {
    const settings = await getSettings();
    res.json(settings);
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
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
      branchIds: branchScopeForAdmin(req.admin),
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
    const data = await getTransactions({
      branchIds: branchScopeForAdmin(req.admin),
      page: req.query.page,
      pageSize: req.query.pageSize,
      search: req.query.search,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      type: req.query.type,
    });
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const getStatsHandler = async (req, res) => {
  try {
    await activatePendingBonusesSafe();
    const data = await getStats({ branchIds: branchScopeForAdmin(req.admin) });
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
    const normalizeTranslations = (value, fallback, limit) => {
      const source = value && typeof value === 'object' ? value : {};
      return Object.fromEntries(
        ['ru', 'kk', 'en'].map((language) => [
          language,
          String(source[language] || fallback || '')
            .trim()
            .slice(0, limit),
        ]),
      );
    };
    const titles = normalizeTranslations(req.body.titleTranslations || req.body.titles, title, 160);
    const bodies = normalizeTranslations(req.body.bodyTranslations || req.body.bodies, body, 2000);
    if ([...Object.values(titles), ...Object.values(bodies)].some((value) => !value)) {
      return res.status(400).json({ error: 'ru, kk and en title/body translations required' });
    }

    const { data: customers } = await supabase
      .from('customers')
      .select('id, fcm_token, preferred_language');
    if (!customers || customers.length === 0) return res.json({ success: true, count: 0 });

    const { data: savedNotifications, error: notificationError } = await supabase
      .from('customer_notifications')
      .insert(
        customers.map((customer) => {
          const language = ['kk', 'en'].includes(customer.preferred_language)
            ? customer.preferred_language
            : 'ru';
          return {
            customer_id: customer.id,
            title: titles[language],
            body: bodies[language],
            type: 'broadcast',
            payload: { i18n: { titles, bodies } },
          };
        }),
      )
      .select('id, customer_id');
    if (notificationError) throw notificationError;
    const notificationByCustomer = new Map(
      (savedNotifications || []).map((notification) => [notification.customer_id, notification.id]),
    );

    let count = 0;
    let totalTokens = 0;
    for (let offset = 0; offset < customers.length; offset += 25) {
      const batch = customers.slice(offset, offset + 25);
      const results = await Promise.all(
        batch.map((customer) => {
          const language = ['kk', 'en'].includes(customer.preferred_language)
            ? customer.preferred_language
            : 'ru';
          return sendPushToCustomer(
            customer.id,
            titles[language],
            bodies[language],
            {
              notificationId: String(notificationByCustomer.get(customer.id) || ''),
              type: 'broadcast',
            },
            customer.fcm_token,
          );
        }),
      );
      totalTokens += results.reduce((sum, result) => sum + result.attempted, 0);
      count += results.reduce((sum, result) => sum + result.delivered, 0);
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
    const limit = manualBonusLimitForAdmin(req.admin);
    const parsedAmount = parseMoney(amount, 'amount', { min: -limit, max: limit });
    if (parsedAmount === 0) {
      return res.status(400).json({
        error: 'Сумма корректировки не может быть равна нулю',
        code: 'MANUAL_BONUS_ZERO_AMOUNT',
      });
    }
    const normalizedReason = normalizeManualBonusReason(reason);
    const branchScope = branchScopeForAdmin(req.admin);
    const requestedBranchId = String(req.body?.branchId || '');
    const branchId = hasGlobalBranchAccess(req.admin)
      ? requestedBranchId || null
      : branchScope.includes(requestedBranchId)
        ? requestedBranchId
        : branchScope[0];
    setAdminAuditContext(req, {
      actionCode: 'customer.bonus.adjust',
      targetType: 'customer',
      targetId: customerId,
      branchId,
      reason: normalizedReason,
      amountChange: parsedAmount,
    });
    await addManualBonus(customerId, parsedAmount, normalizedReason, { branchId });

    try {
      const { data: c } = await supabase
        .from('customers')
        .select('*')
        .eq('id', customerId)
        .single();
      if (c) {
        const actionTxt =
          parsedAmount >= 0
            ? `Начислено: +${parsedAmount} бонусов`
            : `Списано: ${parsedAmount} бонусов`;
        const msg = `<b>Изменение баланса баллов!</b>\n\n${actionTxt}\n<b>Причина:</b> ${normalizedReason}\n<b>Текущий баланс:</b> ${c.balance} бон.`;
        if (c.telegram_id) sendMessage(c.telegram_id, msg).catch(() => {});
        await notifyBonusChange({
          customerId: c.id,
          fcmToken: c.fcm_token,
          language: c.preferred_language || c.language || 'ru',
          amount: parsedAmount,
          balance: Number(c.balance),
          reason: normalizedReason,
          isOrder: false,
        });
      }
    } catch (e) {
      console.error('Notify bonus error:', e);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
};

const updateCustomerHandler = async (req, res) => {
  try {
    const { customerId, name, phone } = req.body;
    setAdminAuditContext(req, {
      actionCode: 'customer.profile.update',
      targetType: 'customer',
      targetId: customerId,
      context: {
        changedFields: [
          ...(name === undefined ? [] : ['name']),
          ...(phone === undefined ? [] : ['phone']),
        ],
      },
    });
    const updates = {
      name: name === undefined ? undefined : String(name).trim().slice(0, 160),
      phone:
        phone === undefined
          ? undefined
          : String(phone)
              .replace(/[^0-9+]/g, '')
              .slice(0, 32),
    };
    await updateCustomerInfo(customerId, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const expireInactiveHandler = async (req, res) => {
  try {
    if (!hasGlobalBranchAccess(req.admin)) {
      return res.status(403).json({ error: 'Массовое сгорание доступно только владельцу' });
    }
    const days = req.body.days || 90;
    const result = await checkAndExpireInactiveBonuses(days);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const notifyInactiveHandler = async (req, res) => {
  try {
    if (!hasGlobalBranchAccess(req.admin)) {
      return res.status(403).json({ error: 'Глобальная рассылка доступна только владельцу' });
    }
    const days = req.body.days || 30;
    const result = await checkAndNotifyInactiveCustomers(days);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

const deleteCustomerHandler = async (req, res) => {
  try {
    setAdminAuditContext(req, {
      actionCode: 'customer.privacy.delete',
      targetType: 'customer',
      targetId: req.params.id,
    });
    await deleteCustomerData(req.params.id);
    res.json({ success: true, anonymized: true });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message, code: err.code });
  }
};

const broadcastHandler = async (req, res) => {
  try {
    const { message } = req.body;
    if (!message) return res.status(400).json({ error: 'Message is required' });

    const { data: customers } = await supabase
      .from('customers')
      .select('id, telegram_id, fcm_token');

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
                sendPushToCustomer(
                  customer.id,
                  'Bulka Bonus: Новая акция!',
                  cleanText,
                  {},
                  customer.fcm_token,
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
    const optimized = await optimizeUploadedImage(buffer, match[1]);
    const objectPath = `admin/${Date.now()}-${crypto.randomBytes(8).toString('hex')}.${optimized.extension}`;
    const { error } = await supabase.storage.from('stories').upload(objectPath, optimized.buffer, {
      contentType: optimized.mime,
      cacheControl: '31536000',
      upsert: false,
    });
    if (error) throw error;
    const { data } = supabase.storage.from('stories').getPublicUrl(objectPath);
    res.json({ success: true, url: data.publicUrl, optimized: optimized.optimized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ error: 'Image upload failed' });
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
  manualBonusLimitForAdmin,
  normalizeManualBonusReason,
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

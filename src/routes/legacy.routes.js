const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');
const { buildWhatsAppContact } = require('../utils/whatsapp.util');
const { getOrCreateCustomerByPhone, getCustomerByPhone } = require('../services/customer.service');
const otpStore = require('../services/otpStore.service');
const { supabase } = require('../config/supabase');
const iikoApi = require('../services/iiko.service');
const { getStories } = require('../services/story.service');
const { getNews } = require('../services/news.service');
const path = require('path');
const { signCustomerToken, signRegistrationToken } = require('../services/auth.service');
const {
  customerAuthMiddleware,
  registrationAuthMiddleware,
} = require('../middlewares/customer-auth.middleware');
const { authRateLimit, publicApiRateLimit } = require('../middlewares/rate-limit.middleware');
const { updateFcmTokenByCustomerId, getCustomerById } = require('../services/customer.service');
const { sendApiError } = require('../utils/http.util');

// --- Helper functions (originally in old index.js) ---

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '');
}

function buildDynamicQrToken(phone, timeWindow = Math.floor(Date.now() / 300000)) {
  const digitsOnly = String(phone || '').replace(/[^0-9]/g, '');
  if (digitsOnly.length < 10) {
    const err = new Error('Valid phone required');
    err.statusCode = 400;
    throw err;
  }
  if (!process.env.BULKA_SECRET) throw new Error('BULKA_SECRET is required');
  const hash = crypto
    .createHmac('sha256', process.env.BULKA_SECRET)
    .update(`${digitsOnly}:${timeWindow}`)
    .digest('hex')
    .slice(0, 16);
  const expiresAt = (timeWindow + 1) * 300000;
  return {
    token: `BULKA-OTP-${digitsOnly}-${timeWindow}-${hash}`,
    expiresAt,
    ttlSeconds: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
  };
}

async function getCustomerTierSnapshot(customer) {
  const settings = await getSettings();
  const tiers = await getActiveLoyaltyTiers(settings);
  const tier = getTierInfo(customer.total_spent, tiers, settings);
  const highestTier = tier.allTiers[tier.allTiers.length - 1];
  return {
    tier,
    isVip: Boolean(highestTier && tier.code === highestTier.code),
    cashbackPercent: tier.percent,
    vipThreshold: highestTier?.minSpend ?? highestTier?.threshold ?? 0,
  };
}

router.post('/api/auth/request-otp', authRateLimit, async (req, res) => {
  try {
    const { token } = req.body;
    const phone = normalizePhone(req.body.phone);
    if (!phone || phone.replace(/[^0-9]/g, '').length < 10)
      return res.status(400).json({ error: 'Valid phone required' });

    // Don't create customer here тАФ only create after OTP is verified

    // If a token was provided, save it so the WhatsApp bot can map it to this phone number
    if (!/^[A-Za-z0-9]{12,64}$/.test(String(token || ''))) {
      return res.status(400).json({ error: 'Valid request token required' });
    }
    if (token) {
      await supabase.from('whatsapp_sessions').delete().lt('expires_at', new Date().toISOString());
      const { error } = await supabase.from('whatsapp_sessions').upsert({
        id: `token_${token}`,
        data: JSON.stringify({ phone, expires: Date.now() + 10 * 60 * 1000 }),
        expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      });
      if (error) throw error;
    }

    res.json({
      success: true,
      viaTelegram: false,
      ...buildWhatsAppContact(token),
    });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.post('/api/auth/verify-otp', authRateLimit, async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone);
    const { code } = req.body;
    if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });

    const stored = await otpStore.get(phone);
    if (!stored) {
      return res.json({
        success: false,
        error: 'expired',
        message: 'Код устарел или не был запрошен',
      });
    }

    if (Date.now() > stored.expires) {
      await otpStore.delete(phone);
      return res.json({
        success: false,
        error: 'expired',
        message: 'Время действия кода истекло',
      });
    }

    if (stored.code !== code) {
      const attempts = Number(stored.attempts || 0) + 1;
      if (attempts >= 5) {
        await otpStore.delete(phone);
        return res
          .status(429)
          .json({ success: false, error: 'attempts_exceeded', message: 'Запросите новый код' });
      }
      await otpStore.set(phone, { ...stored, attempts });
      return res.json({ success: false, error: 'invalid', message: 'Неверный код' });
    }

    // Success - clear OTP and check if customer exists
    await otpStore.delete(phone);

    let existingCustomer = await getCustomerByPhone(phone);
    const isPlaceholder =
      existingCustomer &&
      (!existingCustomer.name || ['Гость', 'Новый Гость'].includes(existingCustomer.name));
    if (!existingCustomer || isPlaceholder) {
      return res.json({
        success: true,
        exists: false,
        registrationToken: signRegistrationToken(phone),
      });
    }

    const customer = existingCustomer;
    const { tier, vipThreshold, isVip, cashbackPercent } = await getCustomerTierSnapshot(customer);

    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('timestamp', { ascending: false })
      .limit(20);

    res.json({
      success: true,
      exists: true,
      accessToken: signCustomerToken(customer),
      customer: {
        id: customer.id,
        last_name: customer.last_name,
        gender: customer.gender,
        birth_date: customer.birth_date,
        email: customer.email,
        region: customer.region,
        name: customer.name,
        phone: customer.phone,
        balance: customer.balance,
        total_spent: customer.total_spent,
        created_at: customer.created_at,
        isVip,
        cashbackPercent,
        vipThreshold,
        tier,
      },
      transactions: transactions || [],
    });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.post('/api/auth/register', authRateLimit, registrationAuthMiddleware, async (req, res) => {
  try {
    const phone = normalizePhone(req.registrationAuth.phone);
    const { name, surname, gender, birthdate, email } = req.body;
    if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });

    const fullName = [name, surname].filter(Boolean).join(' ').trim().slice(0, 160);
    if (!fullName) return res.status(400).json({ success: false, error: 'Name required' });
    const existingCustomer = await getCustomerByPhone(phone);
    if (existingCustomer?.name && !['Гость', 'Новый Гость'].includes(existingCustomer.name)) {
      return res.status(409).json({ success: false, error: 'Customer is already registered' });
    }
    let customer = existingCustomer || (await getOrCreateCustomerByPhone(phone, fullName));
    if (!customer) return res.status(404).json({ success: false, error: 'Cannot create customer' });

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email))) {
      return res.status(400).json({ success: false, error: 'Invalid email' });
    }
    if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(String(birthdate))) {
      return res.status(400).json({ success: false, error: 'Invalid birthdate' });
    }
    if (gender && !['m', 'f', 'male', 'female', 'other'].includes(String(gender))) {
      return res.status(400).json({ success: false, error: 'Invalid gender' });
    }

    const updateData = { name: fullName };
    if (surname) updateData.last_name = surname;
    if (email) updateData.email = email;
    if (gender) updateData.gender = gender;
    if (birthdate) updateData.birth_date = birthdate;

    const { error: updateError } = await supabase
      .from('customers')
      .update(updateData)
      .eq('id', customer.id);
    if (updateError) throw updateError;
    Object.assign(customer, updateData);

    const { tier, vipThreshold, isVip, cashbackPercent } = await getCustomerTierSnapshot(customer);

    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('timestamp', { ascending: false })
      .limit(20);

    res.json({
      success: true,
      exists: true,
      accessToken: signCustomerToken(customer),
      customer: {
        id: customer.id,
        last_name: customer.last_name,
        gender: customer.gender,
        birth_date: customer.birth_date,
        email: customer.email,
        region: customer.region,
        name: customer.name,
        phone: customer.phone,
        balance: customer.balance,
        total_spent: customer.total_spent,
        created_at: customer.created_at,
        isVip,
        cashbackPercent,
        vipThreshold,
        tier,
      },
      transactions: transactions || [],
    });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.post(
  '/api/customer/fcm-token',
  publicApiRateLimit,
  customerAuthMiddleware,
  async (req, res) => {
    try {
      const { fcmToken, language } = req.body;
      if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });
      await updateFcmTokenByCustomerId(req.customerAuth.id, fcmToken, language);
      res.json({ success: true });
    } catch (err) {
      sendApiError(res, err);
    }
  },
);

router.delete(
  '/api/customer/fcm-token',
  publicApiRateLimit,
  customerAuthMiddleware,
  async (req, res) => {
    try {
      await supabase.from('customers').update({ fcm_token: null }).eq('id', req.customerAuth.id);
      res.status(204).send();
    } catch (err) {
      sendApiError(res, err);
    }
  },
);

router.get('/api/customer/notifications', publicApiRateLimit, customerAuthMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('customer_notifications')
      .select('id,title,body,type,is_read,created_at')
      .eq('customer_id', req.customerAuth.id)
      .order('created_at', { ascending: false })
      .limit(100);
    if (error) throw error;
    res.json({ success: true, notifications: data || [] });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.post('/api/customer/notifications/read-all', publicApiRateLimit, customerAuthMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('customer_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('customer_id', req.customerAuth.id)
      .eq('is_read', false);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.post('/api/customer/notifications/:id/read', publicApiRateLimit, customerAuthMiddleware, async (req, res) => {
  try {
    const { error } = await supabase
      .from('customer_notifications')
      .update({ is_read: true, read_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('customer_id', req.customerAuth.id);
    if (error) throw error;
    res.json({ success: true });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.post('/api/guest/profile', publicApiRateLimit, customerAuthMiddleware, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    const customer = await getCustomerById(req.customerAuth.id);
    if (!customer) return res.status(404).json({ exists: false });

    if (fcmToken && customer.fcm_token !== fcmToken) {
      await updateFcmTokenByCustomerId(customer.id, fcmToken);
      customer.fcm_token = fcmToken;
    }

    const { tier, vipThreshold, isVip, cashbackPercent } = await getCustomerTierSnapshot(customer);

    // Получаем последние транзакции клиента.
    const { data: transactions } = await supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('timestamp', { ascending: false })
      .limit(20);

    res.json({
      exists: true,
      customer: {
        id: customer.id,
        last_name: customer.last_name,
        gender: customer.gender,
        birth_date: customer.birth_date,
        email: customer.email,
        region: customer.region,
        name: customer.name,
        phone: customer.phone,
        balance: customer.balance,
        total_spent: customer.total_spent,
        created_at: customer.created_at,
        isVip,
        cashbackPercent,
        vipThreshold,
        tier,
      },
      transactions: transactions || [],
    });
  } catch (err) {
    sendApiError(res, err);
  }
});

router.post('/api/guest/qr-token', publicApiRateLimit, customerAuthMiddleware, async (req, res) => {
  try {
    const customer = await getCustomerById(req.customerAuth.id);
    if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
    res.json({ success: true, ...buildDynamicQrToken(customer.phone) });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get('/api/guest/menu', async (req, res) => {
  try {
    const rawMenu = await iikoApi.getMenu();
    const stopIds = await iikoApi.getStopListProductIds(
      req.query.organizationId || iikoApi.organizationId,
    );

    // Подгружаем оверрайды из базы данных
    const menuService = require('../services/menu.service');
    const [productOverrides, categoryOverrides, customProducts] = await Promise.all([
      menuService.getProductOverrides(),
      menuService.getCategoryOverrides(),
      menuService.getCustomProducts(),
    ]);

    const prodOverridesMap = new Map(productOverrides.map(o => [o.iiko_product_id, o]));
    const catOverridesMap = new Map(categoryOverrides.map(o => [o.iiko_category_id, o]));

    // Categories
    let baseCategories = (rawMenu.groups || [])
      .filter((g) => g.isIncludedInMenu || (rawMenu.groups.length > 0 && !rawMenu.groups.some(g2 => g2.isIncludedInMenu)))
      .map((g) => ({
        id: g.id,
        name: g.name,
        order: g.order || 0,
      }));

    // Применяем оверрайды к категориям
    let categories = [];
    for (const cat of baseCategories) {
      const override = catOverridesMap.get(cat.id);
      if (override && override.is_hidden) continue;
      
      categories.push({
        id: cat.id,
        name: override?.custom_name || cat.name,
        order: override?.sort_order !== 0 ? override.sort_order : cat.order,
        imageUrl: override?.custom_image_url || null,
      });
    }

    categories.sort((a, b) => a.order - b.order);

    // Products
    let baseProducts = (rawMenu.products || []).filter(
      (p) => p.type === 'Dish' || p.type === 'Good' || (rawMenu.products.length > 0 && !rawMenu.products.some(p2 => p2.type === 'Dish' || p2.type === 'Good'))
    );

    let products = [];
    for (const p of baseProducts) {
      const override = prodOverridesMap.get(p.id);
      if (override && override.is_hidden) continue;
      
      let price = 0;
      if (p.sizePrices && p.sizePrices.length > 0) {
        price = p.sizePrices[0].price.currentPrice;
      }

      let imageUrl = null;
      if (p.imageLinks && p.imageLinks.length > 0) {
        imageUrl = p.imageLinks[0];
      }

      const isStopped = stopIds.has(p.id) || (override && override.is_stop_listed);

      products.push({
        id: p.id,
        name: p.name,
        description: override?.custom_description || p.description || '',
        price: price,
        categoryId: p.parentGroup,
        imageUrl: override?.custom_image_url || imageUrl,
        inStopList: isStopped,
        isAvailable: !isStopped,
        sortOrder: override?.sort_order || 0,
      });
    }

    // Добавляем кастомные товары (добавленные админом вручную)
    for (const cp of customProducts) {
      // Ищем или создаём категорию для кастомного товара
      let cat = categories.find(c => c.name === cp.category_name);
      let catId;
      if (cat) {
        catId = cat.id;
      } else {
        catId = 'custom-cat-' + cp.category_name.toLowerCase().replace(/\s+/g, '-');
        categories.push({
          id: catId,
          name: cp.category_name,
          order: 999, // в конец
          imageUrl: null
        });
      }

      products.push({
        id: cp.id,
        name: cp.name,
        description: cp.description || '',
        price: cp.price,
        categoryId: catId,
        imageUrl: cp.image_url,
        inStopList: !cp.is_available,
        isAvailable: cp.is_available,
        sortOrder: cp.sort_order || 0,
      });
    }

    // Сортировка товаров (если нужен кастомный порядок)
    products.sort((a, b) => a.sortOrder - b.sortOrder);

    res.json({
      success: true,
      categories,
      products,
      debug: {
        totalGroupsRaw: rawMenu.groups?.length || 0,
        totalProductsRaw: rawMenu.products?.length || 0,
        selectedOrgName: rawMenu.orgName || iikoApi.organizationId,
        overridesCount: productOverrides.length,
        customProductsCount: customProducts.length,
      },
    });
  } catch (error) {
    console.error('Ошибка получения меню:', error);
    sendApiError(res, error, { success: false });
  }
});

router.get('/api/guest/stories', async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get('/api/guest/news', async (req, res) => {
  try {
    const news = await getNews();
    res.json({ success: true, news });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get('/api/guest/locations', async (req, res) => {
  try {
    const { getCitiesWithPoints } = require('../services/location.service');
    const cities = await getCitiesWithPoints();

    const cityLocations = {};
    for (const city of cities) {
      const cityName = city.name || 'Другое';
      cityLocations[cityName] = [];
      if (city.points && Array.isArray(city.points)) {
        for (const pt of city.points) {
          const title = [pt.name, pt.address].filter(Boolean).join(', ');
          if (title) cityLocations[cityName].push(title);
        }
      }
    }
    res.json({ success: true, cityLocations });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get(['/app', '/wallet', '/guest'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'app.html'));
});

module.exports = router;

const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/admin.controller');
const tierController = require('../controllers/tier.controller');
const orderController = require('../controllers/order.controller');
const {
  adminAuditMiddleware,
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminLoginHandler,
  adminLogoutHandler,
  adminMutationRoleMiddleware,
  adminSessionHandler,
} = require('../middlewares/auth.middleware');
const { adminRateLimit, adminLoginRateLimit } = require('../middlewares/rate-limit.middleware');
const menuService = require('../services/menu.service');
const iikoApi = require('../services/iiko.service');
const { getBulkaLocations, updateBulkaLocation } = require('../services/location.service');
const { supabase } = require('../config/supabase');

const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) =>
    callback(null, allowedImageTypes.has(String(file.mimetype).toLowerCase())),
});

const detectImageType = (buffer) => {
  if (buffer?.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return { mime: 'image/jpeg', extension: 'jpg' };
  }
  if (
    buffer?.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (
    buffer?.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer?.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return { mime: 'image/webp', extension: 'webp' };
  }
  return null;
};

const validateUploadedImage = (req, res, next) => {
  if (!req.file) return res.status(400).json({ success: false, error: 'Выберите изображение' });
  const detected = detectImageType(req.file.buffer);
  if (!detected || detected.mime !== req.file.mimetype) {
    return res.status(400).json({ success: false, error: 'Допустимы JPEG, PNG и WebP до 5 МБ' });
  }
  req.detectedImageType = detected;
  return next();
};

router.use('/admin/api', adminRateLimit);
router.post('/admin/api/login', adminLoginRateLimit, adminLoginHandler);
router.post('/admin/api/logout', adminAuthMiddleware, adminAuditMiddleware, adminLogoutHandler);
router.get('/admin/api/session', adminAuthMiddleware, adminSessionHandler);
router.use(
  '/admin/api',
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminMutationRoleMiddleware,
  adminAuditMiddleware,
);

router.get('/admin/api/settings', adminAuthMiddleware, adminController.getSettingsHandler);
router.post('/admin/api/settings', adminAuthMiddleware, adminController.updateSettingsHandler);

router.get('/admin/api/loyalty-tiers', adminAuthMiddleware, tierController.listAdminTiers);
router.post('/admin/api/loyalty-tiers', adminAuthMiddleware, tierController.createAdminTier);
router.put(
  '/admin/api/loyalty-tiers/reorder',
  adminAuthMiddleware,
  tierController.reorderAdminTiers,
);

// --- MENU ADMIN ROUTES ---

// Получить сырое меню + оверрайды (для админки)
router.get('/admin/api/menu', adminAuthMiddleware, async (req, res) => {
  try {
    const rawMenu = await iikoApi.getMenu();
    const [productOverrides, categoryOverrides, customProducts] = await Promise.all([
      menuService.getProductOverrides(),
      menuService.getCategoryOverrides(),
      menuService.getCustomProducts(),
    ]);

    res.json({
      success: true,
      rawMenu,
      overrides: {
        products: productOverrides,
        categories: categoryOverrides,
        customProducts: customProducts,
      },
    });
  } catch (error) {
    console.error('Ошибка в /admin/api/menu:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// Сохранить оверрайд товара
router.post('/admin/api/menu/product/override', adminAuthMiddleware, async (req, res) => {
  try {
    const { iikoProductId, overrides } = req.body;
    await menuService.setProductOverride(iikoProductId, overrides);
    iikoApi.invalidateMenuCache(); // Сбрасываем кэш, чтобы изменения применились
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Сохранить оверрайд категории
router.post('/admin/api/menu/category/override', adminAuthMiddleware, async (req, res) => {
  try {
    const { iikoCategoryId, overrides } = req.body;
    await menuService.setCategoryOverride(iikoCategoryId, overrides);
    iikoApi.invalidateMenuCache();
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Кастомные товары
router.post('/admin/api/menu/custom-product', adminAuthMiddleware, async (req, res) => {
  try {
    await menuService.upsertCustomProduct(req.body);
    iikoApi.invalidateMenuCache();
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.delete('/admin/api/menu/custom-product/:id', adminAuthMiddleware, async (req, res) => {
  try {
    await menuService.deleteCustomProduct(req.params.id);
    iikoApi.invalidateMenuCache();
    res.json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Загрузка фото для товара
router.post(
  '/admin/api/menu/upload-image',
  adminAuthMiddleware,
  upload.single('image'),
  validateUploadedImage,
  async (req, res) => {
    try {
      if (!req.file) throw new Error('Файл не загружен');

      // Генерируем уникальное имя
      const ext = req.detectedImageType.extension;
      const fileName = `menu_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

      // Загружаем в Supabase Storage (бакет 'menu_images')
      const { error } = await supabase.storage
        .from('menu_images')
        .upload(fileName, req.file.buffer, {
          contentType: req.detectedImageType.mime,
          upsert: false,
        });

      if (error) throw new Error('Ошибка Supabase Storage: ' + error.message);

      // Получаем публичный URL
      const { data: publicUrlData } = supabase.storage.from('menu_images').getPublicUrl(fileName);

      res.json({ success: true, imageUrl: publicUrlData.publicUrl });
    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  },
);

// Автоперевод через Google Translate (Proxy)
router.post('/admin/api/translate', adminAuthMiddleware, async (req, res) => {
  try {
    const { text, targetLang } = req.body;
    if (!text) return res.json({ success: true, translated: '' });

    // Используем встроенный Node fetch или axios
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
    const response = await fetch(url);
    const data = await response.json();
    const translatedText = data[0].map((item) => item[0]).join('');

    res.json({ success: true, translated: translatedText });
  } catch (error) {
    console.error('Translation error:', error);
    res.status(500).json({ success: false, error: 'Ошибка перевода' });
  }
});
router.patch(
  '/admin/api/loyalty-tiers/:id/active',
  adminAuthMiddleware,
  tierController.setAdminTierActive,
);
router.put('/admin/api/loyalty-tiers/:id', adminAuthMiddleware, tierController.updateAdminTier);
router.delete('/admin/api/loyalty-tiers/:id', adminAuthMiddleware, tierController.deleteAdminTier);

router.get('/admin/api/customers', adminAuthMiddleware, adminController.getCustomersHandler);
router.get('/admin/api/orders', adminAuthMiddleware, orderController.listAdmin);
router.patch(
  '/admin/api/orders/:id/status',
  adminAuthMiddleware,
  orderController.updateAdminStatus,
);
router.get('/admin/api/locations', adminAuthMiddleware, async (_req, res) => {
  try {
    const locations = await getBulkaLocations({ includeInactive: true });
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, locations });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch('/admin/api/locations/:id', adminAuthMiddleware, async (req, res) => {
  try {
    const location = await updateBulkaLocation(req.params.id, req.body);
    res.json({ success: true, location });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/admin/api/transactions', adminAuthMiddleware, adminController.getTransactionsHandler);
router.get('/admin/api/stats', adminAuthMiddleware, adminController.getStatsHandler);
router.get(
  '/admin/api/iiko-operations',
  adminAuthMiddleware,
  adminController.getIikoOperationsHandler,
);

router.post('/admin/api/push/test', adminAuthMiddleware, adminController.pushTestHandler);
router.post('/admin/api/push/mass', adminAuthMiddleware, adminController.pushMassHandler);

router.post('/admin/api/customers/bonus', adminAuthMiddleware, adminController.addBonusHandler);
router.post(
  '/admin/api/customers/update',
  adminAuthMiddleware,
  adminController.updateCustomerHandler,
);
router.post(
  '/admin/api/customers/expire-inactive',
  adminAuthMiddleware,
  adminController.expireInactiveHandler,
);
router.post(
  '/admin/api/customers/notify-inactive',
  adminAuthMiddleware,
  adminController.notifyInactiveHandler,
);
router.delete(
  '/admin/api/customers/:id',
  adminAuthMiddleware,
  adminController.deleteCustomerHandler,
);
router.post('/admin/api/broadcast', adminAuthMiddleware, adminController.broadcastHandler);
router.post('/admin/api/upload', adminAuthMiddleware, adminController.uploadPhotoHandler);

router.get('/admin/api/stories', adminAuthMiddleware, adminController.getStoriesHandler);
router.post('/admin/api/stories', adminAuthMiddleware, adminController.addStoryHandler);
router.put('/admin/api/stories/:id', adminAuthMiddleware, adminController.updateStoryHandler);
router.delete('/admin/api/stories/:id', adminAuthMiddleware, adminController.deleteStoryHandler);

router.get('/admin/api/news', adminAuthMiddleware, adminController.getNewsHandler);
router.post('/admin/api/news', adminAuthMiddleware, adminController.addNewsHandler);
router.put('/admin/api/news/:id', adminAuthMiddleware, adminController.updateNewsHandler);
router.delete('/admin/api/news/:id', adminAuthMiddleware, adminController.deleteNewsHandler);

router.get('/admin/api/cities', adminAuthMiddleware, adminController.getCitiesHandler);
router.post('/admin/api/cities', adminAuthMiddleware, adminController.addCityHandler);
router.put('/admin/api/cities/:id', adminAuthMiddleware, adminController.updateCityHandler);
router.delete('/admin/api/cities/:id', adminAuthMiddleware, adminController.deleteCityHandler);

router.post('/admin/api/points', adminAuthMiddleware, adminController.addPointHandler);
router.put('/admin/api/points/:id', adminAuthMiddleware, adminController.updatePointHandler);
router.delete('/admin/api/points/:id', adminAuthMiddleware, adminController.deletePointHandler);

module.exports = router;

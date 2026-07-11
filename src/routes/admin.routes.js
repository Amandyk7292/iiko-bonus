const express = require('express');
const router = express.Router();
const multer = require('multer');
const adminController = require('../controllers/admin.controller');
const tierController = require('../controllers/tier.controller');
const { adminAuthMiddleware, adminLoginHandler } = require('../middlewares/auth.middleware');
const { adminRateLimit, adminLoginRateLimit } = require('../middlewares/rate-limit.middleware');
const menuService = require('../services/menu.service');
const iikoApi = require('../services/iiko.service');
const { supabase } = require('../config/supabase');

const upload = multer({ storage: multer.memoryStorage() });

router.use('/admin/api', adminRateLimit);
router.post('/admin/api/login', adminLoginRateLimit, adminLoginHandler);

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
      }
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
    res.status(500).json({ success: false, error: error.message });
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// Кастомные товары
router.post('/admin/api/menu/custom-product', adminAuthMiddleware, async (req, res) => {
  try {
    await menuService.upsertCustomProduct(req.body);
    iikoApi.invalidateMenuCache();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.delete('/admin/api/menu/custom-product/:id', adminAuthMiddleware, async (req, res) => {
  try {
    await menuService.deleteCustomProduct(req.params.id);
    iikoApi.invalidateMenuCache();
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Загрузка фото для товара
router.post('/admin/api/menu/upload-image', adminAuthMiddleware, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) throw new Error('Файл не загружен');
    
    // Генерируем уникальное имя
    const ext = req.file.originalname.split('.').pop();
    const fileName = `menu_${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    
    // Загружаем в Supabase Storage (бакет 'menu_images')
    const { data, error } = await supabase.storage
      .from('menu_images')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
        upsert: false
      });

    if (error) throw new Error('Ошибка Supabase Storage: ' + error.message);

    // Получаем публичный URL
    const { data: publicUrlData } = supabase.storage
      .from('menu_images')
      .getPublicUrl(fileName);

    res.json({ success: true, imageUrl: publicUrlData.publicUrl });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ success: false, error: error.message });
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

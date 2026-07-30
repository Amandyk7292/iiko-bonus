const multer = require('multer');
const { adminAuthMiddleware } = require('../../middlewares/auth.middleware');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { adminMutationSchemas } = require('../../contracts/admin-mutations.contract');
const { supabase } = require('../../config/supabase');
const menuService = require('../../services/menu.service');
const {
  getIikoClientForBranch,
  invalidateAllIikoCaches,
  profileStatus,
} = require('../../services/iiko-city-profile.service');
const realtime = require('../../services/realtime.service');
const {
  listInventory,
  syncAllBranchInventory,
  updateInventory,
} = require('../../services/inventory.service');
const { getProductOptions, saveProductOptions } = require('../../services/product-options.service');
const { optimizeUploadedImage } = require('../../utils/image.util');

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

function registerMenuAdminRoutes(router) {
  router.get('/admin/api/menu', adminAuthMiddleware, async (req, res) => {
    try {
      const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
      const rawMenu = await selectedIikoApi.getMenu();
      const [productOverrides, categoryOverrides, customProducts] = await Promise.all([
        menuService.getProductOverrides(),
        menuService.getCategoryOverrides(),
        menuService.getCustomProducts({ profileKey: selectedIikoApi.profileKey }),
      ]);

      res.json({
        success: true,
        rawMenu,
        overrides: {
          products: productOverrides,
          categories: categoryOverrides,
          customProducts,
        },
        profileKey: selectedIikoApi.profileKey,
        profiles: profileStatus(),
      });
    } catch (error) {
      console.error('Ошибка в /admin/api/menu:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  });

  router.post(
    '/admin/api/menu/sync',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.empty),
    async (req, res) => {
      try {
        const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
        const rawMenu = await selectedIikoApi.getMenu({
          strict: true,
          forceRefresh: true,
          requireExternal: true,
        });
        if (rawMenu?.menuSource !== 'external-v2' || rawMenu?.isStale === true) {
          return res.status(503).json({
            success: false,
            error: 'Не удалось получить свежее опубликованное External Menu из iiko.',
          });
        }
        const productsCount = Array.isArray(rawMenu?.products) ? rawMenu.products.length : 0;
        const categoriesCount = Array.isArray(rawMenu?.groups) ? rawMenu.groups.length : 0;
        const syncedAt = new Date().toISOString();
        const menuSource = rawMenu?.menuSource || 'unknown';
        const externalMenuId = rawMenu?.externalMenuId || null;
        const priceCategoryId = rawMenu?.priceCategoryId || null;
        const priceCategoryName = rawMenu?.priceCategoryName || null;
        const priceSource = rawMenu?.priceSource || null;

        realtime.publish(
          'menu.updated',
          {
            source: 'iiko-sync',
            menuSource,
            externalMenuId,
            priceCategoryId,
            priceCategoryName,
            priceSource,
            productsCount,
            categoriesCount,
            syncedAt,
            profileKey: selectedIikoApi.profileKey,
          },
          { broadcast: true, branchId: req.admin?.selectedBranchId || null },
        );
        res.json({
          success: true,
          profileKey: selectedIikoApi.profileKey,
          menuSource,
          externalMenuId,
          priceCategoryId,
          priceCategoryName,
          priceSource,
          productsCount,
          categoriesCount,
          syncedAt,
        });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.post(
    '/admin/api/menu/product/override',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.productOverride),
    async (req, res) => {
      try {
        const { iikoProductId, overrides } = req.body;
        await menuService.setProductOverride(iikoProductId, overrides);
        invalidateAllIikoCaches();
        realtime.publish('menu.updated', { productId: String(iikoProductId) }, { broadcast: true });
        res.json({ success: true });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.post(
    '/admin/api/menu/category/override',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.categoryOverride),
    async (req, res) => {
      try {
        const { iikoCategoryId, overrides } = req.body;
        await menuService.setCategoryOverride(iikoCategoryId, overrides);
        invalidateAllIikoCaches();
        realtime.publish(
          'menu.updated',
          { categoryId: String(iikoCategoryId) },
          { broadcast: true },
        );
        res.json({ success: true });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.post(
    '/admin/api/menu/custom-product',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.customProduct),
    async (req, res) => {
      try {
        const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
        await menuService.upsertCustomProduct(req.body, {
          profileKey: selectedIikoApi.profileKey,
        });
        invalidateAllIikoCaches();
        realtime.publish(
          'menu.updated',
          { customProduct: true, profileKey: selectedIikoApi.profileKey },
          { broadcast: true, branchId: req.admin?.selectedBranchId || null },
        );
        res.json({ success: true });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.delete(
    '/admin/api/menu/custom-product/:id',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.customProductDelete),
    async (req, res) => {
      try {
        const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
        await menuService.deleteCustomProduct(req.params.id, {
          profileKey: selectedIikoApi.profileKey,
        });
        invalidateAllIikoCaches();
        realtime.publish(
          'menu.updated',
          {
            customProductId: String(req.params.id),
            deleted: true,
            profileKey: selectedIikoApi.profileKey,
          },
          { broadcast: true, branchId: req.admin?.selectedBranchId || null },
        );
        res.json({ success: true });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.post(
    '/admin/api/menu/upload-image',
    adminAuthMiddleware,
    upload.single('image'),
    validateUploadedImage,
    validateRequest(adminMutationSchemas.empty),
    async (req, res) => {
      try {
        if (!req.file) throw new Error('Файл не загружен');

        const optimized = await optimizeUploadedImage(req.file.buffer, req.detectedImageType.mime);
        const fileName = `menu_${Date.now()}_${Math.random().toString(36).substring(7)}.${optimized.extension}`;

        const { error } = await supabase.storage
          .from('menu_images')
          .upload(fileName, optimized.buffer, {
            contentType: optimized.mime,
            cacheControl: '31536000',
            upsert: false,
          });

        if (error) throw new Error('Ошибка Supabase Storage: ' + error.message);

        const { data: publicUrlData } = supabase.storage.from('menu_images').getPublicUrl(fileName);

        res.json({
          success: true,
          imageUrl: publicUrlData.publicUrl,
          optimized: optimized.optimized,
        });
      } catch (error) {
        console.error('Upload error:', error);
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.post(
    '/admin/api/translate',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.translate),
    async (req, res) => {
      try {
        const { text, targetLang } = req.body;
        if (!text) return res.json({ success: true, translated: '' });

        const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=ru&tl=${targetLang}&dt=t&q=${encodeURIComponent(text)}`;
        const response = await fetch(url);
        const data = await response.json();
        const translatedText = data[0].map((item) => item[0]).join('');

        return res.json({ success: true, translated: translatedText });
      } catch (error) {
        console.error('Translation error:', error);
        return res.status(500).json({ success: false, error: 'Ошибка перевода' });
      }
    },
  );
}

function registerInventoryAdminRoutes(router, { assertBranchAccess, scopedBranchIds }) {
  router.get('/admin/api/inventory', async (req, res) => {
    try {
      const branchId = String(req.query.branchId || '');
      if (branchId) assertBranchAccess(req, branchId);
      const inventory = await listInventory({ branchId, branchIds: scopedBranchIds(req) });
      res.json({ success: true, inventory });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  });

  router.post(
    '/admin/api/inventory/sync',
    validateRequest(adminMutationSchemas.empty),
    async (req, res) => {
      try {
        const results = await syncAllBranchInventory({
          strict: true,
          branchIds: scopedBranchIds(req),
        });
        realtime.publish('menu.updated', { inventory: true }, { broadcast: true });
        res.json({ success: true, results });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );

  router.put(
    '/admin/api/inventory/:branchId/:productId',
    validateRequest(adminMutationSchemas.inventory),
    async (req, res) => {
      try {
        assertBranchAccess(req, req.params.branchId);
        const inventory = await updateInventory(
          req.params.branchId,
          req.params.productId,
          req.body,
        );
        realtime.publish(
          'menu.updated',
          {
            inventory: true,
            branchId: req.params.branchId,
            productId: req.params.productId,
          },
          { broadcast: true, branchId: req.params.branchId },
        );
        res.json({ success: true, inventory });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );
}

function registerMenuProductOptionAdminRoutes(router) {
  router.get('/admin/api/menu/product-options', async (req, res) => {
    try {
      const ids = String(req.query.ids || '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      res.json({ success: true, products: Object.fromEntries(await getProductOptions(ids)) });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  });

  router.put(
    '/admin/api/menu/product-options/:productId',
    validateRequest(adminMutationSchemas.productOptions),
    async (req, res) => {
      try {
        const options = await saveProductOptions(req.params.productId, req.body);
        realtime.publish(
          'menu.updated',
          { productId: req.params.productId, options: true },
          { broadcast: true },
        );
        res.json({ success: true, options });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );
}

module.exports = {
  registerInventoryAdminRoutes,
  registerMenuAdminRoutes,
  registerMenuProductOptionAdminRoutes,
};

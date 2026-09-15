const { registerPriceLabelRoutes } = require('./price-label.routes');
const multer = require('multer');
const { adminAuthMiddleware } = require('../../middlewares/auth.middleware');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { adminMutationSchemas } = require('../../contracts/admin-mutations.contract');
const { z } = require('../../middlewares/validation.middleware');
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
const { localizeCatalogField } = require('../../utils/catalog-localization.util');

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
  registerPriceLabelRoutes(router);
  router.post(
    '/admin/api/menu/products/category',
    adminAuthMiddleware,
    validateRequest(adminMutationSchemas.moveMenuProducts),
    async (req, res) => {
      try {
        const client = await getIikoClientForBranch(req.admin?.selectedBranchId);
        if (req.body.profileKey !== client.profileKey) {
          return res
            .status(409)
            .json({ success: false, error: 'Город изменился. Обновите меню перед переносом.' });
        }
        const rawMenu = await client.getMenu({ strict: true });
        const productIds = await menuService.moveProductsToCategory(
          req.body.productIds,
          req.body.categoryId,
          {
            profileKey: client.profileKey,
            rawMenu,
          },
        );
        realtime.publish(
          'menu.updated',
          { productIds, profileKey: client.profileKey },
          { broadcast: true },
        );
        res.json({ success: true, productIds });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );
  const {
    loadCashierCatalog,
    updateCashierProduct,
    beginTabletStockControl,
  } = require('../../services/cashier-catalog.service');
  router.get('/admin/api/staff/catalog', async (req, res) => {
    try {
      res.json({
        success: true,
        ...(await loadCashierCatalog(req.admin, req.query.scope === 'preorder')),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  });
  router.patch(
    '/admin/api/staff/catalog/:productId',
    validateRequest(adminMutationSchemas.cashierInventory),
    async (req, res) => {
      try {
        const inventory = await updateCashierProduct(
          req.admin,
          String(req.params.productId),
          req.body,
        );
        res.json({ success: true, inventory });
      } catch (error) {
        res.status(error.statusCode || 500).json({ success: false, error: error.message });
      }
    },
  );
  router.post(
    '/admin/api/staff/catalog/fallback',
    validateRequest({
      body: z.object({ requestId: z.string().uuid(), confirmed: z.literal(true) }).strict(),
    }),
    async (req, res, next) => {
      try {
        res.json({ success: true, ...(await beginTabletStockControl(req.admin, req.body)) });
      } catch (error) {
        next(error);
      }
    },
  );

  router.get('/admin/api/menu', adminAuthMiddleware, async (req, res) => {
    try {
      const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
      const rawMenu = await selectedIikoApi.getMenu();
      const [productOverrides, categoryOverrides, customProducts] = await Promise.all([
        menuService.getProductOverrides({ profileKey: selectedIikoApi.profileKey }),
        menuService.getCategoryOverrides({ profileKey: selectedIikoApi.profileKey }),
        menuService.getCustomProducts({ profileKey: selectedIikoApi.profileKey }),
      ]);
      const overridesById = new Map(productOverrides.map((row) => [row.iiko_product_id, row]));
      const products = (rawMenu.products || []).map((product) => {
        const override = overridesById.get(product.id);
        const russianName = localizeCatalogField(override, 'name', product.name || '', 'ru');
        const kazakhName = localizeCatalogField(override, 'name', product.name || '', 'kk');
        const russianDescription = localizeCatalogField(
          override,
          'description',
          product.description || '',
          'ru',
        );
        const kazakhDescription = localizeCatalogField(
          override,
          'description',
          product.description || '',
          'kk',
        );
        return {
          ...product,
          nameKk: override?.name_translations?.kk || (kazakhName !== russianName ? kazakhName : ''),
          descriptionRu: russianDescription,
          descriptionKk:
            override?.description_translations?.kk ||
            (kazakhDescription !== russianDescription ? kazakhDescription : ''),
        };
      });

      res.json({
        success: true,
        rawMenu: { ...rawMenu, products },
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
        const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
        await menuService.setProductOverride(iikoProductId, overrides, {
          profileKey: selectedIikoApi.profileKey,
        });
        realtime.publish(
          'menu.updated',
          { productId: String(iikoProductId), profileKey: selectedIikoApi.profileKey },
          { broadcast: true },
        );
        res.locals.clientDataPublished = true;
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
        const selectedIikoApi = await getIikoClientForBranch(req.admin?.selectedBranchId);
        await menuService.setCategoryOverride(iikoCategoryId, overrides, {
          profileKey: selectedIikoApi.profileKey,
        });
        realtime.publish(
          'menu.updated',
          { categoryId: String(iikoCategoryId), profileKey: selectedIikoApi.profileKey },
          { broadcast: true },
        );
        res.locals.clientDataPublished = true;
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
    [
      '/admin/api/menu/upload-image',
      '/admin/api/loyalty-tiers/upload-image',
      '/admin/api/menu/upload-photo',
    ],
    adminAuthMiddleware,
    upload.single('image'),
    validateUploadedImage,
    (req, res, next) =>
      validateRequest(
        req.path === '/admin/api/menu/upload-photo'
          ? adminMutationSchemas.menuPhotoUpload
          : adminMutationSchemas.empty,
      )(req, res, next),
    async (req, res) => {
      try {
        if (!req.file) throw new Error('Файл не загружен');

        const target = req.path === '/admin/api/menu/upload-photo' ? req.body : null;
        if (target) {
          const client = await getIikoClientForBranch(req.admin?.selectedBranchId);
          if (target.profileKey !== client.profileKey) {
            return res.status(409).json({
              success: false,
              error: 'Город изменился. Обновите меню перед загрузкой фото.',
            });
          }
        }

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

        // Finish the binding on the server, even if the originating page is closed
        // after the file has arrived. Raw iiko data is unchanged by a photo override.
        if (target) {
          const patch = { custom_image_url: publicUrlData.publicUrl };
          const scope = { profileKey: target.profileKey };
          if (target.targetType === 'product') {
            await menuService.setProductOverride(target.targetId, patch, scope);
          } else {
            await menuService.setCategoryOverride(target.targetId, patch, scope);
          }
          realtime.publish(
            'menu.updated',
            {
              [target.targetType === 'product' ? 'productId' : 'categoryId']: target.targetId,
              profileKey: target.profileKey,
            },
            { broadcast: true },
          );
          res.locals.clientDataPublished = true;
        }

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

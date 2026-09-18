const express = require('express');
const multer = require('multer');
const path = require('node:path');
const { z } = require('zod');
const { supabase } = require('../config/supabase');
const { adminAuthMiddleware } = require('../middlewares/auth.middleware');
const { emptyBodySchema, validateRequest } = require('../middlewares/validation.middleware');
const { rowsFromWorkbook } = require('../services/price-generator-xlsx.service');

const router = express.Router();
const root = path.resolve(__dirname, '../../public/pricegenerator');
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter(_req, file, callback) {
    callback(null, /\.xlsx$/i.test(file.originalname));
  },
});
const fieldSchema = z
  .object({
    x: z.number().min(0).max(500),
    y: z.number().min(0).max(500),
    w: z.number().min(1).max(500),
    h: z.number().min(1).max(500),
    font: z.number().min(1).max(100),
    weight: z.number().int().min(100).max(900).optional(),
    lineHeight: z.number().min(0.7).max(3).optional(),
    breakLanguages: z.boolean().optional(),
    align: z.enum(['left', 'center', 'right']),
    visible: z.boolean(),
  })
  .strict();
const templateSchema = z
  .object({
    layout: z
      .object({
        name: fieldSchema,
        composition: fieldSchema,
        barcode: fieldSchema,
        dates: fieldSchema,
        price: fieldSchema,
      })
      .strict(),
    label: z
      .object({
        width: z.number().min(20).max(500),
        height: z.number().min(20).max(500),
        radius: z.number().min(0).max(50),
        background: z.string().regex(/^#[0-9a-f]{6}$/i),
        foreground: z.string().regex(/^#[0-9a-f]{6}$/i),
        offsetX: z.number().min(-20).max(20).optional(),
        offsetY: z.number().min(-20).max(20).optional(),
      })
      .strict(),
    paper: z
      .object({
        width: z.number().min(20).max(1000),
        height: z.number().min(20).max(1000),
        gapX: z.number().min(0).max(100),
        gapY: z.number().min(0).max(100),
        margin: z.number().min(0).max(100),
      })
      .strict(),
  })
  .strict();
const TEMPLATE_KEY = 'price_generator_template_v1';
const PRODUCTS_KEY = 'price_generator_products_v1';
const HISTORY_KEY = 'price_generator_history_v1';
const CITY_KEYS = new Set(['aktau', 'astana']);
const cityFromRequest = (req) =>
  CITY_KEYS.has(String(req.query?.city || '').toLowerCase())
    ? String(req.query.city).toLowerCase()
    : 'aktau';
const citySettingKey = (baseKey, req) => {
  const city = cityFromRequest(req);
  return city === 'aktau' ? baseKey : `${baseKey}_${city}`;
};
const productSchema = z
  .object({
    id: z.string().min(1).max(100),
    name: z.string().min(1).max(300),
    composition: z.string().max(5000),
    price: z.string().max(50),
    expiry: z.string().max(20),
    expiryUnit: z.enum(['days', 'hours']).optional(),
    barcode: z.string().max(100),
    archived: z.boolean().optional(),
  })
  .strict();
const productsSchema = z.array(productSchema).max(2000);
const productSaveSchema = z
  .object({
    products: productsSchema,
    action: z
      .object({
        type: z.enum(['save', 'archive', 'restore', 'duplicate', 'import']),
        productId: z.string().max(100).optional(),
        productName: z.string().max(300).optional(),
      })
      .strict(),
  })
  .strict();
const ownerOrAdminOnly = (req, res, next) => {
  if (!['owner', 'admin'].includes(String(req.admin?.role || ''))) {
    return res
      .status(403)
      .json({ success: false, error: 'Доступно только владельцу или администратору.' });
  }
  return next();
};

router.get('/api/pricegenerator/template', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', citySettingKey(TEMPLATE_KEY, req))
      .maybeSingle();
    if (error) throw error;
    const parsed = data?.value ? templateSchema.safeParse(JSON.parse(data.value)) : null;
    return res.json({ success: true, template: parsed?.success ? parsed.data : null });
  } catch {
    return res.status(503).json({ success: false, error: 'Не удалось загрузить общий шаблон.' });
  }
});

router.get('/api/pricegenerator/products', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('settings')
      .select('value')
      .eq('key', citySettingKey(PRODUCTS_KEY, req))
      .maybeSingle();
    if (error) throw error;
    const parsed = data?.value ? productsSchema.safeParse(JSON.parse(data.value)) : null;
    return res.json({ success: true, products: parsed?.success ? parsed.data : null });
  } catch {
    return res.status(503).json({ success: false, error: 'Не удалось загрузить товары.' });
  }
});

router.get(
  '/admin/api/pricegenerator/history',
  adminAuthMiddleware,
  ownerOrAdminOnly,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('settings')
        .select('value')
        .eq('key', citySettingKey(HISTORY_KEY, req))
        .maybeSingle();
      if (error) throw error;
      const history = data?.value ? JSON.parse(data.value) : [];
      return res.json({
        success: true,
        history: Array.isArray(history) ? history.slice(0, 100) : [],
      });
    } catch {
      return res.status(503).json({ success: false, error: 'Не удалось загрузить историю.' });
    }
  },
);

router.post(
  '/admin/api/pricegenerator/template',
  adminAuthMiddleware,
  ownerOrAdminOnly,
  validateRequest({ body: templateSchema }),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from('settings')
        .upsert(
          { key: citySettingKey(TEMPLATE_KEY, req), value: JSON.stringify(req.body) },
          { onConflict: 'key' },
        );
      if (error) throw error;
      return res.json({ success: true, template: req.body });
    } catch {
      return res.status(503).json({ success: false, error: 'Не удалось сохранить общий шаблон.' });
    }
  },
);

router.post(
  '/admin/api/pricegenerator/products',
  adminAuthMiddleware,
  ownerOrAdminOnly,
  validateRequest({ body: productSaveSchema }),
  async (req, res) => {
    try {
      const { data: historyRow, error: historyReadError } = await supabase
        .from('settings')
        .select('value')
        .eq('key', citySettingKey(HISTORY_KEY, req))
        .maybeSingle();
      if (historyReadError) throw historyReadError;
      const oldHistory = historyRow?.value ? JSON.parse(historyRow.value) : [];
      const history = [
        {
          ...req.body.action,
          username: String(req.admin?.username || req.admin?.sub || 'admin'),
          at: new Date().toISOString(),
        },
        ...(Array.isArray(oldHistory) ? oldHistory : []),
      ].slice(0, 100);
      const { error } = await supabase.from('settings').upsert(
        [
          { key: citySettingKey(PRODUCTS_KEY, req), value: JSON.stringify(req.body.products) },
          { key: citySettingKey(HISTORY_KEY, req), value: JSON.stringify(history) },
        ],
        { onConflict: 'key' },
      );
      if (error) throw error;
      return res.json({ success: true, products: req.body.products, history });
    } catch {
      return res.status(503).json({ success: false, error: 'Не удалось сохранить товары.' });
    }
  },
);

router.post(
  '/admin/api/pricegenerator/import',
  adminAuthMiddleware,
  ownerOrAdminOnly,
  upload.single('file'),
  validateRequest({ body: emptyBodySchema }),
  (req, res) => {
    if (!req.file)
      return res.status(400).json({ success: false, error: 'Выберите Excel-файл .xlsx.' });
    try {
      const products = rowsFromWorkbook(req.file.buffer);
      return res.json({ success: true, products });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: error instanceof Error ? error.message : 'Не удалось прочитать Excel.',
      });
    }
  },
);

router.get(['/pricegenerator', '/pricegenerator/'], (_req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.set('X-Robots-Tag', 'noindex, nofollow');
  res.sendFile(path.join(root, 'index.html'));
});
router.use('/pricegenerator', express.static(root, { index: false, maxAge: '1h' }));

module.exports = router;

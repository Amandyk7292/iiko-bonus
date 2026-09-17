const express = require('express');
const multer = require('multer');
const path = require('node:path');
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

router.post(
  '/admin/api/pricegenerator/import',
  adminAuthMiddleware,
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

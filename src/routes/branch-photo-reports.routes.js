const express = require('express');
const path = require('node:path');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { validateRequest } = require('../middlewares/validation.middleware');
const { uploadBody, sessionBody } = require('../contracts/branch-photo-reports.contract');
const { openSession, resolveSession, fail } = require('../services/branch-photo-reports.service');
const { submitPhotos } = require('../services/branch-photo-upload.service');
const realtime = require('../services/realtime.service');
const router = express.Router();
const headers = (_req, res, next) => {
  res.set({
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(self), microphone=(), geolocation=()',
    'X-Robots-Tag': 'noindex, nofollow',
  });
  next();
};
router.use(
  '/branch-reports',
  headers,
  express.static(path.resolve(__dirname, '../../public/branch-reports'), {
    index: 'index.html',
    dotfiles: 'deny',
    redirect: false,
  }),
);
router.get('/branch-reports', headers, (_req, res) =>
  res.sendFile(path.resolve(__dirname, '../../public/branch-reports/index.html')),
);
const requestLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много попыток. Подождите минуту.' },
});
const uploadLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 30,
  keyGenerator: (req) => req.closingSession.branch_id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много отправок. Обратитесь к управляющему.' },
});
router.use('/api/branch-reports', headers, requestLimit, (req, res, next) => {
  // Public QR credentials authorize only this form; reject third-party origins.
  if (
    req.headers.origin &&
    req.headers.origin !== new URL(process.env.PUBLIC_BASE_URL || 'https://bulka.com.kz').origin &&
    process.env.NODE_ENV === 'production'
  )
    return res.status(403).json({ error: 'Недопустимый источник запроса' });
  if (req.headers['sec-fetch-site'] === 'cross-site')
    return res.status(403).json({ error: 'Недопустимый источник запроса' });
  next();
});
router.post(
  '/api/branch-reports/session',
  validateRequest({ body: sessionBody }),
  async (req, res, next) => {
    try {
      res.json({
        success: true,
        ...(await openSession(req.headers['x-bulka-report-token'], { shift: req.body.shift })),
      });
    } catch (error) {
      next(error);
    }
  },
);
const captureUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2000000, files: 10, fields: 2, parts: 12 },
  fileFilter: (_req, file, cb) =>
    cb(
      file.mimetype === 'image/jpeg' ? null : fail('Принимаются только снимки камеры JPEG', 415),
      file.mimetype === 'image/jpeg',
    ),
});
const parse = (req, res, next) =>
  captureUpload.array('photos', 10)(req, res, (error) => {
    if (!error) return next();
    res
      .status(error.statusCode || 413)
      .json({ error: 'Не более 10 снимков, до 2 МБ каждый.', code: 'PHOTO_REPORT_UPLOAD_LIMIT' });
  });
router.post(
  '/api/branch-reports/submit',
  async (req, _res, next) => {
    try {
      req.closingSession = await resolveSession(req.headers['x-bulka-report-session']);
      next();
    } catch (error) {
      next(error);
    }
  },
  uploadLimit,
  parse,
  validateRequest({ body: uploadBody }),
  async (req, res, next) => {
    try {
      const result = await submitPhotos(req.headers['x-bulka-report-session'], req.body, req.files);
      realtime.publish(
        'photo-reports.updated',
        { branchId: req.closingSession.branch_id },
        { adminOnly: true, branchId: req.closingSession.branch_id },
      );
      res.json({ success: true, ...result });
    } catch (error) {
      next(error);
    }
  },
);
module.exports = router;

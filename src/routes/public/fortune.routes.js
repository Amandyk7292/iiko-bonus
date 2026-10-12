const path = require('node:path');
const express = require('express');
const multer = require('multer');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const { validateRequest } = require('../../middlewares/validation.middleware');
const { readCookieToken } = require('../../services/auth.service');
const { hash, opaqueToken, failure } = require('../../services/fortune-common');
const { fortuneService } = require('../../services/fortune.service');
const c = require('../../contracts/fortune.contract');
const cookieName = '__Host-bulka_fortune';
const limiter = (limit, windowMs) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(req.ip),
    message: {
      success: false,
      code: 'FORTUNE_RATE_LIMIT',
      error: 'Слишком много попыток. Попробуйте позже',
    },
  });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (_req, file, cb) =>
    cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
}).single('photo');
function sameOrigin(req, _res, next) {
  const origin = String(req.headers.origin || '');
  if (
    req.headers['sec-fetch-site'] === 'cross-site' ||
    (origin &&
      !['https://bulka.com.kz', 'https://www.bulka.com.kz'].includes(origin) &&
      !(process.env.NODE_ENV === 'test' && origin === 'http://localhost'))
  )
    return next(failure('FORTUNE_FORBIDDEN', 403));
  next();
}
function guest(req, res, next) {
  let value;
  try {
    value = readCookieToken(req, cookieName);
  } catch {
    /* Invalid cookies get a fresh opaque guest. */
  }
  if (!/^[A-Za-z0-9_-]{43}$/.test(value || '')) {
    value = opaqueToken();
    res.cookie(cookieName, value, {
      secure: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 86400000,
    });
  }
  req.fortuneGuestHash = hash(value);
  next();
}
const handle = (work) => async (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  try {
    res.json({ success: true, ...(await work(req)) });
  } catch (error) {
    next(error);
  }
};
function registerFortunePublicRoutes(router, service = fortuneService) {
  router.use('/api/fortune', limiter(60, 60000), guest);
  router.get(
    '/api/fortune/:campaignId/:branchId',
    validateRequest({ params: c.wheelParams }),
    handle((req) => service.wheel(req.params.campaignId, req.params.branchId)),
  );
  router.post(
    '/api/fortune/:campaignId/:branchId/receipt',
    sameOrigin,
    limiter(8, 15 * 60000),
    validateRequest({ params: c.wheelParams }),
    (req, res, next) => {
      upload(req, res, (error) => {
        if (error || !req.file?.buffer?.length)
          return next(
            Object.assign(failure('FORTUNE_RECEIPT_INVALID', 422), {
              message:
                error?.code === 'LIMIT_FILE_SIZE'
                  ? 'Фото должно быть меньше 8 МБ'
                  : 'Прикрепите фото чека в JPEG, PNG или WebP',
            }),
          );
        return handle((request) =>
          service.receipt(
            request.params.campaignId,
            request.params.branchId,
            request.fortuneGuestHash,
            request.file.buffer,
          ),
        )(req, res, next);
      });
    },
  );
  router.post(
    '/api/fortune/:campaignId/:branchId/spin',
    sameOrigin,
    limiter(20, 60000),
    validateRequest({ params: c.wheelParams, body: c.spinBody }),
    handle((req) =>
      service.spin(
        req.params.campaignId,
        req.params.branchId,
        req.fortuneGuestHash,
        req.body.receiptToken,
      ),
    ),
  );
}
function registerFortuneCustomerRoutes(router, service = fortuneService) {
  router.get(
    '/api/customer/fortune/prizes',
    handle((req) => service.list(req.customerAuth.id)),
  );
  router.post(
    '/api/customer/fortune/claim',
    limiter(20, 60000),
    validateRequest({ body: c.claimBody }),
    handle((req) => service.claim(req.customerAuth.id, req.body.claimToken)),
  );
  router.post(
    '/api/customer/fortune/prizes/:id/redeem',
    validateRequest({ params: c.idParams, body: c.empty }),
    handle((req) => service.redeemBonus(req.customerAuth.id, req.params.id)),
  );
}
function registerFortunePage(app) {
  const directory = path.join(process.cwd(), 'public', 'fortune');
  app.use(
    '/fortune-assets',
    express.static(directory, {
      index: false,
      setHeaders: (res) => res.set('Cache-Control', 'no-cache'),
    }),
  );
  app.get(
    '/fortune/:campaignId/:branchId',
    validateRequest({ params: c.wheelParams }),
    (_req, res) =>
      res.set('Cache-Control', 'no-store').sendFile(path.join(directory, 'index.html')),
  );
}
module.exports = {
  registerFortunePublicRoutes,
  registerFortuneCustomerRoutes,
  registerFortunePage,
};

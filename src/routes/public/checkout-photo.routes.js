const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { validateRequest, emptyBodySchema, z } = require('../../middlewares/validation.middleware');
const { sendApiError } = require('../../utils/http.util');
const service = require('../../services/pickup-photo-gift.service');
const {
  pickupPhotoParamsSchema,
  pickupPhotoCapabilitySchema,
} = require('../../contracts/pickup-photo-gift.contract');

function registerCheckoutPhotoRoutes(router, photos = service) {
  const quota = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 6,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.customerAuth.id,
    message: {
      success: false,
      code: 'PICKUP_PHOTO_RATE_LIMITED',
      error: 'Слишком много фото. Попробуйте позже.',
    },
  });
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: service.MAX_UPLOAD_BYTES, files: 1, fields: 0 },
  }).single('photo');
  const authenticated = (req, res, next) =>
    req.customerAuth?.id
      ? next()
      : res.status(401).json({ success: false, code: 'CUSTOMER_SESSION_INVALID' });
  router.get(
    '/api/customer/checkout-photo/capability',
    authenticated,
    validateRequest({ query: pickupPhotoCapabilitySchema }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        res.json({ success: true, ...(await photos.photoCapability(req.query.branchId)) });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
  router.post(
    '/api/customer/checkout-photo',
    authenticated,
    quota,
    validateRequest({ query: z.object({}).strict() }),
    (req, res) =>
      upload(req, res, async (error) => {
        res.setHeader('Cache-Control', 'private, no-store');
        if (error)
          return res.status(error.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
            success: false,
            code:
              error.code === 'LIMIT_FILE_SIZE' ? 'PICKUP_PHOTO_TOO_LARGE' : 'PICKUP_PHOTO_FORMAT',
            error: 'Выберите одно фото JPEG, PNG или WebP размером до 5 МБ.',
          });
        try {
          res
            .status(201)
            .json({ success: true, ...(await photos.uploadPhoto(req.customerAuth.id, req.file)) });
        } catch (caught) {
          sendApiError(res, caught, { success: false });
        }
      }),
  );
  router.get(
    '/api/customer/checkout-photo/:id/image',
    authenticated,
    validateRequest({ params: pickupPhotoParamsSchema, query: z.object({}).strict() }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        res.type('image/jpeg').send(await photos.customerPhoto(req.customerAuth.id, req.params.id));
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
  router.delete(
    '/api/customer/checkout-photo/:id',
    authenticated,
    validateRequest({ params: pickupPhotoParamsSchema, body: emptyBodySchema }),
    async (req, res) => {
      res.setHeader('Cache-Control', 'private, no-store');
      try {
        res.json({
          success: true,
          ...(await photos.deleteCustomerPhoto(req.customerAuth.id, req.params.id)),
        });
      } catch (error) {
        sendApiError(res, error, { success: false });
      }
    },
  );
}
module.exports = { registerCheckoutPhotoRoutes };

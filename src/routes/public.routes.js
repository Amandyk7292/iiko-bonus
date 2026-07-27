const express = require('express');
const crypto = require('crypto');
const multer = require('multer');
const router = express.Router();
const publicController = require('../controllers/public.controller');
const tierController = require('../controllers/tier.controller');
const orderController = require('../controllers/order.controller');
const addressController = require('../controllers/address.controller');
const geocodeController = require('../controllers/geocode.controller');
const {
  customerAuthMiddleware,
  registrationAuthMiddleware,
} = require('../middlewares/customer-auth.middleware');
const {
  authRateLimit,
  courierProofRateLimit,
  publicApiRateLimit,
  webhookRateLimit,
} = require('../middlewares/rate-limit.middleware');
const realtime = require('../services/realtime.service');
const { listAvailableSlots } = require('../services/slot.service');
const { recordCustomerEvents } = require('../services/analytics-event.service');
const { supabase } = require('../config/supabase');
const {
  authenticateCourier,
  confirmCourierDelivery,
  listCourierOrders,
  requestCourierLogin,
  revokeCourierSession,
  updateCourierLocation,
  updateCourierOrderStatus,
  verifyCourierLogin,
} = require('../services/courier.service');
const { readCookieToken } = require('../services/auth.service');
const { getProductOptions } = require('../services/product-options.service');
const personalization = require('../services/personalization.service');
const reviews = require('../services/review.service');
const marketing = require('../services/commerce-marketing.service');
const notificationPreferences = require('../services/notification-preferences.service');
const support = require('../services/support.service');
const liveActivity = require('../services/live-activity.service');
const contactCenter = require('../services/contact-center.service');
const { optimizeUploadedImage } = require('../utils/image.util');
const { validateRequest } = require('../middlewares/validation.middleware');
const {
  courierAuthRequestBodySchema,
  courierAuthVerifyBodySchema,
  courierConfirmDeliveryBodySchema,
  courierLocationBodySchema,
  courierOrderParamsSchema,
  courierOrderStatusBodySchema,
  liveActivityBodySchema,
  liveActivityDeleteBodySchema,
  notificationPreferencesBodySchema,
  profileUpdateBodySchema,
  supportCreateBodySchema,
  supportMessageBodySchema,
  supportRequestParamsSchema,
} = require('../contracts/customer-api.contract');

const referenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) =>
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(String(file.mimetype))),
});

const deliveryProofUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) =>
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(String(file.mimetype))),
});

const supportUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback) =>
    callback(null, ['image/jpeg', 'image/png', 'image/webp'].includes(String(file.mimetype))),
});

const detectReferenceImage = (buffer) => {
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

router.use('/api/public', publicApiRateLimit);
router.use('/api/customer', publicApiRateLimit, customerAuthMiddleware);
router.use('/api/courier', publicApiRateLimit);

const courierSessionMiddleware = async (req, res, next) => {
  try {
    const authenticated = await authenticateCourier(readCookieToken(req, 'bulka_courier'));
    req.courier = authenticated.courier;
    req.courierSession = authenticated.session;
    return next();
  } catch (error) {
    return res.status(error.statusCode || 401).json({ success: false, error: error.message });
  }
};

const courierMutationOrigin = (req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = String(req.headers.origin || '');
  try {
    if (!origin || new URL(origin).host !== req.get('host')) throw new Error('Origin mismatch');
  } catch {
    return res.status(403).json({ success: false, error: 'Недопустимый источник запроса' });
  }
  return next();
};

router.post(
  '/api/courier/auth/request',
  authRateLimit,
  courierMutationOrigin,
  validateRequest({ body: courierAuthRequestBodySchema }),
  async (req, res) => {
    try {
      res.json({ success: true, ...(await requestCourierLogin(req.body.phone)) });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        ...(error.code && { code: error.code }),
      });
    }
  },
);

router.post(
  '/api/courier/auth/verify',
  authRateLimit,
  courierMutationOrigin,
  validateRequest({ body: courierAuthVerifyBodySchema }),
  async (req, res) => {
    try {
      const session = await verifyCourierLogin(req.body.phone, req.body.code, {
        ip: req.ip,
        userAgent: req.get('user-agent') || '',
      });
      const secure = process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER);
      res.cookie('bulka_courier', session.token, {
        httpOnly: true,
        secure,
        sameSite: 'strict',
        path: '/api/courier',
        expires: new Date(session.expiresAt),
      });
      res.json({
        success: true,
        expiresAt: session.expiresAt,
        courier: session.courier,
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

router.get('/api/courier/session', courierSessionMiddleware, (req, res) => {
  res.set('Cache-Control', 'private, no-store');
  res.json({
    success: true,
    expiresAt: req.courierSession.expires_at,
    courier: {
      id: req.courier.id,
      name: req.courier.name,
      phone: req.courier.phone,
      vehicle: req.courier.vehicle || null,
    },
  });
});

router.delete(
  '/api/courier/session',
  courierSessionMiddleware,
  courierMutationOrigin,
  async (req, res) => {
    try {
      await revokeCourierSession(req.courier.id, req.courierSession.id);
      res.clearCookie('bulka_courier', {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER),
        sameSite: 'strict',
        path: '/api/courier',
      });
      res.json({ success: true });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

router.get('/api/courier/orders', courierSessionMiddleware, async (req, res) => {
  try {
    res.set('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      courier: {
        id: req.courier.id,
        name: req.courier.name,
        vehicle: req.courier.vehicle || null,
      },
      orders: await listCourierOrders(req.courier.id),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

router.patch(
  '/api/courier/location',
  courierSessionMiddleware,
  courierMutationOrigin,
  validateRequest({ body: courierLocationBodySchema }),
  async (req, res) => {
    try {
      const updated = await updateCourierLocation(
        req.courier.id,
        req.body.latitude,
        req.body.longitude,
        req.courierSession.id,
      );
      realtime.publish(
        'courier.updated',
        {
          courierId: req.courier.id,
          latitude: updated.latitude,
          longitude: updated.longitude,
          locationUpdatedAt: updated.locationUpdatedAt,
        },
        { adminOnly: true },
      );
      const { data: assignedOrders } = await supabase
        .from('kaspi_orders')
        .select('id,customer_id,branch_id')
        .eq('courier_id', req.courier.id)
        .eq('status', 'paid')
        .not('delivery_status', 'in', '(delivered,cancelled)');
      for (const order of assignedOrders || []) {
        realtime.publish(
          'order.updated',
          { orderId: order.id, courierLocationUpdated: true },
          {
            customerId: order.customer_id,
            includeAdmins: true,
            branchId: order.branch_id,
          },
        );
      }
      res.json({ success: true, locationUpdatedAt: updated.locationUpdatedAt });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);

router.patch(
  '/api/courier/orders/:orderId/status',
  courierSessionMiddleware,
  courierMutationOrigin,
  validateRequest({
    params: courierOrderParamsSchema,
    body: courierOrderStatusBodySchema,
  }),
  async (req, res) => {
    try {
      const order = await updateCourierOrderStatus(
        req.courier.id,
        req.params.orderId,
        req.body.status,
        req.courierSession.id,
      );
      realtime.publish(
        'order.updated',
        {
          orderId: order.id,
          orderNumber: order.order_number,
          orderStatus: order.fulfillment_status,
          deliveryStatus: order.delivery_status,
        },
        {
          customerId: order.customer_id,
          includeAdmins: true,
          branchId: order.branch_id,
        },
      );
      res.json({ success: true, deliveryStatus: order.delivery_status });
    } catch (error) {
      res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        ...(error.code && { code: error.code }),
      });
    }
  },
);

router.post(
  '/api/courier/orders/:orderId/confirm-delivery',
  courierProofRateLimit,
  courierSessionMiddleware,
  courierMutationOrigin,
  deliveryProofUpload.single('photo'),
  validateRequest({
    params: courierOrderParamsSchema,
    body: courierConfirmDeliveryBodySchema,
  }),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Добавьте фото подтверждения' });
      }
      const detected = detectReferenceImage(req.file.buffer);
      if (!detected || detected.mime !== req.file.mimetype) {
        return res
          .status(400)
          .json({ success: false, error: 'Допустимы JPEG, PNG и WebP до 6 МБ' });
      }
      const optimized = await optimizeUploadedImage(req.file.buffer, detected.mime);
      const order = await confirmCourierDelivery({
        courierId: req.courier.id,
        sessionId: req.courierSession.id,
        orderId: req.params.orderId,
        pin: req.body?.pin,
        photo: optimized.buffer,
        imageType: { mime: optimized.mime, extension: optimized.extension },
        latitude: req.body?.latitude || null,
        longitude: req.body?.longitude || null,
      });
      realtime.publish(
        'order.updated',
        {
          orderId: order.id,
          orderNumber: order.order_number,
          orderStatus: order.fulfillment_status,
          deliveryStatus: order.delivery_status,
        },
        {
          customerId: order.customer_id,
          includeAdmins: true,
          branchId: order.branch_id,
        },
      );
      return res.json({ success: true, deliveryStatus: order.delivery_status });
    } catch (error) {
      return res.status(error.statusCode || 500).json({
        success: false,
        error: error.message,
        ...(error.code && { code: error.code }),
      });
    }
  },
);

router.get('/', publicController.renderApp);
router.get('/admin', publicController.renderAdmin);
router.post(
  '/api/register-iiko',
  publicApiRateLimit,
  registrationAuthMiddleware,
  publicController.registerIiko,
);

router.get('/api/customer/profile', publicController.getProfile);
router.put(
  '/api/customer/profile',
  validateRequest({ body: profileUpdateBodySchema }),
  publicController.updateProfile,
);
router.delete('/api/customer/profile', publicController.deleteProfile);
router.get('/api/customer/profile/export', publicController.exportProfile);
router.get('/api/customer/loyalty', tierController.getCustomerLoyalty);
router.get('/api/customer/orders', orderController.listCustomer);
router.post('/api/customer/orders/:id/arrived', orderController.markArrived);
router.get('/api/customer/events', (req, res) =>
  realtime.openStream(req, res, { customerId: req.customerAuth.id }),
);
router.get('/api/customer/notification-preferences', async (req, res) => {
  try {
    res.json({
      success: true,
      preferences: await notificationPreferences.getNotificationPreferences(req.customerAuth.id),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.patch(
  '/api/customer/notification-preferences',
  validateRequest({ body: notificationPreferencesBodySchema }),
  async (req, res) => {
    try {
      res.json({
        success: true,
        preferences: await notificationPreferences.updateNotificationPreferences(
          req.customerAuth.id,
          req.body,
        ),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.get('/api/customer/support', async (req, res) => {
  try {
    res.json({ success: true, requests: await support.listCustomerSupport(req.customerAuth.id) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/support/:id', async (req, res) => {
  try {
    res.json({
      success: true,
      ...(await support.getSupportRequest(req.params.id, {
        customerId: req.customerAuth.id,
        includeInternal: false,
      })),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post(
  '/api/customer/support/:id/messages',
  validateRequest({
    params: supportRequestParamsSchema,
    body: supportMessageBodySchema,
  }),
  async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        ...(await support.addSupportMessage(req.params.id, req.body, {
          senderType: 'customer',
          senderId: req.customerAuth.id,
          customerId: req.customerAuth.id,
        })),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.post(
  '/api/customer/support',
  validateRequest({ body: supportCreateBodySchema }),
  async (req, res) => {
    try {
      res.status(201).json({
        success: true,
        request: await support.createSupportRequest(req.customerAuth.id, req.body),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.post('/api/customer/support/upload', supportUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Выберите изображение' });
    res.status(201).json({
      success: true,
      attachment: await support.uploadSupportAttachment(req.customerAuth.id, req.file),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post(
  '/api/customer/live-activity',
  validateRequest({ body: liveActivityBodySchema }),
  async (req, res) => {
    try {
      res.json({
        success: true,
        activity: await liveActivity.registerLiveActivityToken(req.customerAuth.id, req.body),
      });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.delete(
  '/api/customer/live-activity',
  validateRequest({ body: liveActivityDeleteBodySchema }),
  async (req, res) => {
    try {
      await liveActivity.deactivateLiveActivityToken(req.customerAuth.id, req.body);
      res.json({ success: true });
    } catch (error) {
      res.status(error.statusCode || 500).json({ success: false, error: error.message });
    }
  },
);
router.post('/api/customer/analytics/events', async (req, res) => {
  try {
    const count = await recordCustomerEvents(req.customerAuth.id, req.body?.events, req);
    res.status(202).json({ success: true, accepted: count });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/favorites', async (req, res) => {
  try {
    res.json({
      success: true,
      favorites: await personalization.listFavorites(req.customerAuth.id),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/api/customer/favorites/:productId', async (req, res) => {
  try {
    res.json({
      success: true,
      favorite: await personalization.setFavorite(
        req.customerAuth.id,
        req.params.productId,
        req.body?.favorite !== false,
      ),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/api/customer/recent/:productId', async (req, res) => {
  try {
    await personalization.recordProductView(req.customerAuth.id, req.params.productId);
    res.status(202).json({ success: true });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/recent', async (req, res) => {
  try {
    res.json({
      success: true,
      recent: await personalization.listRecent(req.customerAuth.id, req.query.limit),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/recommendations', async (req, res) => {
  try {
    res.json({
      success: true,
      recommendations: await personalization.recommendations(req.customerAuth.id, req.query.limit),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/usual-order', async (req, res) => {
  try {
    res.json({
      success: true,
      usualOrder: await personalization.usualOrder(
        req.customerAuth.id,
        req.query.branchId || null,
        req.query.orderType || 'pickup',
      ),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/api/customer/orders/:id/reorder', async (req, res) => {
  try {
    res.json({
      success: true,
      cart: await personalization.reorder(req.customerAuth.id, req.params.id, req.body?.branchId),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/api/customer/cart-snapshot', async (req, res) => {
  try {
    res.json({
      success: true,
      cart: await personalization.saveCartSnapshot(req.customerAuth.id, req.body),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/reviews', async (req, res) => {
  try {
    res.json({ success: true, reviews: await reviews.listCustomerReviews(req.customerAuth.id) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.put('/api/customer/orders/:id/review', async (req, res) => {
  try {
    res.json({
      success: true,
      review: await reviews.submitReview(req.customerAuth.id, req.params.id, req.body),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/referral', async (req, res) => {
  try {
    res.json({
      success: true,
      referral: await marketing.getOrCreateReferralCode(req.customerAuth.id),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/api/customer/referral/redeem', async (req, res) => {
  try {
    res.json({
      success: true,
      redemption: await marketing.redeemReferralCode(req.customerAuth.id, req.body?.code),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/api/customer/gift-cards/redeem', async (req, res) => {
  try {
    res.json({
      success: true,
      amount: await marketing.redeemGiftCard(req.customerAuth.id, req.body?.code),
    });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.post('/api/customer/cake-reference', referenceUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ success: false, error: 'Выберите изображение' });
    const detected = detectReferenceImage(req.file.buffer);
    if (!detected || detected.mime !== req.file.mimetype) {
      return res.status(400).json({ success: false, error: 'Допустимы JPEG, PNG и WebP до 8 МБ' });
    }
    const optimized = await optimizeUploadedImage(req.file.buffer, detected.mime);
    const fileName = `cake-references/${req.customerAuth.id}/${Date.now()}-${crypto.randomUUID()}.${optimized.extension}`;
    const { error } = await supabase.storage
      .from('menu_images')
      .upload(fileName, optimized.buffer, {
        contentType: optimized.mime,
        cacheControl: '31536000',
        upsert: false,
      });
    if (error) throw error;
    const { data } = supabase.storage.from('menu_images').getPublicUrl(fileName);
    res.status(201).json({ success: true, url: data.publicUrl, optimized: optimized.optimized });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/customer/addresses', addressController.list);
router.post('/api/customer/addresses', addressController.create);
router.put('/api/customer/addresses/:id', addressController.update);
router.delete('/api/customer/addresses/:id', addressController.remove);
router.patch('/api/customer/addresses/:id/default', addressController.setDefault);

// Kaspi Pay endpoints
const kaspiController = require('../controllers/kaspi.controller');
router.get('/api/customer/kaspi-pay/availability', kaspiController.availability);
router.post('/api/customer/kaspi-pay/create', kaspiController.createPayment);
router.post('/api/customer/kaspi-pay/quote', kaspiController.quotePayment);
router.get('/api/customer/kaspi-pay/status/:operationId', kaspiController.checkStatus);

// Kaspi Webhook (должен быть открытым)
router.post('/webhooks/kaspi', webhookRateLimit, kaspiController.handleWebhook);

// ForteBank hosted checkout and signed webhook
const forteController = require('../controllers/forte.controller');
router.get('/api/customer/forte-pay/availability', forteController.availability);
router.post('/api/customer/forte-pay/create', forteController.createPayment);
router.post('/api/customer/forte-pay/quote', forteController.quotePayment);
router.get('/api/customer/forte-pay/status/:operationId', forteController.checkStatus);
router.post('/webhooks/forte', webhookRateLimit, forteController.handleWebhook);

router.get('/api/public/cities', publicController.getCities);
router.get('/api/public/geocode/search', geocodeController.search);
router.get('/api/public/geocode/reverse', geocodeController.reverse);
router.get('/api/public/loyalty-tiers', tierController.listPublicTiers);
router.get('/api/public/contact-center', async (_req, res) => {
  try {
    const result = await contactCenter.listPublicContactCards();
    res.set('Cache-Control', 'public, max-age=60, stale-while-revalidate=300');
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({
      success: false,
      error: error.message,
      ...(error.code && { code: error.code }),
    });
  }
});
router.get('/api/public/product-options', async (req, res) => {
  try {
    const ids = String(req.query.ids || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);
    const options = await getProductOptions(ids);
    res.set('Cache-Control', 'public, max-age=30, stale-while-revalidate=120');
    res.json({ success: true, products: Object.fromEntries(options) });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});
router.get('/api/public/fulfillment-slots', async (req, res) => {
  try {
    const result = await listAvailableSlots({
      branchId: req.query.branchId,
      orderType: String(req.query.orderType || 'pickup'),
      days: req.query.days,
    });
    res.set('Cache-Control', 'private, no-store');
    res.json({ success: true, ...result });
  } catch (error) {
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

module.exports = router;

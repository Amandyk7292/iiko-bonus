const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');
const { buildWhatsAppContact } = require('../utils/whatsapp.util');
const { getOrCreateCustomerByPhone, getCustomerByPhone } = require('../services/customer.service');
const otpStore = require('../services/otpStore.service');
const { supabase } = require('../config/supabase');
const { getIikoClientForCity } = require('../services/iiko-city-profile.service');
const { getStories } = require('../services/story.service');
const { getNews } = require('../services/news.service');
const path = require('path');
const { signRegistrationToken } = require('../services/auth.service');
const {
  issueCustomerSession,
  revokeCustomerSession,
  rotateCustomerSession,
} = require('../services/customer-session.service');
const {
  getBranchAvailability,
  refreshBranchInventoryInBackground,
} = require('../services/inventory.service');
const {
  customerAuthMiddleware,
  registrationAuthMiddleware,
} = require('../middlewares/customer-auth.middleware');
const { authRateLimit, publicApiRateLimit } = require('../middlewares/rate-limit.middleware');
const {
  getCustomerById,
  registerPushTokenByCustomerId,
  unregisterPushTokenByCustomerId,
  updateFcmTokenByCustomerId,
} = require('../services/customer.service');
const { sendApiError } = require('../utils/http.util');
const {
  AUTH_PURPOSES,
  authenticateCustomerPassword,
  consumeRegistrationCredentialGrant,
  createCustomerCredential,
  createRegistrationCredentialGrant,
  getCustomerCredential,
  isEstablishedCustomer,
  normalizeCustomerPhone,
  resetCustomerPassword,
  startCustomerPasswordReset,
  startCustomerRegistration,
  validateNewPassword,
} = require('../services/customer-password-auth.service');
const {
  categoryNameKey,
  filterProductsByVisibleCategories,
  fulfillmentTypesForProduct,
  getHiddenCategoryVisibility,
  normalizeMenuOrderType,
  productSupportsFulfillmentType,
} = require('../utils/menu-visibility.util');
const {
  clearCustomerSessionCookie,
  readCustomerRefreshCookie,
  sendCustomerSession,
  usesCustomerRefreshCookie,
} = require('../utils/customer-session-cookie.util');
const { emptyBodySchema, validateRequest } = require('../middlewares/validation.middleware');
const { customerRegistrationBodySchema } = require('../contracts/backend-safety.contract');
const {
  customerFcmTokenBodySchema,
  customerFcmTokenDeleteBodySchema,
  customerLoginBodySchema,
  customerOtpRequestBodySchema,
  customerOtpVerifyBodySchema,
  customerPasswordResetCompleteBodySchema,
  customerPasswordResetStartBodySchema,
  customerRegistrationStartBodySchema,
  customerSessionBodySchema,
  guestProfileBodySchema,
  notificationParamsSchema,
} = require('../contracts/legacy-api.contract');
const {
  recordCustomerLegalConsent,
  validateLegalConsent,
} = require('../services/legal-consent.service');

// --- Helper functions (originally in old index.js) ---

function normalizePhone(phone) {
  return String(phone || '').replace(/[^0-9+]/g, '');
}

function buildDynamicQrToken(phone, timeWindow = Math.floor(Date.now() / 300000)) {
  const digitsOnly = String(phone || '').replace(/[^0-9]/g, '');
  if (digitsOnly.length < 10) {
    const err = new Error('Valid phone required');
    err.statusCode = 400;
    throw err;
  }
  if (!process.env.BULKA_SECRET) throw new Error('BULKA_SECRET is required');
  const hash = crypto
    .createHmac('sha256', process.env.BULKA_SECRET)
    .update(`${digitsOnly}:${timeWindow}`)
    .digest('hex')
    .slice(0, 16);
  const expiresAt = (timeWindow + 1) * 300000;
  return {
    token: `BULKA-OTP-${digitsOnly}-${timeWindow}-${hash}`,
    expiresAt,
    ttlSeconds: Math.max(1, Math.floor((expiresAt - Date.now()) / 1000)),
  };
}

async function getCustomerTierSnapshot(customer) {
  const settings = await getSettings();
  const tiers = await getActiveLoyaltyTiers(settings);
  const tier = getTierInfo(customer.total_spent, tiers, settings);
  const highestTier = tier.allTiers[tier.allTiers.length - 1];
  return {
    tier,
    isVip: Boolean(highestTier && tier.code === highestTier.code),
    cashbackPercent: tier.percent,
    vipThreshold: highestTier?.minSpend ?? highestTier?.threshold ?? 0,
  };
}

async function buildAuthenticatedCustomerPayload(customer, req, res) {
  const [tierSnapshot, transactionResult, issuedSession] = await Promise.all([
    getCustomerTierSnapshot(customer),
    supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.id)
      .order('timestamp', { ascending: false })
      .limit(20),
    issueCustomerSession(customer, req),
  ]);
  const { tier, vipThreshold, isVip, cashbackPercent } = tierSnapshot;
  const transactions = transactionResult.data;
  const session = sendCustomerSession(req, res, issuedSession);
  return {
    success: true,
    exists: true,
    ...session,
    customer: {
      id: customer.id,
      last_name: customer.last_name,
      gender: customer.gender,
      birth_date: customer.birth_date,
      email: customer.email,
      region: customer.region,
      name: customer.name,
      phone: customer.phone,
      balance: customer.balance,
      total_spent: customer.total_spent,
      created_at: customer.created_at,
      isVip,
      cashbackPercent,
      vipThreshold,
      tier,
    },
    transactions: transactions || [],
  };
}

function sendCustomerAuthError(res, error) {
  const status = Number(error?.statusCode || 500);
  if (status >= 400 && status < 500) {
    return res.status(status).json({
      success: false,
      error: error.message,
      code: error.code || 'CUSTOMER_AUTH_ERROR',
    });
  }
  return sendApiError(res, error, { success: false });
}

function sendOtpFailure(res, consumed) {
  if (consumed.status === 'expired') {
    return res.status(400).json({
      success: false,
      error: 'expired',
      code: 'OTP_EXPIRED',
      message: 'Код устарел или не был запрошен',
    });
  }
  if (consumed.status === 'attempts_exceeded') {
    return res.status(429).json({
      success: false,
      error: 'attempts_exceeded',
      code: 'OTP_ATTEMPTS_EXCEEDED',
      message: 'Запросите новый код',
    });
  }
  if (consumed.status !== 'success') {
    return res.status(400).json({
      success: false,
      error: 'invalid',
      code: 'INVALID_OTP',
      message: 'Неверный код',
    });
  }
  return null;
}

router.post(
  '/api/auth/login',
  authRateLimit,
  validateRequest({ body: customerLoginBodySchema }),
  async (req, res) => {
    try {
      const { customer } = await authenticateCustomerPassword(req.body || {});
      res.json(await buildAuthenticatedCustomerPayload(customer, req, res));
    } catch (error) {
      sendCustomerAuthError(res, error);
    }
  },
);

router.post(
  '/api/auth/register/start',
  authRateLimit,
  validateRequest({ body: customerRegistrationStartBodySchema }),
  async (req, res) => {
    try {
      const result = await startCustomerRegistration({
        phone: req.body?.phone,
        password: req.body?.password,
        requestToken: req.body?.token,
      });
      res.json({ success: true, ...result });
    } catch (error) {
      sendCustomerAuthError(res, error);
    }
  },
);

router.post(
  '/api/auth/password-reset/start',
  authRateLimit,
  validateRequest({ body: customerPasswordResetStartBodySchema }),
  async (req, res) => {
    try {
      const result = await startCustomerPasswordReset({
        phone: req.body?.phone,
        requestToken: req.body?.token,
      });
      res.json({
        success: true,
        whatsappPhone: result.whatsappPhone,
        whatsappUrl: result.whatsappUrl,
      });
    } catch (error) {
      sendCustomerAuthError(res, error);
    }
  },
);

router.post(
  '/api/auth/password-reset/complete',
  authRateLimit,
  validateRequest({ body: customerPasswordResetCompleteBodySchema }),
  async (req, res) => {
    try {
      const phone = normalizeCustomerPhone(req.body?.phone);
      validateNewPassword(req.body?.password);
      const code = String(req.body?.code || '').trim();
      if (!/^\d{4}$/.test(code)) {
        return res.status(400).json({
          success: false,
          error: 'Invalid confirmation code',
          code: 'INVALID_OTP',
        });
      }
      const consumed = await otpStore.consume(phone, code);
      const failure = sendOtpFailure(res, consumed);
      if (failure) return failure;
      if (consumed.payload?.purpose !== AUTH_PURPOSES.passwordReset) {
        return res.status(400).json({
          success: false,
          error: 'Confirmation code cannot be used for password recovery',
          code: 'WRONG_OTP_PURPOSE',
        });
      }

      const customer = await getCustomerByPhone(phone);
      const credential = customer ? await getCustomerCredential(customer.id) : null;
      if (!customer || (!credential && !isEstablishedCustomer(customer))) {
        return res.status(404).json({
          success: false,
          error: 'Customer account was not found',
          code: 'ACCOUNT_NOT_FOUND',
        });
      }
      await resetCustomerPassword({ customerId: customer.id, password: req.body.password });
      res.json(await buildAuthenticatedCustomerPayload(customer, req, res));
    } catch (error) {
      sendCustomerAuthError(res, error);
    }
  },
);

router.post(
  '/api/auth/request-otp',
  authRateLimit,
  validateRequest({ body: customerOtpRequestBodySchema }),
  async (req, res) => {
    try {
      const { token } = req.body;
      const phone = normalizePhone(req.body.phone);
      if (!phone || phone.replace(/[^0-9]/g, '').length < 10)
        return res.status(400).json({ error: 'Valid phone required' });

      // Don't create customer here тАФ only create after OTP is verified

      // If a token was provided, save it so the WhatsApp bot can map it to this phone number
      if (!/^[A-Za-z0-9]{12,64}$/.test(String(token || ''))) {
        return res.status(400).json({ error: 'Valid request token required' });
      }
      if (token) {
        await supabase
          .from('whatsapp_sessions')
          .delete()
          .lt('expires_at', new Date().toISOString());
        const { error } = await supabase.from('whatsapp_sessions').upsert({
          id: `token_${token}`,
          data: JSON.stringify({ phone, expires: Date.now() + 10 * 60 * 1000 }),
          expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
        });
        if (error) throw error;
      }

      res.json({
        success: true,
        viaTelegram: false,
        ...buildWhatsAppContact(token),
      });
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.post(
  '/api/auth/verify-otp',
  authRateLimit,
  validateRequest({ body: customerOtpVerifyBodySchema }),
  async (req, res) => {
    try {
      const phone = normalizePhone(req.body.phone);
      const { code } = req.body;
      if (!phone || !code) return res.status(400).json({ error: 'Phone and code required' });

      const consumed = await otpStore.consume(phone, code);
      const failure = sendOtpFailure(res, consumed);
      if (failure) return failure;

      if (consumed.payload?.purpose === AUTH_PURPOSES.passwordReset) {
        return res.status(400).json({
          success: false,
          error: 'Confirmation code cannot be used to sign in',
          code: 'WRONG_OTP_PURPOSE',
        });
      }

      let existingCustomer = await getCustomerByPhone(phone);
      const isPlaceholder = existingCustomer && !isEstablishedCustomer(existingCustomer);
      if (consumed.payload?.purpose === AUTH_PURPOSES.registration) {
        const credential = existingCustomer
          ? await getCustomerCredential(existingCustomer.id)
          : null;
        if (credential || isEstablishedCustomer(existingCustomer)) {
          return res.status(409).json({
            success: false,
            error: 'Customer account already exists',
            code: credential ? 'ACCOUNT_EXISTS' : 'PASSWORD_SETUP_REQUIRED',
          });
        }
        const credentialGrantId = await createRegistrationCredentialGrant({
          phone,
          passwordHash: consumed.payload?.passwordHash,
        });
        return res.json({
          success: true,
          exists: false,
          registrationToken: signRegistrationToken(phone, { credentialGrantId }),
        });
      }
      if (!existingCustomer || isPlaceholder) {
        return res.json({
          success: true,
          exists: false,
          registrationToken: signRegistrationToken(phone),
        });
      }

      res.json(await buildAuthenticatedCustomerPayload(existingCustomer, req, res));
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.post(
  '/api/auth/register',
  authRateLimit,
  registrationAuthMiddleware,
  validateRequest({ body: customerRegistrationBodySchema }),
  async (req, res) => {
    try {
      const phone = normalizePhone(req.registrationAuth.phone);
      const { name, surname, gender, birthdate, email } = req.body;
      if (!phone) return res.status(400).json({ success: false, error: 'Phone required' });
      // Consent is validated before any placeholder customer or credential is
      // created. The server records canonical document hashes, not client claims.
      const legalConsent = validateLegalConsent(req.body || {});

      const safeName = typeof name === 'string' ? name.trim() : '';
      const safeSurname = typeof surname === 'string' ? surname.trim() : '';
      const safeEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
      const safeGender = typeof gender === 'string' ? gender.trim().toLowerCase() : '';
      const safeBirthdate = typeof birthdate === 'string' ? birthdate.trim() : '';
      const fullName = [safeName, safeSurname].filter(Boolean).join(' ').trim().slice(0, 160);
      if (!fullName) return res.status(400).json({ success: false, error: 'Name required' });
      if (safeName.length > 80 || safeSurname.length > 80) {
        return res.status(400).json({ success: false, error: 'Name is too long' });
      }
      if (email != null && (!safeEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(safeEmail))) {
        return res.status(400).json({ success: false, error: 'Invalid email' });
      }
      if (safeEmail.length > 254) {
        return res.status(400).json({ success: false, error: 'Invalid email' });
      }
      if (birthdate != null) {
        const parsedBirthdate = new Date(`${safeBirthdate}T00:00:00.000Z`);
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(safeBirthdate) ||
          Number.isNaN(parsedBirthdate.getTime()) ||
          parsedBirthdate.toISOString().slice(0, 10) !== safeBirthdate ||
          parsedBirthdate > new Date()
        ) {
          return res.status(400).json({ success: false, error: 'Invalid birthdate' });
        }
      }
      if (gender != null && !['m', 'f', 'male', 'female', 'other'].includes(safeGender)) {
        return res.status(400).json({ success: false, error: 'Invalid gender' });
      }

      // Validate every user-controlled field before a placeholder customer can
      // be created. Invalid registration attempts must not leave orphan rows.
      const existingCustomer = await getCustomerByPhone(phone);
      if (isEstablishedCustomer(existingCustomer)) {
        return res.status(409).json({ success: false, error: 'Customer is already registered' });
      }
      let customer = existingCustomer || (await getOrCreateCustomerByPhone(phone, fullName));
      if (!customer)
        return res.status(404).json({ success: false, error: 'Cannot create customer' });

      // Persist the legal audit before consuming a one-time credential grant.
      // A transient audit failure must remain safely retryable for the client.
      await recordCustomerLegalConsent(customer.id, legalConsent);
      if (req.registrationAuth.credentialGrantId) {
        const passwordHash = await consumeRegistrationCredentialGrant({
          phone,
          grantId: req.registrationAuth.credentialGrantId,
        });
        await createCustomerCredential({ customerId: customer.id, passwordHash });
      }

      const updateData = { name: fullName };
      if (safeSurname) updateData.last_name = safeSurname;
      if (safeEmail) updateData.email = safeEmail;
      if (safeGender) updateData.gender = safeGender;
      if (safeBirthdate) updateData.birth_date = safeBirthdate;

      const { error: updateError } = await supabase
        .from('customers')
        .update(updateData)
        .eq('id', customer.id);
      if (updateError) throw updateError;
      Object.assign(customer, updateData);

      res.json(await buildAuthenticatedCustomerPayload(customer, req, res));
    } catch (err) {
      sendCustomerAuthError(res, err);
    }
  },
);

router.post(
  '/api/auth/refresh',
  authRateLimit,
  validateRequest({ body: customerSessionBodySchema }),
  async (req, res) => {
    try {
      const rawToken = req.body?.refreshToken || readCustomerRefreshCookie(req);
      const session = await rotateCustomerSession(rawToken, req);
      res.json({ success: true, ...sendCustomerSession(req, res, session) });
    } catch (error) {
      sendApiError(res, error, { success: false });
    }
  },
);

router.post(
  '/api/auth/logout',
  authRateLimit,
  validateRequest({ body: customerSessionBodySchema }),
  async (req, res) => {
    try {
      const rawToken = req.body?.refreshToken || readCustomerRefreshCookie(req);
      await revokeCustomerSession(rawToken);
      if (usesCustomerRefreshCookie(req)) clearCustomerSessionCookie(req, res);
      res.json({ success: true });
    } catch (error) {
      sendApiError(res, error, { success: false });
    }
  },
);

router.post(
  '/api/customer/fcm-token',
  publicApiRateLimit,
  customerAuthMiddleware,
  validateRequest({ body: customerFcmTokenBodySchema }),
  async (req, res) => {
    try {
      const { fcmToken, language, platform, installationId } = req.body;
      if (!fcmToken) return res.status(400).json({ error: 'fcmToken required' });
      await registerPushTokenByCustomerId(req.customerAuth.id, fcmToken, {
        language,
        platform,
        installationId,
      });
      res.json({ success: true });
    } catch (err) {
      sendApiError(res, err);
    }
  },
);

router.delete(
  '/api/customer/fcm-token',
  publicApiRateLimit,
  customerAuthMiddleware,
  validateRequest({ body: customerFcmTokenDeleteBodySchema }),
  async (req, res) => {
    try {
      await unregisterPushTokenByCustomerId(req.customerAuth.id, {
        installationId: req.body?.installationId,
        fcmToken: req.body?.fcmToken,
      });
      res.status(204).send();
    } catch (err) {
      sendApiError(res, err);
    }
  },
);

router.get(
  '/api/customer/notifications',
  publicApiRateLimit,
  customerAuthMiddleware,
  async (req, res) => {
    try {
      const { data, error } = await supabase
        .from('customer_notifications')
        .select('id,title,body,type,payload,is_read,created_at')
        .eq('customer_id', req.customerAuth.id)
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      res.json({ success: true, notifications: data || [] });
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.post(
  '/api/customer/notifications/read-all',
  publicApiRateLimit,
  customerAuthMiddleware,
  validateRequest({ body: emptyBodySchema }),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from('customer_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('customer_id', req.customerAuth.id)
        .eq('is_read', false);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.post(
  '/api/customer/notifications/:id/read',
  publicApiRateLimit,
  customerAuthMiddleware,
  validateRequest({ params: notificationParamsSchema, body: emptyBodySchema }),
  async (req, res) => {
    try {
      const { error } = await supabase
        .from('customer_notifications')
        .update({ is_read: true, read_at: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('customer_id', req.customerAuth.id);
      if (error) throw error;
      res.json({ success: true });
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.post(
  '/api/guest/profile',
  publicApiRateLimit,
  customerAuthMiddleware,
  validateRequest({ body: guestProfileBodySchema }),
  async (req, res) => {
    try {
      const { fcmToken } = req.body;
      const customer = await getCustomerById(req.customerAuth.id);
      if (!customer) return res.status(404).json({ exists: false });

      if (fcmToken && customer.fcm_token !== fcmToken) {
        await updateFcmTokenByCustomerId(customer.id, fcmToken);
        customer.fcm_token = fcmToken;
      }

      const [tierSnapshot, transactionResult] = await Promise.all([
        getCustomerTierSnapshot(customer),
        supabase
          .from('transactions')
          .select('*')
          .eq('customer_id', customer.id)
          .order('timestamp', { ascending: false })
          .limit(20),
      ]);
      const { tier, vipThreshold, isVip, cashbackPercent } = tierSnapshot;
      const transactions = transactionResult.data;

      res.json({
        exists: true,
        customer: {
          id: customer.id,
          last_name: customer.last_name,
          gender: customer.gender,
          birth_date: customer.birth_date,
          email: customer.email,
          region: customer.region,
          avatar_key: customer.avatar_key,
          name: customer.name,
          phone: customer.phone,
          balance: customer.balance,
          total_spent: customer.total_spent,
          created_at: customer.created_at,
          isVip,
          cashbackPercent,
          vipThreshold,
          tier,
        },
        transactions: transactions || [],
      });
    } catch (err) {
      sendApiError(res, err);
    }
  },
);

router.post(
  '/api/guest/qr-token',
  publicApiRateLimit,
  customerAuthMiddleware,
  validateRequest({ body: emptyBodySchema }),
  async (req, res) => {
    try {
      const customer = await getCustomerById(req.customerAuth.id);
      if (!customer) return res.status(404).json({ success: false, error: 'Customer not found' });
      res.json({ success: true, ...buildDynamicQrToken(customer.phone) });
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.get('/api/guest/menu', async (req, res) => {
  try {
    const branchId = String(req.query.branchId || '').trim();
    const orderType = normalizeMenuOrderType(req.query.orderType || 'pickup');
    if (!orderType) {
      return res.status(400).json({ success: false, error: 'Некорректный тип заказа' });
    }
    if (
      branchId &&
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(branchId)
    ) {
      return res.status(400).json({ success: false, error: 'Некорректный филиал' });
    }
    const langHeader = req.headers['accept-language'] || 'ru';
    const lang = langHeader.split(',')[0].split('-')[0].toLowerCase();

    const getLocalized = (override, fieldName, fallbackName) => {
      if (!override) return fallbackName;
      const translations = override[`${fieldName}_translations`];
      if (translations) {
        if (translations[lang]) return translations[lang];
        if (translations['ru']) return translations['ru'];
      }
      return override[`custom_${fieldName}`] || override[fieldName] || fallbackName;
    };

    const getStorageConditions = (product) =>
      (Array.isArray(product?.storage_conditions) ? product.storage_conditions : [])
        .slice(0, 2)
        .map((condition) => ({
          temperature: String(condition?.temperature || '').trim(),
          durationValue: Number(condition?.duration_value || 0),
          durationUnit: String(condition?.duration_unit || '').trim(),
        }))
        .filter(
          (condition) =>
            condition.temperature &&
            Number.isInteger(condition.durationValue) &&
            condition.durationValue > 0 &&
            ['hours', 'days', 'months'].includes(condition.durationUnit),
        );

    const { data: branchSettings, error: branchSettingsError } = branchId
      ? await supabase
          .from('bulka_locations')
          .select(
            'city,default_preparation_minutes,pickup_enabled,delivery_enabled,preorder_enabled',
          )
          .eq('id', branchId)
          .eq('active', true)
          .maybeSingle()
      : { data: null, error: null };
    if (branchSettingsError) throw branchSettingsError;
    if (branchId && !branchSettings) {
      return res.status(404).json({ success: false, error: 'Филиал больше недоступен' });
    }

    const selectedIikoApi = getIikoClientForCity(branchSettings?.city);
    const rawMenu = await selectedIikoApi.getMenu({ strict: true });
    const rawGroups = Array.isArray(rawMenu.groups) ? rawMenu.groups : [];
    const rawProducts = Array.isArray(rawMenu.products) ? rawMenu.products : [];

    // Menu visibility, prices and stop-list state are order-critical. If one
    // source is unavailable, fail the request instead of publishing stale or
    // partially configured products.
    const menuService = require('../services/menu.service');
    const [stopIds, productOverrides, categoryOverrides, customProducts] = await Promise.all([
      selectedIikoApi.getStopListProductIds(undefined, { strict: true }),
      menuService.getProductOverrides({
        strict: true,
        profileKey: selectedIikoApi.profileKey,
      }),
      menuService.getCategoryOverrides({
        strict: true,
        profileKey: selectedIikoApi.profileKey,
      }),
      menuService.getCustomProducts({
        strict: true,
        profileKey: selectedIikoApi.profileKey,
      }),
    ]);

    const prodOverridesMap = new Map(productOverrides.map((o) => [o.iiko_product_id, o]));
    const catOverridesMap = new Map(categoryOverrides.map((o) => [o.iiko_category_id, o]));
    const branchSupportsOrderType =
      !branchSettings ||
      (orderType === 'pickup' && branchSettings.pickup_enabled !== false) ||
      (orderType === 'delivery' && branchSettings.delivery_enabled === true) ||
      (orderType === 'preorder' && branchSettings.preorder_enabled !== false);
    if (!branchSupportsOrderType) {
      return res.status(400).json({
        success: false,
        error: 'Выбранный тип заказа в этом филиале временно недоступен',
      });
    }
    const branchPreparationMinutes = Number(branchSettings?.default_preparation_minutes || 15);
    if (branchId) {
      refreshBranchInventoryInBackground(branchId, {
        products: rawProducts,
        iikoClient: selectedIikoApi,
      });
    }
    const branchAvailability = branchId
      ? await getBranchAvailability(branchId, { strict: true })
      : new Map();

    // Categories
    const baseCategories = rawGroups
      .filter(
        (g) =>
          g.isIncludedInMenu ||
          (rawGroups.length > 0 && !rawGroups.some((g2) => g2.isIncludedInMenu)),
      )
      .map((g) => ({
        id: g.id,
        name: g.name,
        order: g.order || 0,
      }));

    const { ids: hiddenCategoryIds, names: hiddenCategoryNames } = getHiddenCategoryVisibility(
      baseCategories,
      catOverridesMap,
    );

    // Применяем оверрайды к категориям
    const categories = [];
    for (const cat of baseCategories) {
      const override = catOverridesMap.get(cat.id);
      if (hiddenCategoryIds.has(cat.id)) continue;

      categories.push({
        id: cat.id,
        name: getLocalized(override, 'name', cat.name),
        order: override && override.sort_order ? override.sort_order : cat.order,
        imageUrl: (override && override.custom_image_url) || null,
      });
    }

    categories.sort((a, b) => a.order - b.order);

    // Products
    const baseProducts = rawProducts.filter(
      (p) =>
        p.type === 'Dish' ||
        p.type === 'Good' ||
        (rawProducts.length > 0 &&
          !rawProducts.some((p2) => p2.type === 'Dish' || p2.type === 'Good')),
    );

    const products = [];
    for (const p of baseProducts) {
      const override = prodOverridesMap.get(p.id);
      if (override && override.is_hidden) continue;
      if (!productSupportsFulfillmentType(override, orderType)) continue;
      // Пропускаем продукты из скрытых категорий
      if (hiddenCategoryIds.has(p.parentGroup)) continue;

      let price = 0;
      if (p.sizePrices && p.sizePrices.length > 0) {
        price = Number(p.sizePrices[0]?.price?.currentPrice || 0);
      }

      // Скрываем товары с ценой 0 (служебные позиции iiko)
      if (!price || price <= 0) continue;

      let imageUrl = null;
      if (p.imageLinks && p.imageLinks.length > 0) {
        imageUrl = p.imageLinks[0];
      }

      const inventory = branchAvailability.get(String(p.id));
      const isStopped =
        Boolean(override && override.is_stop_listed) ||
        stopIds.has(p.iikoProductId || p.id) ||
        (branchId && inventory?.isAvailable === false);

      products.push({
        id: p.id,
        name: getLocalized(override, 'name', p.name),
        description: getLocalized(override, 'description', p.description || ''),
        price: override && override.custom_price > 0 ? override.custom_price : price,
        categoryId: p.parentGroup,
        imageUrl: (override && override.custom_image_url) || imageUrl,
        inStopList: isStopped,
        isAvailable: !isStopped,
        availableQuantity: inventory?.availableQuantity ?? null,
        inStockCount: inventory?.availableQuantity ?? null,
        onlineOrderable: !isStopped,
        preparationMinutes: Number(
          inventory?.preparationMinutes ||
            override?.preparation_minutes ||
            branchPreparationMinutes,
        ),
        ingredients: getLocalized(override, 'ingredients', ''),
        allergens: Array.isArray(override?.allergens) ? override.allergens : [],
        dietaryTags: Array.isArray(override?.dietary_tags) ? override.dietary_tags : [],
        searchKeywords: Array.isArray(override?.search_keywords) ? override.search_keywords : [],
        weightGrams: override?.weight_grams == null ? null : Number(override.weight_grams),
        nutrition: {
          caloriesKcal: override?.calories_kcal == null ? null : Number(override.calories_kcal),
          proteinGrams: override?.protein_grams == null ? null : Number(override.protein_grams),
          fatGrams: override?.fat_grams == null ? null : Number(override.fat_grams),
          carbsGrams: override?.carbs_grams == null ? null : Number(override.carbs_grams),
        },
        storageConditions: getStorageConditions(override),
        sortOrder: (override && override.sort_order) || 0,
        fulfillmentTypes: fulfillmentTypesForProduct(override),
      });
    }

    // Добавляем кастомные товары (добавленные админом вручную)
    for (const cp of customProducts) {
      if (!productSupportsFulfillmentType(cp, orderType)) continue;
      // A custom product must not recreate a category that the administrator hid.
      if (hiddenCategoryNames.has(categoryNameKey(cp.category_name))) continue;
      // Ищем или создаём категорию для кастомного товара
      let cat = categories.find((c) => c.name === cp.category_name);
      let catId;
      if (cat) {
        catId = cat.id;
      } else {
        catId = 'custom-cat-' + cp.category_name.toLowerCase().replace(/\s+/g, '-');
        categories.push({
          id: catId,
          name: cp.category_name,
          order: 999, // в конец
          imageUrl: null,
        });
      }

      const inventory = branchAvailability.get(String(cp.id));
      products.push({
        id: cp.id,
        name: cp.name,
        description: cp.description || '',
        price: cp.price,
        categoryId: catId,
        imageUrl: cp.image_url,
        inStopList: !cp.is_available || inventory?.isAvailable === false,
        isAvailable: cp.is_available && (inventory?.isAvailable ?? true),
        availableQuantity: inventory?.availableQuantity ?? null,
        inStockCount: inventory?.availableQuantity ?? null,
        onlineOrderable: cp.is_available && (inventory?.isAvailable ?? true),
        preparationMinutes: Number(
          inventory?.preparationMinutes || cp.preparation_minutes || branchPreparationMinutes,
        ),
        ingredients: getLocalized(cp, 'ingredients', ''),
        allergens: Array.isArray(cp.allergens) ? cp.allergens : [],
        dietaryTags: Array.isArray(cp.dietary_tags) ? cp.dietary_tags : [],
        searchKeywords: Array.isArray(cp.search_keywords) ? cp.search_keywords : [],
        weightGrams: cp.weight_grams == null ? null : Number(cp.weight_grams),
        nutrition: {
          caloriesKcal: cp.calories_kcal == null ? null : Number(cp.calories_kcal),
          proteinGrams: cp.protein_grams == null ? null : Number(cp.protein_grams),
          fatGrams: cp.fat_grams == null ? null : Number(cp.fat_grams),
          carbsGrams: cp.carbs_grams == null ? null : Number(cp.carbs_grams),
        },
        storageConditions: getStorageConditions(cp),
        sortOrder: cp.sort_order || 0,
        fulfillmentTypes: fulfillmentTypesForProduct(cp),
      });
    }

    // Final allowlist prevents orphaned products from leaking when iiko returns a
    // product for a category that is hidden or absent from the published menu.
    const publishedProducts = filterProductsByVisibleCategories(categories, products);
    const publishedCategoryIds = new Set(publishedProducts.map((product) => product.categoryId));
    const publishedCategories = categories.filter((category) =>
      publishedCategoryIds.has(category.id),
    );

    // Сортировка товаров (если нужен кастомный порядок)
    publishedProducts.sort((a, b) => a.sortOrder - b.sortOrder);

    res.set('Cache-Control', 'private, no-store');
    res.json({
      success: true,
      categories: publishedCategories,
      products: publishedProducts,
      revision: Math.max(
        0,
        ...productOverrides.map((item) => Date.parse(item.updated_at) || 0),
        ...categoryOverrides.map((item) => Date.parse(item.updated_at) || 0),
        ...customProducts.map((item) => Date.parse(item.updated_at) || 0),
      ),
      branchId: branchId || null,
      orderType,
      iikoProfile: rawMenu.profileKey || 'default',
    });
  } catch (error) {
    console.error('Ошибка получения меню:', error);
    sendApiError(res, error, { success: false });
  }
});

router.get('/api/guest/stories', async (req, res) => {
  try {
    const stories = await getStories();
    res.json({ success: true, stories });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get('/api/guest/news', async (req, res) => {
  try {
    const news = await getNews();
    res.json({ success: true, news });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get('/api/guest/locations', async (req, res) => {
  try {
    const { getBulkaLocations, getCitiesWithPoints } = require('../services/location.service');
    const [cities, locations] = await Promise.all([
      getCitiesWithPoints({ throwOnError: true }),
      getBulkaLocations(),
    ]);

    const cityLocations = {};
    for (const city of cities) {
      const cityName = city.name || 'Другое';
      cityLocations[cityName] = [];
      if (city.points && Array.isArray(city.points)) {
        for (const pt of city.points) {
          const title = [pt.name, pt.address].filter(Boolean).join(', ');
          if (title) cityLocations[cityName].push(title);
        }
      }
    }
    res.set('Cache-Control', 'public, max-age=60, must-revalidate');
    res.json({ success: true, cityLocations, locations });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get(['/wallet', '/guest'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'app.html'));
});

module.exports = router;

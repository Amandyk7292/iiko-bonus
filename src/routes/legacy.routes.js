const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getSettings } = require('../services/settings.service');
const { getActiveLoyaltyTiers } = require('../services/tier.service');
const { getTierInfo } = require('../utils/tier.util');
const { startCustomerOtp } = require('../services/customer-otp.service');
const { customerOtpProvider } = require('../services/customer-otp-provider.service');
const { getOrCreateCustomerByPhone, getCustomerByPhone } = require('../services/customer.service');
const otpStore = require('../services/otpStore.service');
const { supabase } = require('../config/supabase');
const { getStories } = require('../services/story.service');
const path = require('path');
const { signRegistrationToken } = require('../services/auth.service');
const { cashierSignup } = require('../services/cashier-signup.service');
const {
  issueCustomerSession,
  revokeCustomerSession,
  rotateCustomerSession,
} = require('../services/customer-session.service');
const {
  customerAuthMiddleware,
  registrationAuthMiddleware,
} = require('../middlewares/customer-auth.middleware');
const {
  authRateLimit,
  customerSessionRateLimit,
  publicApiRateLimit,
} = require('../middlewares/rate-limit.middleware');
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
  ensureRegistrationCredential,
  createRegistrationCredentialGrant,
  getCustomerCredential,
  isEstablishedCustomer,
  normalizeCustomerPhone,
  startCustomerPasswordReset,
  startCustomerRegistration,
} = require('../services/customer-password-auth.service');
const {
  completeCustomerPasswordResetLink,
  validateCustomerPasswordResetLink,
} = require('../services/customer-password-reset-link.service');
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
  customerPasswordResetLinkCompleteBodySchema,
  customerPasswordResetLinkValidateBodySchema,
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

async function buildAuthenticatedCustomerPayload(customer, req, res, { authVersion } = {}) {
  const sessionCustomer = customer;
  customer = await require('../services/family.service').family.profile(customer);
  const [tierSnapshot, transactionResult, issuedSession] = await Promise.all([
    getCustomerTierSnapshot(customer),
    supabase
      .from('transactions')
      .select('*')
      .eq('customer_id', customer.family?.ownerCustomerId || customer.id)
      .order('timestamp', { ascending: false })
      .limit(20),
    issueCustomerSession(sessionCustomer, req, { authVersion }),
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
      avatar_key: customer.avatar_key,
      avatar_url: customer.avatar_url,
      name: customer.name,
      phone: customer.phone,
      balance: customer.balance,
      total_spent: customer.total_spent,
      created_at: customer.created_at,
      ...(customer.family
        ? { family: customer.family, personal_bonus_balance: customer.personal_bonus_balance }
        : {}),
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
  if (error?.retryAfterSeconds) res.set('Retry-After', String(error.retryAfterSeconds));
  if (
    (status >= 400 && status < 500) ||
    (status === 503 &&
      (error?.code?.startsWith('OTP_') ||
        error?.code?.startsWith('PASSWORD_RESET_') ||
        error?.code === 'STAFF_DIRECTORY_UNAVAILABLE'))
  ) {
    return res.status(status).json({
      success: false,
      error: error.message,
      code: error.code || 'CUSTOMER_AUTH_ERROR',
      ...(error.retryAfterSeconds ? { retryAfterSeconds: error.retryAfterSeconds } : {}),
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
      const { customer, authVersion } = await authenticateCustomerPassword(req.body || {});
      res.json(await buildAuthenticatedCustomerPayload(customer, req, res, { authVersion }));
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
        automaticOtpSupported: req.body?.otpDeliveryVersion === 2,
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
        automaticOtpSupported: req.body?.otpDeliveryVersion === 2,
      });
      res.json({
        success: true,
        deliveryMode: result.deliveryMode,
        channel: result.channel,
        expiresInSeconds: result.expiresInSeconds,
        retryAfterSeconds: result.retryAfterSeconds,
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
  (_req, res) =>
    res.status(410).json({
      success: false,
      error: 'Восстановление пароля выполняется по ссылке из SMS.',
      code: 'PASSWORD_RESET_SMS_LINK_REQUIRED',
    }),
);

router.post(
  '/api/auth/password-reset/validate-link',
  authRateLimit,
  validateRequest({ body: customerPasswordResetLinkValidateBodySchema }),
  async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await validateCustomerPasswordResetLink(req.body));
    } catch (error) {
      sendCustomerAuthError(res, error);
    }
  },
);
router.post(
  '/api/auth/password-reset/complete-link',
  authRateLimit,
  validateRequest({ body: customerPasswordResetLinkCompleteBodySchema }),
  async (req, res) => {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await completeCustomerPasswordResetLink(req.body));
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
      if (
        customerOtpProvider(process.env, AUTH_PURPOSES.registration) === 'autocall_sms' &&
        !isEstablishedCustomer(await getCustomerByPhone(normalizeCustomerPhone(req.body.phone)))
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Обновите приложение Bulka или перезагрузите страницу, чтобы подтвердить номер по SMS.',
          code: 'OTP_CLIENT_UPDATE_REQUIRED',
        });
      }
      const result = await startCustomerOtp({
        phone: req.body.phone,
        requestToken: req.body.token,
        automaticOtpSupported: req.body.otpDeliveryVersion === 2,
      });
      res.json({
        success: true,
        viaTelegram: false,
        ...result,
      });
    } catch (err) {
      sendCustomerAuthError(res, err);
    }
  },
);

router.post(
  '/api/auth/verify-otp',
  authRateLimit,
  validateRequest({ body: customerOtpVerifyBodySchema }),
  async (req, res) => {
    try {
      const phone = normalizeCustomerPhone(req.body.phone);
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
      if (
        !req.registrationAuth.credentialGrantId &&
        customerOtpProvider(process.env, AUTH_PURPOSES.registration) === 'autocall_sms'
      ) {
        return res.status(400).json({
          success: false,
          error:
            'Обновите приложение Bulka или перезагрузите страницу, чтобы подтвердить номер по SMS.',
          code: 'OTP_CLIENT_UPDATE_REQUIRED',
        });
      }
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
      if (req.body.cashierInviteToken) await cashierSignup.resolve(req.body.cashierInviteToken);
      // Keep incomplete registrations retryable if consent/referral storage fails.
      let customer = existingCustomer || (await getOrCreateCustomerByPhone(phone, 'Новый Гость'));
      if (!customer)
        return res.status(404).json({ success: false, error: 'Cannot create customer' });

      // Persist the legal audit before consuming a one-time credential grant.
      // A transient audit failure must remain safely retryable for the client.
      await recordCustomerLegalConsent(customer.id, legalConsent);
      const referralEligibility =
        await require('../services/referral.service').rememberReferralDevice(
          customer.id,
          req.body.installationId,
          req.body.referralDevice,
        );
      if (req.body.referralCode && referralEligibility.reason !== 'shared_device') {
        try {
          await require('../services/commerce-marketing.service').redeemReferralCode(
            customer.id,
            req.body.referralCode,
          );
        } catch (error) {
          if (error.code !== 'REFERRAL_DEVICE_CLAIMED') throw error;
          referralEligibility.eligible = false;
          referralEligibility.reason = 'shared_device';
        }
      }
      // Recheck the external archive immediately before committing registration.
      // Nothing from the client can claim an employee is active or set a reward.
      const cashierSnapshot = req.body.cashierInviteToken
        ? await cashierSignup.resolve(req.body.cashierInviteToken)
        : undefined;
      // Credential insert and grant consumption are atomic. A verified retry
      // keeps an already-created password after a transient profile failure.
      if (req.registrationAuth.credentialGrantId) {
        await ensureRegistrationCredential({
          customerId: customer.id,
          phone,
          grantId: req.registrationAuth.credentialGrantId,
        });
      }

      const updateData = { name: fullName };
      if (safeSurname) updateData.last_name = safeSurname;
      if (safeEmail) updateData.email = safeEmail;
      if (safeGender) updateData.gender = safeGender;
      if (safeBirthdate) updateData.birth_date = safeBirthdate;

      await require('../services/branch-signup.service').finishRegistration(customer, updateData, {
        cashierInviteToken: req.body.cashierInviteToken,
        cashierSnapshot,
      });
      Object.assign(customer, updateData);

      res.json({
        ...(await buildAuthenticatedCustomerPayload(customer, req, res)),
        referralEligibility,
      });
    } catch (err) {
      sendCustomerAuthError(res, err);
    }
  },
);

router.post(
  '/api/auth/refresh',
  customerSessionRateLimit,
  validateRequest({ body: customerSessionBodySchema }),
  async (req, res) => {
    try {
      const rawToken = req.body?.refreshToken || readCustomerRefreshCookie(req);
      if (!rawToken) {
        return res.status(401).json({
          success: false,
          error: 'Refresh session is required',
          code: 'CUSTOMER_SESSION_REQUIRED',
        });
      }
      const session = String(rawToken).startsWith('FCH-')
        ? await require('../services/family-child-session.service').childSessions.refresh(rawToken)
        : await rotateCustomerSession(rawToken, req);
      return res.json({ success: true, ...sendCustomerSession(req, res, session) });
    } catch (error) {
      return sendApiError(res, error, { success: false });
    }
  },
);

router.post(
  '/api/auth/logout',
  customerSessionRateLimit,
  validateRequest({ body: customerSessionBodySchema }),
  async (req, res) => {
    try {
      const rawToken = req.body?.refreshToken || readCustomerRefreshCookie(req);
      if (String(rawToken || '').startsWith('FCH-')) {
        await require('../services/family-child-session.service').childSessions.logout(rawToken);
      } else {
        await revokeCustomerSession(rawToken);
      }
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
      let customer = await getCustomerById(req.customerAuth.id);
      if (!customer) return res.status(404).json({ exists: false });

      if (fcmToken && customer.fcm_token !== fcmToken) {
        await updateFcmTokenByCustomerId(customer.id, fcmToken);
        customer.fcm_token = fcmToken;
      }

      customer = await require('../services/family.service').family.profile(customer);

      const [tierSnapshot, transactionResult] = await Promise.all([
        getCustomerTierSnapshot(customer),
        supabase
          .from('transactions')
          .select('*')
          .eq('customer_id', customer.family?.ownerCustomerId || customer.id)
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
          avatar_url: customer.avatar_url,
          name: customer.name,
          phone: customer.phone,
          balance: customer.balance,
          total_spent: customer.total_spent,
          created_at: customer.created_at,
          ...(customer.family
            ? { family: customer.family, personal_bonus_balance: customer.personal_bonus_balance }
            : {}),
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
      const familyQr = await require('../services/family.service').family.qrForCustomer(
        customer.id,
        'loyalty',
      );
      res.json({ success: true, ...(familyQr || buildDynamicQrToken(customer.phone)) });
    } catch (err) {
      sendApiError(res, err, { success: false });
    }
  },
);

router.get('/api/guest/menu', async (req, res) => {
  try {
    const result = await require('../services/public-menu.service').loadPublicMenu({
      branchId: req.query.branchId,
      orderType: req.query.orderType,
      language: req.headers['accept-language'],
    });
    res.set('Cache-Control', 'private, no-store');
    res.json(result);
  } catch (error) {
    if (error.publicMenuValidation) {
      return res.status(error.statusCode).json({ success: false, error: error.message });
    }
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
    // Live invalidation must reach the origin instead of reusing a fresh browser cache entry.
    res.set('Cache-Control', 'no-store');
    res.json({ success: true, cityLocations, locations });
  } catch (err) {
    sendApiError(res, err, { success: false });
  }
});

router.get(['/wallet', '/guest'], (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public', 'app.html'));
});

module.exports = router;

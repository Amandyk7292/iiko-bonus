const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { buildWhatsAppContact } = require('../utils/whatsapp.util');
const { customerOtpDigest, otpError } = require('../utils/customer-otp.util');
const {
  customerOtpProvider,
  otpProviderConfig,
  sendAutomaticOtp,
} = require('./customer-otp-provider.service');

async function startCustomerOtp(
  {
    phone: rawPhone,
    requestToken,
    purpose = 'customer_login',
    passwordHash = null,
    automaticOtpSupported = false,
  },
  { db = supabase, env = process.env, sendOtp = sendAutomaticOtp } = {},
) {
  const phone = normalizeKazakhstanPhone(rawPhone);
  if (!phone) throw otpError('Укажите номер телефона Казахстана.', 400, 'OTP_INVALID_PHONE');
  if (!/^[A-Za-z0-9]{12,64}$/.test(String(requestToken || ''))) {
    throw otpError('Некорректный запрос кода.', 400, 'OTP_INVALID_REQUEST');
  }
  if (!['customer_login', 'customer_registration', 'customer_password_reset'].includes(purpose)) {
    throw otpError('Некорректный запрос кода.', 400, 'OTP_INVALID_REQUEST');
  }
  if (
    purpose === 'customer_registration' &&
    automaticOtpSupported !== true &&
    customerOtpProvider(env, purpose) === 'autocall_sms'
  ) {
    throw otpError(
      'Обновите приложение Bulka или перезагрузите страницу, чтобы подтвердить номер по SMS.',
      400,
      'OTP_CLIENT_UPDATE_REQUIRED',
    );
  }
  // Other older clients can only enter four digits and still open the bot.
  // Preserve their existing flow without validating unused provider credentials.
  const config =
    automaticOtpSupported === true
      ? otpProviderConfig(env, purpose)
      : { provider: 'legacy_whatsapp' };
  const payload = {
    phone,
    purpose,
    flowId: requestToken,
    ...(passwordHash ? { passwordHash } : {}),
  };
  if (config.provider === 'legacy_whatsapp') {
    const expires = Date.now() + 10 * 60 * 1000;
    await db.from('whatsapp_sessions').delete().lt('expires_at', new Date().toISOString());
    const { error } = await db.from('whatsapp_sessions').upsert({
      id: `token_${requestToken}`,
      data: { ...payload, expires },
      expires_at: new Date(expires).toISOString(),
    });
    if (error) throw error;
    const contact = buildWhatsAppContact(requestToken, env);
    if (!contact.whatsappUrl) throw otpError('Подтверждение номера временно недоступно.');
    return { ...contact, deliveryMode: 'manual', channel: 'whatsapp', codeLength: 4 };
  }
  if (!/^\+7[67]\d{9}$/.test(phone)) {
    throw otpError('Укажите номер телефона Казахстана.', 400, 'OTP_INVALID_PHONE');
  }
  const limit = Number(env.CUSTOMER_OTP_DAILY_SEND_LIMIT || 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) {
    throw otpError('Подтверждение номера временно недоступно.');
  }
  const code = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
  const digest = customerOtpDigest(phone, code);
  const { data: reservation, error } = await db.rpc('reserve_customer_otp', {
    p_phone: phone,
    p_digest: digest,
    p_payload: payload,
    p_daily_limit: limit,
  });
  if (error) throw otpError('Подтверждение номера временно недоступно.');
  if (reservation?.status === 'rate_limited') {
    throw otpError('Подождите перед повторным запросом кода.', 429, 'OTP_RATE_LIMITED', {
      retryAfterSeconds: Math.max(1, Number(reservation.retryAfterSeconds) || 60),
    });
  }
  if (reservation?.status !== 'reserved') {
    throw otpError('Подтверждение номера временно недоступно.');
  }
  const deliveryArgs = { p_phone: phone, p_flow_id: requestToken, p_digest: digest };
  try {
    const delivery = await sendOtp({ phone, code, config });
    const { data: completed, error: completionError } = await db.rpc(
      'complete_customer_otp_delivery',
      { ...deliveryArgs, p_success: true, p_message_id: delivery.messageId },
    );
    if (completionError || completed !== true) {
      throw otpError('Не удалось отправить код. Попробуйте позже.', 503, 'OTP_SEND_FAILED');
    }
  } catch {
    // An unaccepted/uncertain send must not leave a usable confirmation code.
    await db
      .rpc('complete_customer_otp_delivery', {
        ...deliveryArgs,
        p_success: false,
        p_message_id: null,
      })
      .catch(() => {});
    throw otpError('Не удалось отправить код. Попробуйте позже.', 503, 'OTP_SEND_FAILED');
  }
  return {
    deliveryMode: 'automatic',
    channel: ['mobizon_sms', 'autocall_sms'].includes(config.provider) ? 'sms' : 'whatsapp',
    codeLength: 6,
    expiresInSeconds: 300,
    retryAfterSeconds: 60,
    whatsappUrl: null,
    whatsappPhone: null,
  };
}

async function consumeCustomerOtp(phone, code, { db = supabase, env = process.env } = {}) {
  const args = { p_phone: String(phone || ''), p_code: String(code || '') };
  let { data, error } = await db.rpc('consume_customer_otp', {
    ...args,
    p_digest: customerOtpDigest(args.p_phone, args.p_code),
  });
  // Keep the current login working before the additive migration is installed.
  if (
    ['PGRST202', '42883'].includes(error?.code) &&
    customerOtpProvider(env) === 'legacy_whatsapp'
  ) {
    ({ data, error } = await db.rpc('consume_whatsapp_otp', args));
  }
  if (error) throw new Error('OTP storage unavailable');
  return data || { status: 'expired' };
}

module.exports = { consumeCustomerOtp, startCustomerOtp };

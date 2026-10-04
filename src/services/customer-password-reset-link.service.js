const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');
const { getCustomerByPhone } = require('./customer.service');
const {
  getCustomerCredential,
  isEstablishedCustomer,
  normalizeCustomerPhone,
  validateNewPassword,
  validateRequestToken,
} = require('./customer-password-auth.service');
const { autocallProviderConfig, sendAutocallSms } = require('./customer-otp-provider.service');

const LINK_PATTERN = /^[a-f0-9]{64}$/;
const PUBLIC_RESULT = Object.freeze({
  deliveryMode: 'sms_link',
  channel: 'sms',
  expiresInSeconds: 900,
  retryAfterSeconds: 60,
});
const linkError = () =>
  Object.assign(new Error('Ссылка недействительна или истекла. Запросите новую SMS.'), {
    statusCode: 400,
    code: 'PASSWORD_RESET_LINK_INVALID',
  });
const unavailable = () =>
  Object.assign(new Error('Восстановление пароля временно недоступно. Попробуйте позже.'), {
    statusCode: 503,
    code: 'PASSWORD_RESET_LINK_UNAVAILABLE',
  });
const digestToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

async function startCustomerPasswordResetLink(
  { phone: rawPhone, requestToken },
  {
    db = supabase,
    env = process.env,
    findCustomer = getCustomerByPhone,
    sendSms = sendAutocallSms,
  } = {},
) {
  const phone = normalizeCustomerPhone(rawPhone);
  const flowId = validateRequestToken(requestToken);
  let config;
  try {
    config = autocallProviderConfig(env);
  } catch {
    throw unavailable();
  }
  const limit = Number(env.CUSTOMER_OTP_DAILY_SEND_LIMIT || 1000);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100000) throw unavailable();
  const customer = await findCustomer(phone);
  const credential = customer ? await getCustomerCredential(customer.id, { db }) : null;
  const customerId =
    customer && (credential || isEstablishedCustomer(customer)) ? customer.id : null;
  const token = crypto.randomBytes(32).toString('hex');
  const digest = digestToken(token);
  const { data: reservation, error } = await db.rpc('reserve_customer_password_reset_link', {
    p_phone: phone,
    p_digest: digest,
    p_flow_id: flowId,
    p_customer_id: customerId,
    p_daily_limit: limit,
  });
  if (error) throw unavailable();
  if (reservation?.status === 'rate_limited') {
    throw Object.assign(new Error('Подождите перед повторным запросом SMS.'), {
      statusCode: 429,
      code: 'PASSWORD_RESET_RATE_LIMITED',
      retryAfterSeconds: Math.max(1, Number(reservation.retryAfterSeconds) || 60),
    });
  }
  if (reservation?.status !== 'reserved') throw unavailable();
  const deliveryArgs = { p_phone: phone, p_digest: digest, p_flow_id: flowId };
  try {
    // Send the same public flow to unknown numbers too. Eligibility is bound
    // privately to the token; the start response never reveals account existence.
    await sendSms({
      phone,
      config,
      name: 'Password reset',
      text: 'Bulka: Novyi parol: {{reset_url}} (15 min)',
      variables: { reset_url: `https://bulka.com.kz/reset-password#reset=${token}` },
    });
    const { data: completed, error: completionError } = await db.rpc(
      'complete_customer_password_reset_link_delivery',
      { ...deliveryArgs, p_success: true },
    );
    if (completionError || completed !== true) throw unavailable();
  } catch {
    await db
      .rpc('complete_customer_password_reset_link_delivery', { ...deliveryArgs, p_success: false })
      .catch(() => {});
    throw unavailable();
  }
  return { ...PUBLIC_RESULT };
}

async function validateCustomerPasswordResetLink({ resetToken }, { db = supabase } = {}) {
  if (typeof resetToken !== 'string' || !LINK_PATTERN.test(resetToken)) throw linkError();
  const { data, error } = await db.rpc('validate_customer_password_reset_link', {
    p_digest: digestToken(resetToken),
  });
  if (error) throw unavailable();
  if (data !== true) throw linkError();
  return { success: true };
}

async function completeCustomerPasswordResetLink(
  { resetToken, password },
  { db = supabase, env = process.env } = {},
) {
  if (typeof resetToken !== 'string' || !LINK_PATTERN.test(resetToken)) throw linkError();
  const configured = Number.parseInt(env.CUSTOMER_PASSWORD_BCRYPT_ROUNDS || '12', 10);
  const rounds =
    Number.isInteger(configured) && configured >= 10 && configured <= 14 ? configured : 12;
  const passwordHash = await bcrypt.hash(validateNewPassword(password), rounds);
  const { data, error } = await db.rpc('consume_customer_password_reset_link', {
    p_digest: digestToken(resetToken),
    p_password_hash: passwordHash,
  });
  if (error) throw unavailable();
  if (data?.status !== 'success') throw linkError();
  return { success: true };
}

module.exports = {
  completeCustomerPasswordResetLink,
  startCustomerPasswordResetLink,
  validateCustomerPasswordResetLink,
};

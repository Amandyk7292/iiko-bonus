const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const otpStore = require('./otpStore.service');
const { buildWhatsAppContact } = require('../utils/whatsapp.util');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');

const ADMIN_PHONE_LOGIN_TTL_MS = 5 * 60 * 1000;
const ADMIN_PHONE_ROLES = new Set(['branch_manager', 'operator', 'marketer', 'courier', 'viewer']);

const adminPhoneError = (message, statusCode = 400, code = 'ADMIN_PHONE_AUTH_ERROR') =>
  Object.assign(new Error(message), { statusCode, code });

const parseSessionData = (value) => {
  if (!value) return null;
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const adminOtpKey = (phone) => `admin_login:${phone}`;

async function requestAdminPhoneLogin(rawPhone) {
  const phone = normalizeKazakhstanPhone(rawPhone);
  if (!phone) {
    throw adminPhoneError('Введите номер в формате +7 700 000 00 00');
  }

  const { data: profile, error } = await supabase
    .from('admin_user_profiles')
    .select('username,role,active')
    .eq('username', phone)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;

  const requestToken = crypto.randomBytes(18).toString('base64url');
  const expiresAtMs = Date.now() + ADMIN_PHONE_LOGIN_TTL_MS;
  const contact = buildWhatsAppContact(requestToken);
  if (!contact.whatsappUrl) {
    throw adminPhoneError('WhatsApp-бот временно недоступен', 503, 'ADMIN_WHATSAPP_UNAVAILABLE');
  }

  // The public response is identical for assigned and unknown numbers. Only an
  // active staff profile receives a server-side challenge.
  if (profile && ADMIN_PHONE_ROLES.has(String(profile.role || ''))) {
    const { error: cleanupError } = await supabase
      .from('whatsapp_sessions')
      .delete()
      .eq('data->>purpose', 'admin_login')
      .eq('data->>phone', phone);
    if (cleanupError) throw cleanupError;

    const { error: challengeError } = await supabase.from('whatsapp_sessions').insert({
      id: `token_${requestToken}`,
      data: {
        phone,
        purpose: 'admin_login',
        username: profile.username,
        expires: expiresAtMs,
      },
      expires_at: new Date(expiresAtMs).toISOString(),
    });
    if (challengeError) throw challengeError;
  }

  return {
    accepted: true,
    expiresIn: Math.floor(ADMIN_PHONE_LOGIN_TTL_MS / 1000),
    whatsappPhone: contact.whatsappPhone,
    whatsappUrl: contact.whatsappUrl,
  };
}

async function consumeAdminBotRequest(rawToken, rawSenderDigits) {
  const token = String(rawToken || '').trim();
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return { status: 'not_admin' };

  const sessionId = `token_${token}`;
  const { data: session, error } = await supabase
    .from('whatsapp_sessions')
    .select('data,expires_at')
    .eq('id', sessionId)
    .maybeSingle();
  if (error) throw error;

  const request = parseSessionData(session?.data);
  if (!request || request.purpose !== 'admin_login') return { status: 'not_admin' };
  if (
    Number(request.expires || 0) <= Date.now() ||
    !session.expires_at ||
    new Date(session.expires_at).getTime() <= Date.now()
  ) {
    await supabase.from('whatsapp_sessions').delete().eq('id', sessionId);
    return { status: 'expired' };
  }

  const senderDigits = String(rawSenderDigits || '').replace(/\D/g, '');
  const requestedDigits = String(request.phone || '').replace(/\D/g, '');
  if (!senderDigits || senderDigits.slice(-10) !== requestedDigits.slice(-10)) {
    return { status: 'phone_mismatch' };
  }

  const { data: claimed, error: claimError } = await supabase
    .from('whatsapp_sessions')
    .delete()
    .eq('id', sessionId)
    .gt('expires_at', new Date().toISOString())
    .select('data')
    .maybeSingle();
  if (claimError) throw claimError;
  const claimedRequest = parseSessionData(claimed?.data);
  if (!claimedRequest) return { status: 'expired' };

  const { data: profile, error: profileError } = await supabase
    .from('admin_user_profiles')
    .select('username,role,active')
    .eq('username', claimedRequest.username)
    .eq('active', true)
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile || !ADMIN_PHONE_ROLES.has(String(profile.role || ''))) {
    return { status: 'unavailable' };
  }

  const code = crypto.randomInt(100000, 1000000).toString();
  await otpStore.set(adminOtpKey(profile.username), {
    code,
    attempts: 0,
    purpose: 'admin_login',
    username: profile.username,
    expires: Date.now() + ADMIN_PHONE_LOGIN_TTL_MS,
  });
  return { status: 'success', code, expiresIn: 300 };
}

async function verifyAdminPhoneLogin(rawPhone, rawCode) {
  const phone = normalizeKazakhstanPhone(rawPhone);
  if (!phone) throw adminPhoneError('Введите корректный номер телефона');

  const code = String(rawCode || '').replace(/\D/g, '');
  if (!/^\d{6}$/.test(code)) throw adminPhoneError('Введите шестизначный код');

  const key = adminOtpKey(phone);
  const storedOtp = await otpStore.get(key);
  const consumed = await otpStore.consume(key, code);
  if (consumed.status === 'attempts_exceeded') {
    throw adminPhoneError('Слишком много попыток. Запросите новый код.', 429);
  }
  if (consumed.status !== 'success') {
    throw adminPhoneError(
      consumed.status === 'expired' ? 'Код истёк. Запросите новый.' : 'Неверный код',
      401,
      'ADMIN_PHONE_CODE_INVALID',
    );
  }

  const { data: profile, error } = await supabase
    .from('admin_user_profiles')
    .select('username,role,branch_ids,active')
    .eq('username', phone)
    .eq('active', true)
    .maybeSingle();
  if (error) throw error;
  if (
    !profile ||
    storedOtp?.purpose !== 'admin_login' ||
    storedOtp?.username !== profile.username ||
    !ADMIN_PHONE_ROLES.has(String(profile.role || ''))
  ) {
    throw adminPhoneError('Учётная запись сотрудника недоступна', 401);
  }

  return {
    username: profile.username,
    role: profile.role,
    branchIds: Array.isArray(profile.branch_ids) ? profile.branch_ids.map(String) : [],
  };
}

module.exports = {
  ADMIN_PHONE_ROLES,
  consumeAdminBotRequest,
  requestAdminPhoneLogin,
  verifyAdminPhoneLogin,
};

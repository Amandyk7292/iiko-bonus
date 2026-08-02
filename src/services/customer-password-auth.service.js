const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { supabase } = require('../config/supabase');
const { normalizeKazakhstanPhone } = require('../utils/phone.util');
const { buildWhatsAppContact } = require('../utils/whatsapp.util');
const { getCustomerByPhone } = require('./customer.service');

const AUTH_PURPOSES = Object.freeze({
  registration: 'customer_registration',
  passwordReset: 'customer_password_reset',
});
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const DUMMY_PASSWORD_HASH = '$2b$12$pvvdNihY2it501/0kjDymOfBEu5EOkFJwWI6jO1a7j15OuzNP6zby';
const PLACEHOLDER_NAMES = new Set([
  '',
  'гость',
  'новый гость',
  'қонақ',
  'жаңа қонақ',
  'guest',
  'new guest',
]);

function customerAuthError(message, statusCode = 400, code = 'CUSTOMER_AUTH_ERROR') {
  return Object.assign(new Error(message), { statusCode, code });
}

function normalizeCustomerPhone(value) {
  const phone = normalizeKazakhstanPhone(value);
  if (!phone) throw customerAuthError('Valid Kazakhstan phone required', 400, 'INVALID_PHONE');
  return phone;
}

function validateRequestToken(value) {
  const token = String(value || '').trim();
  if (!/^[A-Za-z0-9]{12,64}$/.test(token)) {
    throw customerAuthError('Valid request token required', 400, 'INVALID_REQUEST_TOKEN');
  }
  return token;
}

function validateNewPassword(value) {
  if (typeof value !== 'string') {
    throw customerAuthError('Password is required', 400, 'INVALID_PASSWORD');
  }
  const byteLength = Buffer.byteLength(value, 'utf8');
  if (value.length < 8 || byteLength > 72 || !/\p{L}/u.test(value) || !/\p{N}/u.test(value)) {
    throw customerAuthError(
      'Password must contain 8 to 72 bytes, at least one letter and one digit',
      400,
      'INVALID_PASSWORD',
    );
  }
  return value;
}

function isEstablishedCustomer(customer) {
  if (!customer) return false;
  return !PLACEHOLDER_NAMES.has(
    String(customer.name || '')
      .trim()
      .toLowerCase(),
  );
}

function parseStoredData(value) {
  if (!value) return null;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function registrationGrantStorageId(grantId) {
  const digest = crypto
    .createHash('sha256')
    .update(String(grantId || ''))
    .digest('hex');
  return `registration_grant_${digest}`;
}

function bcryptRounds() {
  const configured = Number.parseInt(process.env.CUSTOMER_PASSWORD_BCRYPT_ROUNDS || '12', 10);
  return Number.isInteger(configured) && configured >= 10 && configured <= 14 ? configured : 12;
}

async function getCustomerCredential(customerId, { db = supabase } = {}) {
  if (!customerId) return null;
  const { data, error } = await db
    .from('customer_credentials')
    .select('customer_id,password_hash,auth_version,password_set_at')
    .eq('customer_id', customerId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function saveWhatsAppAuthRequest(
  { phone, requestToken, purpose, passwordHash = null },
  { db = supabase } = {},
) {
  const expires = Date.now() + 10 * 60 * 1000;
  await db.from('whatsapp_sessions').delete().lt('expires_at', new Date().toISOString());
  const payload = {
    phone,
    purpose,
    expires,
    flowId: requestToken,
    ...(passwordHash ? { passwordHash } : {}),
  };
  const { error } = await db.from('whatsapp_sessions').upsert({
    id: `token_${requestToken}`,
    data: payload,
    expires_at: new Date(expires).toISOString(),
  });
  if (error) throw error;

  const contact = buildWhatsAppContact(requestToken);
  if (!contact.whatsappUrl) {
    throw customerAuthError('WhatsApp confirmation is unavailable', 503, 'WHATSAPP_UNAVAILABLE');
  }
  return contact;
}

async function startCustomerRegistration(
  { phone: rawPhone, password, requestToken: rawRequestToken },
  { db = supabase, findCustomer = getCustomerByPhone } = {},
) {
  const phone = normalizeCustomerPhone(rawPhone);
  const requestToken = validateRequestToken(rawRequestToken);
  const existingCustomer = await findCustomer(phone);
  const credential = existingCustomer
    ? await getCustomerCredential(existingCustomer.id, { db })
    : null;

  if (credential) {
    throw customerAuthError('Customer account already exists', 409, 'ACCOUNT_EXISTS');
  }
  if (isEstablishedCustomer(existingCustomer)) {
    throw customerAuthError(
      'Existing customer must set a password through password recovery',
      409,
      'PASSWORD_SETUP_REQUIRED',
    );
  }

  const passwordHash = await bcrypt.hash(validateNewPassword(password), bcryptRounds());
  const contact = await saveWhatsAppAuthRequest(
    {
      phone,
      requestToken,
      purpose: AUTH_PURPOSES.registration,
      passwordHash,
    },
    { db },
  );
  return { phone, ...contact };
}

async function startCustomerPasswordReset(
  { phone: rawPhone, requestToken: rawRequestToken },
  { db = supabase, findCustomer = getCustomerByPhone } = {},
) {
  const phone = normalizeCustomerPhone(rawPhone);
  const requestToken = validateRequestToken(rawRequestToken);
  const customer = await findCustomer(phone);
  const credential = customer ? await getCustomerCredential(customer.id, { db }) : null;
  if (!customer || (!credential && !isEstablishedCustomer(customer))) {
    throw customerAuthError('Customer account was not found', 404, 'ACCOUNT_NOT_FOUND');
  }

  const contact = await saveWhatsAppAuthRequest(
    { phone, requestToken, purpose: AUTH_PURPOSES.passwordReset },
    { db },
  );
  return { phone, customer, ...contact };
}

async function authenticateCustomerPassword(
  { phone: rawPhone, password },
  { db = supabase, findCustomer = getCustomerByPhone } = {},
) {
  let phone;
  try {
    phone = normalizeCustomerPhone(rawPhone);
  } catch {
    phone = null;
  }
  const customer = phone ? await findCustomer(phone) : null;
  const credential = customer ? await getCustomerCredential(customer.id, { db }) : null;
  const rawPassword = typeof password === 'string' ? password : '';
  const validInput =
    rawPassword.length > 0 && Buffer.byteLength(rawPassword, 'utf8') <= 72
      ? rawPassword
      : 'invalid-password-input';
  const storedHash = BCRYPT_HASH_PATTERN.test(String(credential?.password_hash || ''))
    ? credential.password_hash
    : DUMMY_PASSWORD_HASH;
  const matches = await bcrypt.compare(validInput, storedHash);

  if (!phone || !customer || !credential || !matches) {
    throw customerAuthError('Invalid phone or password', 401, 'INVALID_CREDENTIALS');
  }
  return {
    phone,
    customer,
    authVersion: Number(credential.auth_version || 1),
  };
}

async function createRegistrationCredentialGrant(
  { phone: rawPhone, passwordHash },
  { db = supabase } = {},
) {
  const phone = normalizeCustomerPhone(rawPhone);
  if (!BCRYPT_HASH_PATTERN.test(String(passwordHash || ''))) {
    throw customerAuthError('Registration credential is invalid or expired', 401, 'INVALID_GRANT');
  }
  const grantId = crypto.randomBytes(32).toString('base64url');
  const expires = Date.now() + 10 * 60 * 1000;
  const { error } = await db.from('whatsapp_sessions').insert({
    id: registrationGrantStorageId(grantId),
    data: { phone, passwordHash, expires },
    expires_at: new Date(expires).toISOString(),
  });
  if (error) throw error;
  return grantId;
}

async function consumeRegistrationCredentialGrant(
  { phone: rawPhone, grantId },
  { db = supabase } = {},
) {
  const phone = normalizeCustomerPhone(rawPhone);
  const token = String(grantId || '');
  if (!/^[A-Za-z0-9_-]{40,80}$/.test(token)) {
    throw customerAuthError('Registration credential is invalid or expired', 401, 'INVALID_GRANT');
  }
  const { data, error } = await db
    .from('whatsapp_sessions')
    .delete()
    .eq('id', registrationGrantStorageId(token))
    .gt('expires_at', new Date().toISOString())
    .select('data')
    .maybeSingle();
  if (error) throw error;
  const payload = parseStoredData(data?.data);
  if (
    !payload ||
    normalizeKazakhstanPhone(payload.phone) !== phone ||
    Number(payload.expires || 0) <= Date.now() ||
    !BCRYPT_HASH_PATTERN.test(String(payload.passwordHash || ''))
  ) {
    throw customerAuthError('Registration credential is invalid or expired', 401, 'INVALID_GRANT');
  }
  return payload.passwordHash;
}

async function createCustomerCredential({ customerId, passwordHash }, { db = supabase } = {}) {
  if (!customerId || !BCRYPT_HASH_PATTERN.test(String(passwordHash || ''))) {
    throw customerAuthError('Registration credential is invalid', 400, 'INVALID_GRANT');
  }
  const { data, error } = await db
    .from('customer_credentials')
    .insert({
      customer_id: customerId,
      password_hash: passwordHash,
      auth_version: 1,
      password_set_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .select('auth_version')
    .single();
  if (error?.code === '23505') {
    throw customerAuthError('Customer account already exists', 409, 'ACCOUNT_EXISTS');
  }
  if (error) throw error;
  return Number(data?.auth_version || 1);
}

async function resetCustomerPassword({ customerId, password }, { db = supabase } = {}) {
  const passwordHash = await bcrypt.hash(validateNewPassword(password), bcryptRounds());
  const { data, error } = await db.rpc('set_customer_password', {
    p_customer_id: customerId,
    p_password_hash: passwordHash,
  });
  if (error) throw error;
  return Number(data || 1);
}

module.exports = {
  AUTH_PURPOSES,
  authenticateCustomerPassword,
  consumeRegistrationCredentialGrant,
  createCustomerCredential,
  createRegistrationCredentialGrant,
  getCustomerCredential,
  isEstablishedCustomer,
  normalizeCustomerPhone,
  parseStoredData,
  resetCustomerPassword,
  startCustomerPasswordReset,
  startCustomerRegistration,
  validateNewPassword,
  validateRequestToken,
};

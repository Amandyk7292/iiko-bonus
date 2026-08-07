const bcrypt = require('bcryptjs');
const { supabase } = require('../config/supabase');

const CASHIER_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,63}$/;
const BCRYPT_HASH_PATTERN = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const DUMMY_PASSWORD_HASH = '$2b$12$4ojkOJkkZ0OkGMSV5W8oKuR0nm4G9Djwrn1XF.7z9KqNhxQH1Ugkq';
const PASSWORD_ROUNDS = 12;

const normalizeCashierUsername = (value) =>
  String(value || '')
    .trim()
    .toLowerCase();

const isValidCashierUsername = (value) =>
  CASHIER_USERNAME_PATTERN.test(normalizeCashierUsername(value));

const isValidCashierPassword = (value) => {
  const password = String(value || '');
  return (
    password.length >= 10 &&
    Buffer.byteLength(password, 'utf8') <= 72 &&
    /\p{L}/u.test(password) &&
    /\d/.test(password)
  );
};

const hashCashierPassword = async (password, { bcryptImpl = bcrypt } = {}) => {
  if (!isValidCashierPassword(password)) {
    throw Object.assign(
      new Error('Пароль должен содержать 10–72 байта, хотя бы одну букву и одну цифру'),
      { statusCode: 400, code: 'CASHIER_PASSWORD_WEAK' },
    );
  }
  return bcryptImpl.hash(String(password), PASSWORD_ROUNDS);
};

async function authenticateCashier(
  rawUsername,
  rawPassword,
  { db = supabase, bcryptImpl = bcrypt } = {},
) {
  const username = normalizeCashierUsername(rawUsername);
  const password = String(rawPassword || '');
  if (
    !isValidCashierUsername(username) ||
    password.length < 1 ||
    Buffer.byteLength(password, 'utf8') > 72
  ) {
    return null;
  }

  const { data, error } = await db.rpc('get_cashier_auth_record', {
    p_username: username,
  });
  if (error) throw error;
  const credential = Array.isArray(data) ? data[0] : data;

  const storedHash = BCRYPT_HASH_PATTERN.test(String(credential?.password_hash || ''))
    ? credential.password_hash
    : DUMMY_PASSWORD_HASH;
  let passwordValid;
  try {
    passwordValid = await bcryptImpl.compare(password, storedHash);
  } catch {
    passwordValid = false;
  }

  const branchIds = Array.isArray(credential?.branch_ids)
    ? Array.from(new Set(credential.branch_ids.map(String).filter(Boolean)))
    : [];
  if (
    !passwordValid ||
    !credential ||
    credential.username !== username ||
    credential.active === false ||
    credential.role !== 'cashier' ||
    branchIds.length !== 1
  ) {
    return null;
  }

  return {
    username,
    role: 'cashier',
    branchIds,
    authVersion: Number(credential.auth_version),
  };
}

async function createCashierAccess(
  { username: rawUsername, displayName, branchId, password },
  { db = supabase, bcryptImpl = bcrypt } = {},
) {
  const username = normalizeCashierUsername(rawUsername);
  if (!isValidCashierUsername(username)) {
    throw Object.assign(
      new Error('Логин: 3–64 символа, латинские буквы, цифры, точка, дефис или подчёркивание'),
      { statusCode: 400, code: 'CASHIER_USERNAME_INVALID' },
    );
  }
  const passwordHash = await hashCashierPassword(password, { bcryptImpl });
  const { data, error } = await db.rpc('create_cashier_access', {
    p_username: username,
    p_display_name: String(displayName || '').trim(),
    p_branch_id: String(branchId || ''),
    p_password_hash: passwordHash,
  });
  if (error) throw error;
  return data;
}

async function resetCashierPassword(
  rawUsername,
  password,
  { db = supabase, bcryptImpl = bcrypt } = {},
) {
  const username = normalizeCashierUsername(rawUsername);
  if (!isValidCashierUsername(username)) {
    throw Object.assign(new Error('Некорректный логин кассира'), {
      statusCode: 400,
      code: 'CASHIER_USERNAME_INVALID',
    });
  }
  const passwordHash = await hashCashierPassword(password, { bcryptImpl });
  const { data, error } = await db.rpc('reset_cashier_password', {
    p_username: username,
    p_password_hash: passwordHash,
  });
  if (error) throw error;
  return data === true;
}

async function updateCashierAccess(
  { username: rawUsername, displayName, branchId, active },
  { db = supabase } = {},
) {
  const username = normalizeCashierUsername(rawUsername);
  if (!isValidCashierUsername(username)) {
    throw Object.assign(new Error('Некорректный логин кассира'), {
      statusCode: 400,
      code: 'CASHIER_USERNAME_INVALID',
    });
  }
  const { data, error } = await db.rpc('update_cashier_access', {
    p_username: username,
    p_display_name: String(displayName || '').trim(),
    p_branch_id: String(branchId || ''),
    p_active: active === true,
  });
  if (error) throw error;
  return data;
}

module.exports = {
  CASHIER_USERNAME_PATTERN,
  authenticateCashier,
  createCashierAccess,
  hashCashierPassword,
  isValidCashierPassword,
  isValidCashierUsername,
  normalizeCashierUsername,
  resetCashierPassword,
  updateCashierAccess,
};

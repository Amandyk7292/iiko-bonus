function validateRuntimeConfig() {
  const isProduction =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.VERCEL);
  if (!isProduction) return;

  const required = [
    ['SUPABASE_URL', 20],
    ['SUPABASE_SERVICE_ROLE_KEY', 32],
    ['BULKA_SECRET', 32],
    ['CUSTOMER_JWT_SECRET', 32],
    ['PUBLIC_BASE_URL', 12],
  ];
  const apiSecret = process.env.API_SECRET || process.env.API_TOKEN || '';
  const missing = required
    .filter(([name, minLength]) => String(process.env[name] || '').length < minLength)
    .map(([name]) => name);
  if (apiSecret.length < 32) missing.push('API_SECRET');
  const adminAuth =
    String(process.env.ADMIN_USERS_JSON || '') || String(process.env.ADMIN_PASSWORD_HASH || '');
  if (adminAuth.length < 12) missing.push('ADMIN_USERS_JSON/ADMIN_PASSWORD_HASH');
  if (
    process.env.ADMIN_PASSWORD_HASH &&
    !String(process.env.ADMIN_PASSWORD_HASH).startsWith('$2')
  ) {
    missing.push('ADMIN_PASSWORD_HASH(bcrypt)');
  }
  if (process.env.ADMIN_USERS_JSON) {
    try {
      const users = JSON.parse(process.env.ADMIN_USERS_JSON);
      if (
        !Array.isArray(users) ||
        users.length === 0 ||
        users.some(
          (user) =>
            !user?.username ||
            !String(user.passwordHash || '').startsWith('$2') ||
            !['admin', 'editor', 'viewer'].includes(user.role),
        )
      ) {
        missing.push('ADMIN_USERS_JSON(valid users)');
      }
      if (
        process.env.ADMIN_REQUIRE_MFA === 'true' &&
        !process.env.ADMIN_TOTP_SECRET &&
        users.some((user) => !user?.totpSecret)
      ) {
        missing.push('ADMIN_USERS_JSON(totpSecret)');
      }
    } catch {
      missing.push('ADMIN_USERS_JSON(valid JSON)');
    }
  }
  if (process.env.KASPI_POS_ENABLED === 'true') {
    for (const [name, minLength] of [
      ['KASPI_INTERNAL_SECRET', 32],
      ['KASPI_WEBHOOK_SECRET', 32],
      ['TOKEN_SECRET_KEY', 32],
    ]) {
      if (String(process.env[name] || '').length < minLength) missing.push(name);
    }
    if (!/^[0-9a-fA-F]{64}$/.test(String(process.env.TOKEN_SECRET_KEY || ''))) {
      missing.push('TOKEN_SECRET_KEY(64-char hex)');
    }
    for (const name of [
      'KEYPAIR_JSON_B64',
      'DEVICE_JSON_B64',
      'ECDH_KEYPAIR_JSON_B64',
      'SESSION_JSON_B64',
    ]) {
      try {
        const parsed = JSON.parse(
          Buffer.from(String(process.env[name] || ''), 'base64').toString('utf8'),
        );
        if (!parsed || typeof parsed !== 'object') throw new Error('Invalid object');
      } catch {
        missing.push(`${name}(base64 JSON)`);
      }
    }
  }
  if (process.env.PUBLIC_BASE_URL && !/^https:\/\//.test(process.env.PUBLIC_BASE_URL)) {
    missing.push('PUBLIC_BASE_URL(https)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing or weak production configuration: ${missing.join(', ')}`);
  }
}

function shouldRunBots(env = process.env) {
  return env.RUN_BOTS !== 'false';
}

module.exports = { validateRuntimeConfig, shouldRunBots };

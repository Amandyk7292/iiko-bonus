function validateRuntimeConfig() {
  const isProduction =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.VERCEL);
  if (!isProduction) return;

  const required = [
    ['SUPABASE_URL', 20],
    ['SUPABASE_SERVICE_ROLE_KEY', 32],
    ['BULKA_SECRET', 32],
    ['CUSTOMER_JWT_SECRET', 32],
    ['RECEIPT_SIGNING_SECRET', 32],
    ['PUBLIC_BASE_URL', 12],
  ];
  const apiSecret = process.env.API_SECRET || process.env.API_TOKEN || '';
  const missing = required
    .filter(([name, minLength]) => String(process.env[name] || '').length < minLength)
    .map(([name]) => name);
  if (apiSecret.length < 32) missing.push('API_SECRET');
  if (process.env.ADMIN_JWT_SECRET && String(process.env.ADMIN_JWT_SECRET).length < 32) {
    missing.push('ADMIN_JWT_SECRET(32+ characters)');
  }
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
            ![
              'admin',
              'owner',
              'branch_manager',
              'operator',
              'marketer',
              'courier',
              'editor',
              'viewer',
            ].includes(user.role),
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
      if (!String(process.env[name] || '').trim()) continue;
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
  if (process.env.FORTE_ENABLED === 'true') {
    for (const [name, minLength] of [
      ['FORTE_API_USERNAME', 8],
      ['FORTE_API_PASSWORD', 8],
      ['FORTE_MERCHANT_ID', 1],
      ['FORTE_ORDER_CREDENTIAL_KEY', 32],
    ]) {
      if (String(process.env[name] || '').trim().length < minLength) missing.push(name);
    }
    if (
      !/^Terminal(?:Sys|User)\/[A-Za-z0-9._-]{1,100}$/.test(
        String(process.env.FORTE_API_USERNAME || '').trim(),
      )
    ) {
      missing.push('FORTE_API_USERNAME(TerminalSys/login)');
    }
    try {
      const forteApiUrl = new URL(
        String(process.env.FORTE_API_BASE_URL || 'https://api.fortebank.com'),
      );
      if (
        forteApiUrl.protocol !== 'https:' ||
        forteApiUrl.hostname.toLowerCase() !== 'api.fortebank.com' ||
        forteApiUrl.port
      ) {
        missing.push('FORTE_API_BASE_URL(https://api.fortebank.com)');
      }
    } catch {
      missing.push('FORTE_API_BASE_URL(valid URL)');
    }
  }
  if (process.env.FORTE_WIDGET_ENABLED === 'true') {
    for (const [name, minLength] of [
      ['FORTE_WIDGET_SHOP_ID', 1],
      ['FORTE_WIDGET_SECRET_KEY', 16],
      ['FORTE_WIDGET_TOKEN_KEY', 32],
      ['FORTE_WIDGET_WEBHOOK_PUBLIC_KEY', 64],
    ]) {
      if (String(process.env[name] || '').trim().length < minLength) missing.push(name);
    }
    if (!/^\d{1,20}$/.test(String(process.env.FORTE_WIDGET_SHOP_ID || '').trim())) {
      missing.push('FORTE_WIDGET_SHOP_ID(numeric)');
    }
    for (const [name, fallback, hostname] of [
      [
        'FORTE_WIDGET_CHECKOUT_API_URL',
        'https://securepayments.fortebank.com',
        'securepayments.fortebank.com',
      ],
      [
        'FORTE_WIDGET_TRANSACTION_API_URL',
        'https://gateway.fortebank.com',
        'gateway.fortebank.com',
      ],
    ]) {
      try {
        const url = new URL(String(process.env[name] || fallback));
        if (
          url.protocol !== 'https:' ||
          url.hostname.toLowerCase() !== hostname ||
          url.port ||
          !['', '/'].includes(url.pathname)
        ) {
          missing.push(`${name}(official Forte HTTPS origin)`);
        }
      } catch {
        missing.push(`${name}(valid URL)`);
      }
    }
    if (
      process.env.FORTE_WIDGET_APPLE_PAY_ENABLED &&
      !['true', 'false'].includes(process.env.FORTE_WIDGET_APPLE_PAY_ENABLED)
    ) {
      missing.push('FORTE_WIDGET_APPLE_PAY_ENABLED(true or false)');
    }
    if (
      process.env.FORTE_WIDGET_CHECKOUT_ENABLED &&
      !['true', 'false'].includes(process.env.FORTE_WIDGET_CHECKOUT_ENABLED)
    ) {
      missing.push('FORTE_WIDGET_CHECKOUT_ENABLED(true or false)');
    }
  }
  if (process.env.YANDEX_DELIVERY_ENABLED === 'true') {
    if (String(process.env.YANDEX_DELIVERY_API_TOKEN || '').trim().length < 10) {
      missing.push('YANDEX_DELIVERY_API_TOKEN');
    }
    const senderPhone = String(process.env.YANDEX_DELIVERY_SENDER_PHONE || '').replace(/\D/g, '');
    if (!/^(7|8)\d{10}$/.test(senderPhone)) {
      missing.push('YANDEX_DELIVERY_SENDER_PHONE(KZ)');
    }
    if (
      process.env.YANDEX_DELIVERY_BASE_URL &&
      !/^https:\/\//.test(process.env.YANDEX_DELIVERY_BASE_URL)
    ) {
      missing.push('YANDEX_DELIVERY_BASE_URL(https)');
    }
  }
  if (process.env.GEMINI_ASSISTANT_ENABLED === 'true') {
    for (const keyName of ['GEMINI_API_KEY', 'QWEN_API_KEY', 'DEEPSEEK_API_KEY']) {
      const configuredKey = String(process.env[keyName] || '').trim();
      if (configuredKey && configuredKey.length < 16) missing.push(`${keyName}(valid API key)`);
    }
    if (
      process.env.GEMINI_MODEL &&
      !/^[a-zA-Z0-9._-]{1,120}$/.test(String(process.env.GEMINI_MODEL))
    ) {
      missing.push('GEMINI_MODEL(valid model id)');
    }
    if (
      process.env.AI_ASSISTANT_PROVIDER &&
      !['gemini', 'qwen', 'deepseek'].includes(process.env.AI_ASSISTANT_PROVIDER)
    ) {
      missing.push('AI_ASSISTANT_PROVIDER(gemini, qwen or deepseek)');
    }
    if (
      process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET &&
      process.env.AI_PROVIDER_KEY_ENCRYPTION_SECRET.length < 32
    ) {
      missing.push('AI_PROVIDER_KEY_ENCRYPTION_SECRET(32+ characters)');
    }
  }
  if (process.env.PUBLIC_BASE_URL && !/^https:\/\//.test(process.env.PUBLIC_BASE_URL)) {
    missing.push('PUBLIC_BASE_URL(https)');
  }
  const receiptTtl = Number(process.env.RECEIPT_LINK_TTL_SECONDS || 30 * 24 * 60 * 60);
  if (!Number.isSafeInteger(receiptTtl) || receiptTtl < 3600 || receiptTtl > 366 * 24 * 60 * 60) {
    missing.push('RECEIPT_LINK_TTL_SECONDS(3600..31622400)');
  }
  for (const [name, fallback, maximum] of [
    ['ADMIN_MANUAL_BONUS_LIMIT', 1_000_000, 1_000_000],
    ['DELEGATED_MANUAL_BONUS_LIMIT', 100_000, 1_000_000],
  ]) {
    const value = Number(process.env[name] || fallback);
    if (!Number.isFinite(value) || value <= 0 || value > maximum) {
      missing.push(`${name}(positive number <= ${maximum})`);
    }
  }
  if (
    process.env.RECEIPT_ALLOW_LEGACY_LINKS &&
    !['true', 'false'].includes(process.env.RECEIPT_ALLOW_LEGACY_LINKS)
  ) {
    missing.push('RECEIPT_ALLOW_LEGACY_LINKS(true or false)');
  }
  if (process.env.METRICS_BEARER_TOKEN && String(process.env.METRICS_BEARER_TOKEN).length < 32) {
    missing.push('METRICS_BEARER_TOKEN(32+ characters)');
  }
  if (
    process.env.OPS_ALERT_WEBHOOK_URL &&
    !/^https:\/\//.test(String(process.env.OPS_ALERT_WEBHOOK_URL))
  ) {
    missing.push('OPS_ALERT_WEBHOOK_URL(https)');
  }
  if (
    process.env.OPS_ALERT_BEARER_TOKEN &&
    String(process.env.OPS_ALERT_BEARER_TOKEN).length < 24
  ) {
    missing.push('OPS_ALERT_BEARER_TOKEN(24+ characters)');
  }
  const readinessTimeout = Number(process.env.READINESS_TIMEOUT_MS || 3000);
  if (
    !Number.isSafeInteger(readinessTimeout) ||
    readinessTimeout < 500 ||
    readinessTimeout > 10_000
  ) {
    missing.push('READINESS_TIMEOUT_MS(500..10000)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing or weak production configuration: ${missing.join(', ')}`);
  }
}

function shouldRunBots(env = process.env) {
  return env.RUN_BOTS !== 'false';
}

module.exports = { validateRuntimeConfig, shouldRunBots };

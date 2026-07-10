function validateRuntimeConfig() {
  const isProduction =
    process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.VERCEL);
  if (!isProduction) return;

  const required = [
    ['SUPABASE_URL', 20],
    ['SUPABASE_SERVICE_ROLE_KEY', 32],
    ['ADMIN_PASSWORD', 12],
    ['BULKA_SECRET', 32],
    ['CUSTOMER_JWT_SECRET', 32],
    ['PUBLIC_BASE_URL', 12],
  ];
  const apiSecret = process.env.API_SECRET || process.env.API_TOKEN || '';
  const missing = required
    .filter(([name, minLength]) => String(process.env[name] || '').length < minLength)
    .map(([name]) => name);
  if (apiSecret.length < 32) missing.push('API_SECRET');
  if (process.env.PUBLIC_BASE_URL && !/^https:\/\//.test(process.env.PUBLIC_BASE_URL)) {
    missing.push('PUBLIC_BASE_URL(https)');
  }

  if (missing.length > 0) {
    throw new Error(`Missing or weak production configuration: ${missing.join(', ')}`);
  }
}

module.exports = { validateRuntimeConfig };

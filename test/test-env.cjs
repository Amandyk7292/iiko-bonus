process.env.NODE_ENV = 'test';
process.env.LOG_LEVEL = 'silent';
process.env.BULKA_SECRET =
  process.env.BULKA_SECRET || 'bulka-test-secret-keep-out-of-production-2026';
process.env.CUSTOMER_JWT_SECRET =
  process.env.CUSTOMER_JWT_SECRET || 'bulka-customer-test-jwt-secret-2026';

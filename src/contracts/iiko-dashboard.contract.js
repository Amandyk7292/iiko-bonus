const { z } = require('../middlewares/validation.middleware');
const { servers } = require('../config/iiko-dashboard');
const serverId = z.enum(servers.map((server) => server.id));
const reportType = z.enum(['SALES', 'TRANSACTIONS', 'DELIVERIES']);
const date = z.iso.date();
const field = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_.-]+$/);
const filter = z
  .object({
    field,
    exclude: z.boolean().default(false),
    values: z
      .array(z.union([z.string().max(250), z.number(), z.boolean()]))
      .min(1)
      .max(100),
  })
  .strict();
const reportQuery = z
  .object({
    serverId,
    reportType: reportType.default('SALES'),
    from: date,
    to: date,
    groupBy: z.array(field).max(5).default([]),
    aggregate: z.array(field).min(1).max(12),
    filters: z.array(filter).max(15).default([]),
  })
  .strict()
  .refine((input) => {
    const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
    return days >= 0 && days <= 366;
  }, 'Период должен быть от 1 до 367 дней');
const schemaQuery = z.object({ serverId, reportType: reportType.default('SALES') }).strict();
const balancesQuery = z.object({ serverId, date }).strict();
const balancesExportQuery = z
  .object({
    serverId,
    date,
    store: z.string().max(80).default(''),
    group: z.string().max(80).default(''),
    filter: z.enum(['all', 'negative', 'below', 'above']).default('all'),
  })
  .strict();

const analyticsQuery = z
  .object({
    serverId,
    from: date,
    to: date,
    view: z.enum([
      'branches',
      'cashiers',
      'products',
      'discounts',
      'cashierProducts',
      'productBranches',
      'writeoffBranches',
      'writeoffProducts',
      'writeoffDocuments',
    ]),
    department: z.string().max(250).default(''),
    cashierId: z.string().max(80).default(''),
    productId: z.string().max(80).default(''),
  })
  .strict()
  .refine((input) => {
    const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
    return days >= 0 && days <= 366;
  }, 'Некорректный период');

const controlsQuery = z
  .object({
    serverId,
    from: date,
    to: date,
    mode: z.enum(['writeoffs', 'operations', 'assortment']),
    department: z.string().max(250).default(''),
    discountThreshold: z.number().min(1).max(100).default(30),
    returnThreshold: z.number().min(1).max(10000000).default(50000),
  })
  .strict()
  .refine((input) => {
    const days = (Date.parse(input.to) - Date.parse(input.from)) / 86400000;
    return days >= 0 && days <= 366;
  }, 'Некорректный период');
const controlsExportQuery = z
  .object({
    query: controlsQuery,
    table: z.enum([
      'branches',
      'products',
      'documents',
      'reasons',
      'trend',
      'discounts',
      'returns',
      'assortment',
    ]),
    flaggedOnly: z.boolean().default(false),
    adviceOnly: z.boolean().default(false),
  })
  .strict();
const receiptQuery = z
  .object({
    serverId,
    date,
    orderId: z.uuid(),
    department: z.string().min(1).max(250),
  })
  .strict();
module.exports = {
  receiptQuery,
  reportQuery,
  schemaQuery,
  balancesQuery,
  balancesExportQuery,
  analyticsQuery,
  controlsQuery,
  controlsExportQuery,
};

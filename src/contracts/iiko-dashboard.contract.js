const { z } = require('../middlewares/validation.middleware');
const serverId = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);
const serverHost = z
  .string()
  .trim()
  .max(300)
  .transform((value) =>
    value
      .toLowerCase()
      .replace(/^https:\/\//, '')
      .replace(/\/$/, ''),
  )
  .refine((value) => /^[a-z0-9][a-z0-9-]{0,62}\.iiko\.it$/.test(value), {
    message: 'Некорректный адрес сервера iiko',
  });
const serverMutation = z
  .object({
    host: serverHost,
    city: z.enum(['aktau', 'astana']),
    kind: z.enum(['chain', 'rms']),
    useCityCredentials: z.boolean().default(true),
    login: z.string().trim().max(160).default(''),
    password: z.string().max(512).default(''),
  })
  .strict()
  .refine(
    (input) => input.useCityCredentials || (input.login.length > 0 && input.password.length > 0),
    { message: 'Укажите логин и пароль iiko' },
  );
const serverParams = z.object({ id: serverId }).strict();
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
const departmentsQuery = z.object({ serverId }).strict();
const balancesQuery = z.object({ serverId, date }).strict();
const revisionQuery = z
  .object({ serverId, from: date, to: date, department: z.string().max(250).default('') })
  .strict();
const cashReportQuery = z
  .object({
    serverId,
    from: date,
    to: date,
    department: z.string().max(250).default(''),
    shift: z.string().max(80).default(''),
    search: z.string().trim().max(160).default(''),
  })
  .strict()
  .refine((input) => Date.parse(input.to) >= Date.parse(input.from), 'Некорректный период');
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
const barterScope = z.object({
  serverId,
  from: date,
  to: date,
  department: z.string().max(250).default(''),
});
const validBarterRange = (input) =>
  Date.parse(input.to) >= Date.parse(input.from) &&
  Date.parse(input.to) - Date.parse(input.from) <= 366 * 86400000;
const barterQuery = barterScope.strict().refine(validBarterRange, 'Некорректный период');
const invoiceQuery = barterScope
  .extend({ supplier: z.string().trim().max(250).default('') })
  .strict()
  .refine(validBarterRange, 'Некорректный период');
const barterPersonMutation = z
  .object({
    query: barterQuery,
    documentKey: z.string().regex(/^[a-f0-9]{64}$/),
    bloggerName: z
      .string()
      .trim()
      .max(160)
      .regex(/^[^\p{Cc}]*$/u),
  })
  .strict();
module.exports = {
  serverMutation,
  serverParams,
  invoiceQuery,
  barterQuery,
  barterPersonMutation,
  receiptQuery,
  reportQuery,
  schemaQuery,
  departmentsQuery,
  balancesQuery,
  revisionQuery,
  cashReportQuery,
  balancesExportQuery,
  analyticsQuery,
  controlsQuery,
  controlsExportQuery,
};

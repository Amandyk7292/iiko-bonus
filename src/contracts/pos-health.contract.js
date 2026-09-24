const { z } = require('../middlewares/validation.middleware');
const { iikoGuidSchema } = require('./iiko-guid.schema');

const queueSchema = z
  .object({
    loyaltyPending: z.number().int().min(0).max(10000),
    loyaltyFailed: z.number().int().min(0).max(10000),
    giftPending: z.number().int().min(0).max(10000),
    giftFailed: z.number().int().min(0).max(10000),
    offlineReceipts: z.number().int().min(0).max(10000),
    stockPending: z.number().int().min(0).max(10000),
    automaticReceipts: z.number().int().min(0).max(10000),
    personalAccountPending: z.number().int().min(0).max(10000),
  })
  .strict();

const posHealthHeartbeatSchema = z
  .object({
    terminalId: iikoGuidSchema,
    pluginVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    apiVersion: z.string().trim().min(1).max(80),
    startedAt: z.string().datetime({ offset: true }),
    connectedToMain: z.boolean(),
    printerStatus: z.enum(['unknown', 'ready', 'missing', 'error']),
    queues: queueSchema,
    statuses: z
      .object({
        loyalty: z.string().max(1000),
        gifts: z.string().max(1000),
        stock: z.string().max(1000),
        receipts: z.string().max(1000),
        offlineReceipts: z.string().max(1000),
        personalAccount: z.string().max(1000),
      })
      .strict(),
    errors: z
      .array(
        z
          .object({
            kind: z.enum([
              'personal_account',
              'front_receipt',
              'assembly_print',
              'loyalty_queue',
              'offline_receipt',
              'stock_sync',
              'plugin_health',
            ]),
            sourceId: z.string().trim().max(160).optional(),
            message: z.string().trim().min(1).max(1000),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

const posPolicyBodySchema = z
  .object({
    latestVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    minimumVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    enforceMinimum: z.boolean(),
    downloadUrl: z.string().trim().min(1).max(1000),
    guideUrl: z.string().trim().min(1).max(1000),
  })
  .strict();

const reconciliationParamsSchema = z.object({ id: z.string().uuid() }).strict();
const reconciliationActionSchema = z
  .object({
    action: z.enum(['retry', 'check', 'close']),
    reason: z.string().trim().min(3).max(500).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.action === 'close' && !value.reason) {
      ctx.addIssue({
        code: 'custom',
        message: 'Укажите результат ручной сверки',
        path: ['reason'],
      });
    }
  });

module.exports = {
  posHealthHeartbeatSchema,
  posPolicyBodySchema,
  reconciliationActionSchema,
  reconciliationParamsSchema,
};

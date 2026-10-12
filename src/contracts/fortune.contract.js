const { z } = require('zod');
const id = z.string().uuid();
const token = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const instant = z.iso.datetime({ offset: true }).nullable();
const prize = z
  .object({
    id: id.optional(),
    label: z.string().trim().min(1).max(100),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    kind: z.enum(['gift', 'bonus', 'none']),
    bonusAmount: z.number().int().min(1).max(100000).nullable(),
    weight: z.number().int().min(0).max(100),
    stockLimit: z.number().int().min(0).max(1000000).nullable(),
    validityDays: z.number().int().min(1).max(365),
    active: z.boolean(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.kind === 'bonus') !== (value.bonusAmount !== null))
      ctx.addIssue({ code: 'custom', path: ['bonusAmount'], message: 'Укажите сумму бонусов' });
    if (value.kind === 'none' && value.stockLimit !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['stockLimit'],
        message: 'Сектор без приза не ограничивается',
      });
  });
const campaignShape = {
  title: z.string().trim().min(1).max(160),
  status: z.enum(['draft', 'active', 'paused']),
  branchIds: z
    .array(id)
    .min(1)
    .max(100)
    .refine((v) => new Set(v).size === v.length),
  startsAt: instant,
  endsAt: instant,
  minReceiptAmount: z.number().min(0).max(10000000).multipleOf(0.01),
  maxReceiptAgeHours: z.number().int().min(1).max(168),
  prizes: z.array(prize).min(2).max(12),
};
function campaignRefinement(value, ctx) {
  if (value.startsAt && value.endsAt && Date.parse(value.startsAt) >= Date.parse(value.endsAt))
    ctx.addIssue({
      code: 'custom',
      path: ['endsAt'],
      message: 'Дата окончания должна быть позже начала',
    });
  const ids = value.prizes.map((p) => p.id).filter(Boolean);
  if (new Set(ids).size !== ids.length)
    ctx.addIssue({ code: 'custom', path: ['prizes'], message: 'Секторы должны быть различными' });
  if (value.status !== 'active') return;
  const active = value.prizes.filter((p) => p.active);
  if (active.length < 2 || active.reduce((n, p) => n + p.weight, 0) !== 100)
    ctx.addIssue({
      code: 'custom',
      path: ['prizes'],
      message: 'Вероятности активных секторов должны составлять 100%',
    });
  if (!active.some((p) => p.kind === 'none' && p.weight > 0))
    ctx.addIssue({
      code: 'custom',
      path: ['prizes'],
      message: 'Добавьте активный сектор без приза',
    });
}
module.exports = {
  campaignCreate: z.object(campaignShape).strict().superRefine(campaignRefinement),
  campaignPatch: z
    .object({ ...campaignShape, expectedVersion: z.number().int().positive() })
    .strict()
    .superRefine(campaignRefinement),
  idParams: z.object({ id }).strict(),
  wheelParams: z.object({ campaignId: id, branchId: id }).strict(),
  qrParams: z.object({ id, branchId: id }).strict(),
  winnersQuery: z
    .object({
      page: z.coerce.number().int().min(1).max(100000).default(1),
      status: z.enum(['pending', 'claimed', 'redeemed', 'expired']).optional(),
    })
    .strict(),
  spinBody: z.object({ receiptToken: token }).strict(),
  claimBody: z.object({ claimToken: token }).strict(),
  empty: z.object({}).strict(),
};

const { z } = require('../middlewares/validation.middleware');
const relations = [
  'child',
  'husband',
  'wife',
  'sister',
  'brother',
  'mother',
  'father',
  'grandmother',
  'grandfather',
];
const relation = z.enum(relations);
const dailyLimit = z.number().int().min(0).max(200000);
const memberParams = z.object({ id: z.uuid() }).strict();
const inviteBody = z
  .object({
    phone: z.string().min(10).max(24),
    relation: relation.exclude(['child']),
    dailyLimit: dailyLimit.default(0),
  })
  .strict();
const invitationAnswerBody = z.object({ decision: z.enum(['accept', 'decline']) }).strict();
const childBody = z
  .object({
    name: z.string().trim().min(1).max(80),
    login: z
      .string()
      .trim()
      .regex(/^[A-Za-z][A-Za-z0-9._-]{2,31}$/),
    email: z.email().max(254),
    password: z.string().min(8).max(72),
    dailyLimit: dailyLimit.default(0),
  })
  .strict();
const childLoginBody = z
  .object({ login: z.string().trim().min(3).max(32), password: z.string().min(1).max(72) })
  .strict();
const memberUpdateBody = z
  .object({
    dailyLimit: dailyLimit.optional(),
    blocked: z.boolean().optional(),
    password: z.string().min(8).max(72).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0);
const qrBody = z.object({ purpose: z.enum(['loyalty', 'payment']).default('loyalty') }).strict();
module.exports = {
  relations,
  inviteBody,
  invitationAnswerBody,
  childBody,
  childLoginBody,
  memberUpdateBody,
  memberParams,
  qrBody,
};

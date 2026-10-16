const { z } = require('../middlewares/validation.middleware');
const text = (maximum) => z.string().trim().min(1).max(maximum);
const branchIds = z
  .array(z.uuid())
  .min(1)
  .max(50)
  .refine((ids) => new Set(ids).size === ids.length);
const date = z.iso.date();
const inspectorCreate = z.object({ name: text(100), city: text(100), branchIds }).strict();
const inspectorPatch = inspectorCreate
  .partial()
  .extend({ active: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
const task = z
  .object({
    title: text(200),
    instructions: z.string().trim().max(2000).default(''),
    evidenceType: z.enum(['none', 'photo', 'video', 'photo_video']),
  })
  .strict();
const createRound = z
  .object({
    inspectorId: z.uuid(),
    branchIds,
    title: text(200),
    date,
    deadline: z.iso.datetime({ offset: true }),
    tasks: z.array(task).min(1).max(30),
  })
  .strict()
  .refine((value) => Date.parse(value.deadline) >= Date.parse(`${value.date}T00:00:00+05:00`), {
    message: 'Дедлайн не может быть раньше дня обхода',
    path: ['deadline'],
  });
const rangeQuery = z
  .object({ from: date, to: date, city: text(100).optional() })
  .strip()
  .refine((v) => v.to >= v.from && Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000);
module.exports = {
  inspectorCreate,
  inspectorPatch,
  createRound,
  rangeQuery,
  inspectorParams: z.object({ inspectorId: z.uuid() }).strict(),
  roundParams: z.object({ roundId: z.uuid() }).strict(),
  taskParams: z.object({ taskId: z.uuid() }).strict(),
  mediaParams: z.object({ mediaId: z.uuid() }).strict(),
  dateQuery: z.object({ date }).strip(),
  login: z.object({ username: text(80), password: z.string().min(1).max(128) }).strict(),
  complete: z.object({ comment: z.string().trim().max(2000).default('') }).strict(),
};

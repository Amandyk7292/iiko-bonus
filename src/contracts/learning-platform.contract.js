const { z, emptyBodySchema } = require('../middlewares/validation.middleware');

const uuid = z.string().uuid();
const text = (maximum, minimum = 0) => z.string().trim().min(minimum).max(maximum);
const ids = z
  .array(uuid)
  .max(100)
  .refine((values) => new Set(values).size === values.length);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00Z`);
    return (
      value >= '1900-01-01' &&
      Number.isFinite(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const videoUrl = z
  .string()
  .max(2000)
  .refine((value) => {
    try {
      const parsed = new URL(value);
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
    } catch {
      return false;
    }
  }, 'Укажите HTTPS-ссылку на видео')
  .nullable();
const lesson = z
  .object({
    id: uuid.optional(),
    title: text(240, 1),
    body: text(50000).default(''),
    videoUrl: videoUrl.default(null),
    estimatedMinutes: z.number().int().min(0).max(1440).default(5),
    sortOrder: z.number().int().min(0).max(10000).default(0),
  })
  .strict()
  .refine((value) => value.body || value.videoUrl, 'Добавьте текст или видео урока');
const moduleSchema = z
  .object({
    id: uuid.optional(),
    title: text(240, 1),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    lessons: z.array(lesson).max(100),
  })
  .strict();
const courseShape = {
  title: text(240, 1),
  description: text(10000).default(''),
  roleIds: ids.default([]),
  published: z.boolean().default(false),
  modules: z.array(moduleSchema).max(100).default([]),
};
const course = z.object(courseShape).strict();
const choice = z.object({ id: uuid, text: text(2000, 1) }).strict();
const question = z
  .object({
    id: uuid.optional(),
    prompt: text(5000, 1),
    choices: z.array(choice).min(2).max(8),
    correctChoiceId: uuid,
    explanation: text(10000).default(''),
  })
  .strict()
  .refine(
    (value) => value.choices.some((item) => item.id === value.correctChoiceId),
    'Правильный ответ должен быть одним из вариантов',
  );
const assessmentShape = {
  title: text(240, 1),
  description: text(10000).default(''),
  kind: z.enum(['practice', 'control', 'promotion']),
  roleIds: ids.default([]),
  published: z.boolean().default(false),
  questionCount: z.number().int().min(1).max(100),
  maxAttempts: z.number().int().min(1).max(100),
  passPercent: z.number().int().min(1).max(100),
  timeLimitMinutes: z.number().int().min(1).max(180),
  cooldownMinutes: z.number().int().min(0).max(43200).default(0),
  minimumTenureDays: z.number().int().min(0).max(36500).default(0),
  requiredCourseIds: ids.default([]),
  targetRoleId: uuid.nullable().default(null),
  questions: z.array(question).max(500).default([]),
};
const nonemptyPatch = (schema) => schema.refine((value) => Object.keys(value).length > 0);
const patch = (shape) =>
  nonemptyPatch(
    z
      .object(
        Object.fromEntries(
          Object.entries(shape).map(([key, value]) => [
            key,
            value instanceof z.ZodDefault ? value.removeDefault() : value,
          ]),
        ),
      )
      .partial()
      .strict(),
  );
const role = z
  .object({
    title: text(240, 1),
    description: text(10000).default(''),
    active: z.boolean().default(true),
  })
  .strict();
const assignment = z
  .object({
    employeeUsername: text(160, 1)
      .regex(/^[+0-9A-Za-z@._:-]+$/)
      .nullable()
      .default(null),
    roleId: uuid.nullable().default(null),
    courseId: uuid.nullable().default(null),
    assessmentId: uuid.nullable().default(null),
    required: z.boolean().default(true),
    dueAt: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict()
  .refine(
    (value) => Boolean(value.employeeUsername) !== Boolean(value.roleId),
    'Выберите одного сотрудника или должность',
  )
  .refine(
    (value) => Boolean(value.courseId) !== Boolean(value.assessmentId),
    'Выберите один курс или тест',
  );

module.exports = {
  idParams: z.object({ id: uuid }).strict(),
  usernameParams: z.object({ username: text(160, 1).regex(/^[+0-9A-Za-z@._:-]+$/) }).strict(),
  empty: emptyBodySchema,
  roleCreate: role,
  rolePatch: patch(role.shape),
  courseCreate: course,
  coursePatch: patch(courseShape),
  assessmentCreate: z.object(assessmentShape).strict(),
  assessmentPatch: patch(assessmentShape),
  employeePatch: nonemptyPatch(
    z
      .object({
        jobRoleId: uuid.nullable().optional(),
        startDate: date.nullable().optional(),
        learningEnabled: z.boolean().optional(),
      })
      .strict(),
  ),
  assignmentCreate: assignment,
  completeLesson: z.object({ completed: z.literal(true) }).strict(),
  submitAttempt: z
    .object({
      answers: z
        .array(z.object({ questionId: uuid, choiceId: uuid }).strict())
        .min(1)
        .max(100)
        .refine(
          (values) => new Set(values.map((value) => value.questionId)).size === values.length,
        ),
    })
    .strict(),
  promotionDecision: z.object({ decision: z.enum(['approved', 'rejected']) }).strict(),
};

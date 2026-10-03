const { z } = require('../middlewares/validation.middleware');

const plainText = (maximum, { required = false } = {}) =>
  z
    .string()
    .trim()
    .min(required ? 1 : 0)
    .max(maximum)
    .refine((value) => !/<\/?[a-z][^>]*>/i.test(value), 'Используйте обычный текст без HTML')
    .refine(
      (value) =>
        ![...value].some((character) => {
          const code = character.charCodeAt(0);
          return (code < 32 && ![9, 10, 13].includes(code)) || code === 127;
        }),
      'Текст содержит недопустимые символы',
    );

const faqBodySchema = z
  .object({
    questionRu: plainText(240, { required: true }),
    answerRu: plainText(4000, { required: true }),
    questionKk: plainText(240).optional().default(''),
    answerKk: plainText(4000).optional().default(''),
    sortOrder: z.number().int().min(0).max(2_147_483_647),
    isActive: z.boolean(),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.questionKk) !== Boolean(value.answerKk)) {
      context.addIssue({
        code: 'custom',
        path: [value.questionKk ? 'answerKk' : 'questionKk'],
        message: 'Заполните и вопрос, и ответ на казахском или оставьте оба поля пустыми',
      });
    }
  });

const faqParamsSchema = z.object({ id: z.string().uuid() }).strict();
const faqQuerySchema = z.object({ lang: z.enum(['ru', 'kk']).optional().default('ru') }).strict();

module.exports = { faqBodySchema, faqParamsSchema, faqQuerySchema };

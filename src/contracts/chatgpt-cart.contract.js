const { z } = require('../middlewares/validation.middleware');

const chatgptCartIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const chatgptCartSelectionSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .refine((value) => !/\p{Cc}/u.test(value), 'Некорректный вариант товара');
const chatgptCartConfigurationSchema = z
  .object({
    weight: chatgptCartSelectionSchema.optional(),
    filling: chatgptCartSelectionSchema.optional(),
    design: chatgptCartSelectionSchema.optional(),
  })
  .strict();
const chatgptCartModifierSchema = z
  .object({
    groupId: chatgptCartSelectionSchema,
    optionIds: z.array(chatgptCartSelectionSchema).min(1).max(10),
  })
  .strict();
const chatgptCartItemSchema = z
  .object({
    id: chatgptCartIdSchema,
    quantity: z.number().min(0.001).max(99).multipleOf(0.001),
    configuration: chatgptCartConfigurationSchema.optional(),
    modifiers: z.array(chatgptCartModifierSchema).max(10).optional(),
  })
  .strict();
const chatgptCartPrepareSchema = z
  .object({
    branchId: z.string().trim().uuid(),
    orderType: z.enum(['pickup', 'delivery', 'preorder']).default('pickup'),
    language: z.enum(['ru', 'kk', 'en']).default('ru'),
    items: z.array(chatgptCartItemSchema).min(1).max(20),
  })
  .strict();
const chatgptCartTokenSchema = z
  .string()
  .min(16)
  .max(8192)
  .regex(/^bc1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
const chatgptCartResolveSchema = z.object({ token: chatgptCartTokenSchema }).strict();

module.exports = {
  chatgptCartConfigurationSchema,
  chatgptCartItemSchema,
  chatgptCartPrepareSchema,
  chatgptCartResolveSchema,
  chatgptCartTokenSchema,
};

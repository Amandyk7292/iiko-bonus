const { z } = require('zod');
const { AppError } = require('../utils/app-error.util');

const validationIssue = (issue) => ({
  path: issue.path.map(String).join('.'),
  message: issue.message,
});

const validateRequest =
  ({ body, params, query } = {}) =>
  (req, res, next) => {
    for (const [part, schema] of Object.entries({ body, params, query })) {
      if (!schema) continue;
      const result = schema.safeParse(req[part]);
      if (!result.success) {
        return next(
          new AppError('Некорректные параметры запроса', {
            statusCode: 400,
            expose: true,
            code: 'VALIDATION_ERROR',
            fields: result.error.issues.slice(0, 20).map(validationIssue),
          }),
        );
      }
      req[part] = result.data;
    }
    return next();
  };

const emptyBodySchema = z.object({}).strict().default({});

const requestBodySafetyMiddleware = (req, _res, next) => {
  if (!req.body || typeof req.body !== 'object') return next();
  const stack = [{ value: req.body, depth: 0 }];
  let keys = 0;

  while (stack.length) {
    const { value, depth } = stack.pop();
    if (depth > 16) {
      return next(
        new AppError('Тело запроса имеет слишком большую вложенность', {
          statusCode: 400,
          expose: true,
          code: 'REQUEST_BODY_TOO_DEEP',
        }),
      );
    }
    if (!value || typeof value !== 'object') continue;
    for (const [key, child] of Object.entries(value)) {
      keys += 1;
      if (keys > 2_000) {
        return next(
          new AppError('Тело запроса содержит слишком много полей', {
            statusCode: 400,
            expose: true,
            code: 'REQUEST_BODY_TOO_COMPLEX',
          }),
        );
      }
      if (['__proto__', 'prototype', 'constructor'].includes(key)) {
        return next(
          new AppError('Недопустимое поле в теле запроса', {
            statusCode: 400,
            expose: true,
            code: 'REQUEST_BODY_UNSAFE_KEY',
          }),
        );
      }
      if (typeof child === 'string' && Buffer.byteLength(child, 'utf8') > 1_900_000) {
        return next(
          new AppError('Поле в теле запроса слишком большое', {
            statusCode: 413,
            expose: true,
            code: 'REQUEST_FIELD_TOO_LARGE',
          }),
        );
      }
      if (child && typeof child === 'object') stack.push({ value: child, depth: depth + 1 });
    }
  }
  return next();
};

module.exports = {
  emptyBodySchema,
  requestBodySafetyMiddleware,
  validateRequest,
  z,
};

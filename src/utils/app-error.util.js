class AppError extends Error {
  constructor(
    message,
    { statusCode = 500, code = 'INTERNAL_ERROR', expose = false, cause, fields } = {},
  ) {
    super(message, { cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.expose = expose;
    this.fields = fields;
  }
}

const publicError = (statusCode, code, message, options = {}) =>
  new AppError(message, { ...options, statusCode, code, expose: true });

module.exports = {
  AppError,
  badRequest: (code, message) => publicError(400, code, message),
  conflict: (code, message) => publicError(409, code, message),
  forbidden: (code, message) => publicError(403, code, message),
  notFound: (code, message) => publicError(404, code, message),
  publicError,
  unauthorized: (code, message) => publicError(401, code, message),
};

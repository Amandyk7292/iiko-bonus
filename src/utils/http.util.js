function sendApiError(res, error, extra = {}) {
  console.error(error);
  const candidate = Number(error?.statusCode || 500);
  const status = candidate >= 400 && candidate < 500 ? candidate : 500;
  return res.status(status).json({
    ...extra,
    error: status < 500 ? error.message : 'Internal server error',
  });
}

module.exports = { sendApiError };

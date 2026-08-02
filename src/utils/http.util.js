function sendApiError(res, error, extra = {}) {
  const candidate = Number(error?.statusCode || 500);
  const status = candidate >= 400 && candidate < 500 ? candidate : 500;
  const request = res.req;
  request?.log?.[status >= 500 ? 'error' : 'warn'](
    {
      err: error,
      event: 'api_request_failed',
      method: request?.method,
      path: request?.path,
      statusCode: status,
      errorCode: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
    },
    'API request failed',
  );
  return res.status(status).json({
    ...extra,
    error:
      status < 500 && error?.expose !== false
        ? error?.message || 'Request failed'
        : 'Internal Server Error',
    code: error?.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
  });
}

module.exports = { sendApiError };

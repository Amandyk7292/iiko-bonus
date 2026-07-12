const RESULT_CODE_FIELDS = ['StatusCode', 'ResultCode', 'Code'];

export const getKaspiResultCodes = (body) => {
  if (!body || typeof body !== 'object') return [];

  const codes = [];
  for (const field of RESULT_CODE_FIELDS) {
    const value = body[field];
    if (value !== undefined && value !== null && value !== '') codes.push(value);
  }

  return codes;
};

export const getKaspiResultCode = (body) => {
  const codes = getKaspiResultCodes(body) || [];
  return codes.find((value) => Number(value) !== 0) ?? codes[0] ?? null;
};

export const getKaspiErrorMessage = (body, fallback = 'Kaspi отклонил запрос.') => {
  if (!body || typeof body !== 'object') return fallback;
  return body.Message || body.Description || body.message || body.error || fallback;
};

export const isKaspiSuccess = (body) => {
  const codes = getKaspiResultCodes(body) || [];
  return codes.length > 0 && codes.every((value) => Number(value) === 0);
};

export const isKaspiSessionExpired = (body) => {
  const codes = (getKaspiResultCodes(body) || []).map(Number);
  if (codes.some((code) => code === 12 || code === -101001 || code === 401)) return true;

  const message = getKaspiErrorMessage(body, '').toLocaleLowerCase('ru');
  return (
    message.includes('вход с другого устройства') ||
    message.includes('введите логин/пароль') ||
    message.includes('сессия истекла') ||
    message.includes('сессия неактивна') ||
    message.includes('session expired') ||
    message.includes('re-authenticate')
  );
};

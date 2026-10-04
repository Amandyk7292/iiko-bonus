const COOKIE_NAME = 'bulka_report_device';
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const MAX_AGE = 400 * 24 * 60 * 60 * 1000;
function readDeviceCookie(req) {
  const matches = String(req.headers.cookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (matches.length !== 1) return '';
  const token = matches[0].slice(COOKIE_NAME.length + 1);
  return TOKEN_RE.test(token) ? token : '';
}
function writeDeviceCookie(res, token, env = process.env) {
  if (!TOKEN_RE.test(String(token || '')))
    throw new Error('Invalid photo-report device credential');
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: env.NODE_ENV === 'production',
    path: '/api/branch-reports',
    maxAge: MAX_AGE,
  });
}
module.exports = { COOKIE_NAME, MAX_AGE, readDeviceCookie, writeDeviceCookie };

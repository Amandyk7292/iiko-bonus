const CUSTOMER_REFRESH_COOKIE = 'bulka_customer_refresh';
const SESSION_TRANSPORT_HEADER = 'x-bulka-session-transport';

function parseCookies(req) {
  const header = String(req?.headers?.cookie || '');
  const cookies = {};
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const rawValue = part.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      cookies[name] = rawValue;
    }
  }
  return cookies;
}

function readCustomerRefreshCookie(req) {
  return String(parseCookies(req)[CUSTOMER_REFRESH_COOKIE] || '').trim();
}

function usesCustomerRefreshCookie(req) {
  return (
    String(req?.headers?.[SESSION_TRANSPORT_HEADER] || '').toLowerCase() === 'cookie' ||
    readCustomerRefreshCookie(req).length > 0
  );
}

function cookieOptions(req, session = {}) {
  const expiresAt = Date.parse(session.refreshExpiresAt || '');
  const maxAge = Number.isFinite(expiresAt)
    ? Math.max(0, expiresAt - Date.now())
    : 30 * 24 * 60 * 60 * 1000;
  const forwardedProtocol = String(req?.headers?.['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  return {
    httpOnly: true,
    secure:
      process.env.NODE_ENV !== 'development' ||
      req?.secure === true ||
      forwardedProtocol === 'https',
    sameSite: 'strict',
    path: '/api/auth',
    maxAge,
  };
}

function sendCustomerSession(req, res, session) {
  res.cookie(CUSTOMER_REFRESH_COOKIE, session.refreshToken, cookieOptions(req, session));
  if (!usesCustomerRefreshCookie(req)) return session;
  const browserSession = { ...session };
  delete browserSession.refreshToken;
  return { ...browserSession, refreshSession: 'cookie' };
}

function clearCustomerSessionCookie(req, res) {
  const options = cookieOptions(req);
  delete options.maxAge;
  res.clearCookie(CUSTOMER_REFRESH_COOKIE, options);
}

module.exports = {
  CUSTOMER_REFRESH_COOKIE,
  clearCustomerSessionCookie,
  readCustomerRefreshCookie,
  sendCustomerSession,
  usesCustomerRefreshCookie,
};

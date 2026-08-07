const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const {
  CUSTOMER_REFRESH_COOKIE,
  clearCustomerSessionCookie,
  readCustomerRefreshCookie,
  sendCustomerSession,
} = require('../src/utils/customer-session-cookie.util');
const {
  normalizeNewsI18n,
  parseNewsDescription,
  serializeNewsDescription,
} = require('../src/services/news.service');

test('browser customer sessions use an HttpOnly Secure SameSite cookie', () => {
  const request = {
    headers: {
      'x-bulka-session-transport': 'cookie',
      'x-forwarded-proto': 'https',
    },
  };
  const response = {
    cookies: [],
    cleared: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    clearCookie(name, options) {
      this.cleared.push({ name, options });
    },
  };
  const session = {
    accessToken: 'short-lived-access',
    refreshToken: 'long-lived-refresh',
    refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  const payload = sendCustomerSession(request, response, session);

  assert.equal(payload.accessToken, session.accessToken);
  assert.equal(payload.refreshToken, undefined);
  assert.equal(payload.refreshSession, 'cookie');
  assert.equal(response.cookies[0].name, CUSTOMER_REFRESH_COOKIE);
  assert.equal(response.cookies[0].value, session.refreshToken);
  assert.equal(response.cookies[0].options.httpOnly, true);
  assert.equal(response.cookies[0].options.secure, true);
  assert.equal(response.cookies[0].options.sameSite, 'strict');
  assert.equal(response.cookies[0].options.path, '/api/auth');

  clearCustomerSessionCookie(request, response);
  assert.equal(response.cleared[0].name, CUSTOMER_REFRESH_COOKIE);
  assert.equal(response.cleared[0].options.path, '/api/auth');
});

test('native-compatible auth responses still issue a durable browser cookie', () => {
  const request = {
    headers: {
      'x-forwarded-proto': 'https',
    },
  };
  const response = {
    cookies: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
  };
  const session = {
    accessToken: 'short-lived-access',
    refreshToken: 'long-lived-refresh',
    refreshExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  };

  const payload = sendCustomerSession(request, response, session);

  assert.equal(payload.refreshToken, session.refreshToken);
  assert.equal(response.cookies[0].name, CUSTOMER_REFRESH_COOKIE);
  assert.equal(response.cookies[0].value, session.refreshToken);
  assert.equal(response.cookies[0].options.httpOnly, true);
});

test('refresh cookie parser handles encoded values without accepting unrelated cookies', () => {
  const request = {
    headers: {
      cookie: `other=value; ${CUSTOMER_REFRESH_COOKIE}=refresh%2Etoken`,
    },
  };
  assert.equal(readCustomerRefreshCookie(request), 'refresh.token');
});

test('News localization preserves the kz backend contract', () => {
  const i18n = normalizeNewsI18n({
    ru: { title: 'Новость', description: 'Текст', imageUrl: 'ru.webp' },
    kk: { title: 'Жаңалық', description: 'Мәтін', imageUrl: 'kk.webp' },
    en: { title: 'News', description: 'Text', imageUrl: 'en.webp' },
  });
  assert.equal(i18n.kz.title, 'Жаңалық');
  assert.equal(i18n.kk, undefined);

  const encoded = serializeNewsDescription(i18n.ru.description, i18n);
  const restored = parseNewsDescription(encoded, {
    title: i18n.ru.title,
    imageUrl: i18n.ru.imageUrl,
  });
  assert.equal(restored.description, 'Текст');
  assert.equal(restored.i18n.kz.description, 'Мәтін');
});

test('web storage and Android order status keep sensitive data private', () => {
  const root = path.join(__dirname, '..');
  const webStorage = fs.readFileSync(
    path.join(root, 'BulkaAndroid', 'lib', 'core', 'session_storage_backend_web.dart'),
    'utf8',
  );
  const androidActivity = fs.readFileSync(
    path.join(
      root,
      'BulkaAndroid',
      'android',
      'app',
      'src',
      'main',
      'kotlin',
      'com',
      'bulka',
      'bonus',
      'MainActivity.kt',
    ),
    'utf8',
  );

  assert.match(webStorage, /sessionStorage\.setItem/);
  assert.match(webStorage, /key == _refreshKey/);
  assert.doesNotMatch(webStorage, /localStorage\.setItem\(key,\s*value\)/);
  assert.match(androidActivity, /Notification\.VISIBILITY_PRIVATE/);
  assert.match(androidActivity, /\.setPublicVersion\(publicVersion\)/);
  const privateNotification = androidActivity.split('val notification = builder')[1];
  assert.match(privateNotification, /\.setVisibility\(Notification\.VISIBILITY_PRIVATE\)/);
  assert.doesNotMatch(privateNotification, /Notification\.VISIBILITY_PUBLIC/);
});

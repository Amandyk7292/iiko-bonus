const {
  getSiteAccessConfig,
  isIpAllowed,
  normalizeIpAddress,
} = require('../services/site-access.service');
const { allLegalPagePaths } = require('../services/legal-page.service');
const { logger: applicationLogger } = require('../config/logger');

const EXEMPT_SITE_PATHS = new Set([
  '/account-deletion',
  '/courier',
  '/healthz',
  '/livez',
  '/readyz',
  '/robots.txt',
  '/sitemap.xml',
  ...allLegalPagePaths().flatMap((legalPath) => [legalPath, `${legalPath}/`]),
]);
const EXEMPT_SITE_PREFIXES = [
  '/admin',
  '/api',
  '/webhooks',
  '/kaspi-pos',
  '/.well-known',
  '/maps',
  '/payment-receipts',
  '/assets/legal',
  '/internal',
];

const isSameOrChildPath = (requestPath, prefix) =>
  requestPath === prefix || requestPath.startsWith(`${prefix}/`);

function isProtectedSitePath(requestPath) {
  const normalizedPath = String(requestPath || '/');
  if (EXEMPT_SITE_PATHS.has(normalizedPath)) return false;
  return !EXEMPT_SITE_PREFIXES.some((prefix) => isSameOrChildPath(normalizedPath, prefix));
}

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

function renderAccessPage({ clientIp, unavailable = false }) {
  const title = unavailable ? 'Сайт временно недоступен' : 'Доступ ограничен';
  const description = unavailable
    ? 'Не удалось проверить разрешение на вход. Попробуйте ещё раз через несколько минут.'
    : 'Этот сайт доступен только с IP-адресов, добавленных администратором.';
  const ipBlock = unavailable
    ? ''
    : `<div class="ip-card"><span>Ваш IP-адрес</span><strong>${escapeHtml(
        clientIp || 'не определён',
      )}</strong></div>`;
  const hint = unavailable
    ? 'Обновите страницу позже. Администратор может продолжить работу в панели управления.'
    : 'Если вам нужен доступ, передайте этот IP администратору Bulka.';

  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#fcfbf9" />
    <title>${title} — Bulka</title>
    <style>
      :root { color-scheme: light; --page:#fcfbf9; --surface:#fff; --text:#3b2117; --muted:#6f6259; --accent:#9a714a; --border:#e8dccb; --soft:#fff5e6; }
      * { box-sizing: border-box; }
      body { min-width:320px; min-height:100vh; min-height:100dvh; margin:0; padding:24px; display:grid; place-items:center; background:var(--page); color:var(--text); font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; line-height:1.55; }
      main { width:min(100%,480px); padding:clamp(28px,7vw,48px); border:1px solid var(--border); border-radius:24px; background:var(--surface); box-shadow:0 24px 70px rgba(59,33,23,.09); text-align:center; }
      .icon { width:64px; height:64px; margin:0 auto 22px; display:grid; place-items:center; border-radius:20px; background:var(--soft); color:var(--accent); }
      h1 { margin:0 0 10px; font-family:Georgia,"Times New Roman",serif; font-size:clamp(1.8rem,7vw,2.35rem); line-height:1.15; }
      p { max-width:38ch; margin:0 auto; color:var(--muted); }
      .ip-card { margin:26px 0 0; padding:15px 18px; display:flex; align-items:center; justify-content:space-between; gap:16px; border:1px solid var(--border); border-radius:14px; background:var(--soft); text-align:left; }
      .ip-card span { color:var(--muted); font-size:.82rem; }
      .ip-card strong { overflow-wrap:anywhere; font-family:ui-monospace,SFMono-Regular,Menlo,monospace; font-size:.9rem; font-variant-numeric:tabular-nums; }
      .hint { margin-top:18px; font-size:.82rem; }
      @media (max-width:480px) { body { padding:12px; } main { border-radius:18px; } .ip-card { align-items:flex-start; flex-direction:column; gap:4px; } }
    </style>
  </head>
  <body>
    <main aria-labelledby="page-title">
      <div class="icon" aria-hidden="true">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M20 13c0 5-3.5 7.5-8 9-4.5-1.5-8-4-8-9V5l8-3 8 3v8Z"/><path d="M9 12l2 2 4-4"/></svg>
      </div>
      <h1 id="page-title">${title}</h1>
      <p>${description}</p>
      ${ipBlock}
      <p class="hint">${hint}</p>
    </main>
  </body>
</html>`;
}

const wantsHtml = (req) => {
  const pathHasAssetExtension = /\.[a-z0-9]{1,8}$/i.test(String(req.path || ''));
  return !pathHasAssetExtension && Boolean(req.accepts('html'));
};

function sendBlockedResponse(req, res, { status, clientIp, unavailable = false }) {
  res.status(status);
  res.set({
    'Cache-Control': 'no-store, private',
    'X-Robots-Tag': 'noindex, nofollow',
    Vary: 'Accept',
  });
  if (status === 503) res.set('Retry-After', '30');
  if (wantsHtml(req)) {
    if (!unavailable) res.set('Clear-Site-Data', '"cache"');
    return res.type('html').send(renderAccessPage({ clientIp, unavailable }));
  }
  return res.status(status).json({
    error: unavailable
      ? 'Site access check is temporarily unavailable'
      : 'Site access is restricted',
    code: unavailable ? 'SITE_ACCESS_CONFIG_UNAVAILABLE' : 'SITE_IP_NOT_ALLOWED',
    ...(!unavailable && { ip: clientIp }),
  });
}

function createSiteAccessMiddleware({
  loadConfig = getSiteAccessConfig,
  logger = applicationLogger,
} = {}) {
  return async (req, res, next) => {
    if (!isProtectedSitePath(req.path)) return next();

    const clientIp = normalizeIpAddress(req.ip);
    let config;
    try {
      config = await loadConfig();
    } catch (error) {
      logger.error(
        { err: error, event: 'site_access_check_failed', requestId: req.id },
        'Site access configuration check failed',
      );
      return sendBlockedResponse(req, res, { status: 503, clientIp, unavailable: true });
    }

    if (!config.enabled || isIpAllowed(clientIp, config)) return next();
    return sendBlockedResponse(req, res, { status: 403, clientIp });
  };
}

const siteAccessMiddleware = createSiteAccessMiddleware();

module.exports = {
  createSiteAccessMiddleware,
  isProtectedSitePath,
  renderAccessPage,
  siteAccessMiddleware,
};

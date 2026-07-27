const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { allLegalPagePaths } = require('../services/legal-page.service');

const projectRoot = path.resolve(__dirname, '..', '..');

function cspHash(content) {
  const browserNormalizedContent = String(content || '').replace(/\r\n?/g, '\n');
  return `'sha256-${crypto
    .createHash('sha256')
    .update(browserNormalizedContent)
    .digest('base64')}'`;
}

function inlineHashes(relativePath, tagName) {
  const file = path.join(projectRoot, relativePath);
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, 'utf8');
  const sourceAttributeGuard = tagName === 'script' ? '(?![^>]*\\bsrc\\s*=)' : '';
  const expression = new RegExp(
    `<${tagName}\\b${sourceAttributeGuard}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'gi',
  );
  return [...html.matchAll(expression)].map((match) => cspHash(match[1]));
}

function staticDocumentPolicy(relativePath) {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    scriptSrc: ["'self'", ...inlineHashes(relativePath, 'script')],
    scriptSrcAttr: ["'none'"],
    styleSrc: ["'self'", ...inlineHashes(relativePath, 'style')],
    styleSrcAttr: ["'none'"],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:'],
    connectSrc: ["'self'"],
  };
}

const appScriptHashes = inlineHashes('public/app/index.html', 'script');
const staticDocumentPolicies = new Map([
  ['/courier', staticDocumentPolicy('public/courier.html')],
  ['/account-deletion', staticDocumentPolicy('public/legal/account-deletion.html')],
]);
const legalPagePaths = new Set(
  allLegalPagePaths().flatMap((legalPath) => [legalPath, `${legalPath}/`]),
);

const apiPolicy = {
  defaultSrc: ["'none'"],
  baseUri: ["'none'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'none'"],
};

const receiptPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'none'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'none'"],
  formAction: ["'none'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'"],
  styleSrcAttr: ["'none'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'none'"],
};

const legalPagePolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'none'"],
  scriptSrc: ["'none'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'"],
  styleSrcAttr: ["'none'"],
  imgSrc: ["'self'", 'data:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'none'"],
};

const adminPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'"],
  // A few React components position popovers and charts with calculated
  // style attributes. Script execution remains strictly self-hosted.
  styleSrcAttr: ["'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
  frameSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
};

const appPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'"],
  scriptSrc: [
    "'self'",
    ...appScriptHashes,
    "'wasm-unsafe-eval'",
    "'report-sample'",
    'https://www.gstatic.com',
  ],
  scriptSrcAttr: ["'none'"],
  // Flutter creates runtime style elements and calculated style attributes.
  // This exception is isolated from the admin panel and every API route.
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
  connectSrc: [
    "'self'",
    'https://www.gstatic.com',
    'https://fonts.gstatic.com',
    'https://bulka.com.kz',
    'https://*.googleapis.com',
    'https://*.firebaseio.com',
    'https://*.firebaseapp.com',
    'https://*.supabase.co',
    'wss://*.supabase.co',
  ],
  frameSrc: ["'self'"],
  workerSrc: ["'self'", 'blob:'],
  childSrc: ["'self'", 'blob:'],
  manifestSrc: ["'self'"],
};

const walletPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'"],
  scriptSrc: ["'self'"],
  scriptSrcAttr: ["'none'"],
  styleSrc: ["'self'", "'unsafe-inline'"],
  imgSrc: ["'self'", 'data:'],
  connectSrc: ["'self'"],
};

function mapPolicy(nonce) {
  return {
    defaultSrc: ["'self'"],
    baseUri: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'self'"],
    formAction: ["'self'"],
    scriptSrc: [
      "'self'",
      `'nonce-${nonce}'`,
      "'unsafe-eval'",
      'https://api-maps.yandex.ru',
      'https://yastatic.net',
      'https://*.maps.yandex.net',
    ],
    scriptSrcAttr: ["'none'"],
    // The Yandex Maps SDK creates runtime style elements without a nonce.
    // Keep this exception isolated to the map document.
    styleSrc: ["'self'", "'unsafe-inline'", 'https://yastatic.net'],
    imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
    fontSrc: ["'self'", 'data:', 'https://yastatic.net'],
    connectSrc: ["'self'", 'https://*.yandex.ru', 'https://*.yandex.net'],
    workerSrc: ["'self'", 'blob:'],
  };
}

const isolatedLegacyPolicy = {
  defaultSrc: ["'self'", 'https:'],
  baseUri: ["'self'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'", 'https:'],
  scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'https:'],
  scriptSrcAttr: ["'unsafe-inline'"],
  styleSrc: ["'self'", "'unsafe-inline'", 'https:'],
  imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
  fontSrc: ["'self'", 'data:', 'https:'],
  connectSrc: ["'self'", 'https:', 'wss:'],
  frameSrc: ["'self'", 'https:'],
  workerSrc: ["'self'", 'blob:'],
};

function isApiPath(requestPath) {
  return (
    requestPath === '/healthz' ||
    requestPath === '/livez' ||
    requestPath === '/readyz' ||
    requestPath.startsWith('/internal/') ||
    requestPath.startsWith('/api/') ||
    requestPath.startsWith('/admin/api/') ||
    requestPath.startsWith('/webhooks/') ||
    requestPath.startsWith('/.well-known/')
  );
}

function directivesForPath(requestPath, nonce) {
  if (isApiPath(requestPath)) return apiPolicy;
  if (requestPath === '/maps/yandex') return mapPolicy(nonce);
  if (legalPagePaths.has(requestPath)) return legalPagePolicy;
  if (staticDocumentPolicies.has(requestPath)) return staticDocumentPolicies.get(requestPath);
  if (requestPath.startsWith('/payment-receipts/')) return receiptPolicy;
  if (requestPath.startsWith('/wallet/')) return walletPolicy;
  if (
    requestPath.startsWith('/tilda-copy-bot') ||
    requestPath.startsWith('/kaspi-pos') ||
    requestPath.startsWith('/admin/kaspi-pos')
  ) {
    return isolatedLegacyPolicy;
  }
  if (requestPath === '/admin' || requestPath.startsWith('/admin/')) return adminPolicy;
  return appPolicy;
}

function serializePolicy(directives) {
  return Object.entries(directives)
    .map(([directive, sources]) => {
      const name = directive.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`);
      return sources.length ? `${name} ${sources.join(' ')}` : name;
    })
    .join('; ');
}

function contentSecurityPolicyMiddleware(req, res, next) {
  const nonce = crypto.randomBytes(18).toString('base64');
  res.locals.cspNonce = nonce;
  res.setHeader('Content-Security-Policy', serializePolicy(directivesForPath(req.path, nonce)));
  next();
}

module.exports = {
  contentSecurityPolicyMiddleware,
  cspHash,
  directivesForPath,
  inlineHashes,
  serializePolicy,
};

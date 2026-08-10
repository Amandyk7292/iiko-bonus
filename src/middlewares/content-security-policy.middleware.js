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

function inlineHashesFromFile(file, tagName) {
  if (!fs.existsSync(file)) return [];
  const html = fs.readFileSync(file, 'utf8');
  const sourceAttributeGuard = tagName === 'script' ? '(?![^>]*\\bsrc\\s*=)' : '';
  const expression = new RegExp(
    `<${tagName}\\b${sourceAttributeGuard}[^>]*>([\\s\\S]*?)<\\/${tagName}>`,
    'gi',
  );
  return [...html.matchAll(expression)].map((match) => cspHash(match[1]));
}

function inlineHashes(relativePath, tagName) {
  return inlineHashesFromFile(path.join(projectRoot, relativePath), tagName);
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

const publicAppIndex = path.resolve(
  process.env.BULKA_PUBLIC_APP_DIR || path.join(projectRoot, 'public', 'app'),
  'index.html',
);
const appScriptHashes = inlineHashesFromFile(publicAppIndex, 'script');
const registrationPolicy = {
  ...staticDocumentPolicy('public/app.html'),
  imgSrc: ["'self'", 'data:'],
};
const staticDocumentPolicies = new Map([
  ['/guest', registrationPolicy],
  ['/wallet', registrationPolicy],
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

const forteWidgetPolicy = {
  defaultSrc: ["'self'"],
  baseUri: ["'none'"],
  objectSrc: ["'none'"],
  frameAncestors: ["'self'"],
  formAction: ["'self'", 'https://securepayments.fortebank.com', 'https://gateway.fortebank.com'],
  scriptSrc: ["'self'", 'https://js.fortebank.com'],
  scriptSrcAttr: ["'none'"],
  // Forte's loader positions the bank iframe with generated inline styles.
  // This exception is isolated to the payment document.
  styleSrc: ["'self'", "'unsafe-inline'"],
  styleSrcAttr: ["'unsafe-inline'"],
  imgSrc: ["'self'", 'data:', 'https://*.fortebank.com'],
  fontSrc: ["'self'", 'data:'],
  connectSrc: ["'self'", 'https://securepayments.fortebank.com', 'https://gateway.fortebank.com'],
  frameSrc: [
    'https://securepayments.fortebank.com',
    'https://gateway.fortebank.com',
    'https://*.fortebank.com',
  ],
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
    ['/internal', '/api', '/admin/api', '/webhooks', '/.well-known'].some(
      (prefix) => requestPath === prefix || requestPath.startsWith(`${prefix}/`),
    )
  );
}

function directivesForPath(requestPath, nonce) {
  const normalizedPath = normalizePolicyPath(requestPath);
  if (isApiPath(normalizedPath)) return apiPolicy;
  if (normalizedPath === '/maps/yandex') return mapPolicy(nonce);
  if (normalizedPath === '/payments/forte-widget') return forteWidgetPolicy;
  if (legalPagePaths.has(normalizedPath)) return legalPagePolicy;
  if (staticDocumentPolicies.has(normalizedPath)) {
    return staticDocumentPolicies.get(normalizedPath);
  }
  if (normalizedPath.startsWith('/payment-receipts/')) return receiptPolicy;
  if (normalizedPath.startsWith('/wallet/')) return walletPolicy;
  if (normalizedPath.startsWith('/tilda-copy-bot')) {
    return isolatedLegacyPolicy;
  }
  if (normalizedPath === '/admin' || normalizedPath.startsWith('/admin/')) return adminPolicy;
  return appPolicy;
}

function normalizePolicyPath(requestPath) {
  const rawPath = String(requestPath || '/');
  const suffixIndex = rawPath.search(/[?#]/);
  const pathname = (suffixIndex >= 0 ? rawPath.slice(0, suffixIndex) : rawPath) || '/';

  // Express' default route matching accepts one optional trailing slash. CSP
  // selection must mirror that behavior, while deliberately leaving doubled
  // slashes and encoded path separators unmatched.
  return pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname;
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
  normalizePolicyPath,
  serializePolicy,
};

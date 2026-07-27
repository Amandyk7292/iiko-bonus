const express = require('express');
const crypto = require('node:crypto');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const compression = require('compression');
const { validateRuntimeConfig } = require('./config/env');
const { logger } = require('./config/logger');

const adminRoutes = require('./routes/admin.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const walletRoutes = require('./routes/wallet.routes');
const publicRoutes = require('./routes/public.routes');
const legacyRoutes = require('./routes/legacy.routes');
const yandexMapRoutes = require('./routes/yandex-map.routes');
const { globalApiRateLimit, siteRateLimit } = require('./middlewares/rate-limit.middleware');
const { siteAccessMiddleware } = require('./middlewares/site-access.middleware');
const { tildaCopyProxy } = require('./middlewares/tilda-copy-proxy.middleware');
const { webApplicationFirewall } = require('./middlewares/web-application-firewall.middleware');
const {
  contentSecurityPolicyMiddleware,
} = require('./middlewares/content-security-policy.middleware');
const {
  requestContextMiddleware,
  requestLoggingMiddleware,
  renderPrometheusMetrics,
  safeErrorResponseMiddleware,
} = require('./middlewares/observability.middleware');
const { readinessSnapshot, renderWorkerMetrics } = require('./services/operational-health.service');
const {
  getPaymentReceipt,
  normalizeReceiptLanguage,
  renderPaymentReceipt,
  verifyReceiptSignature,
} = require('./services/payment-receipt.service');
const {
  paymentReceiptParamsSchema,
  paymentReceiptQuerySchema,
} = require('./contracts/payment-receipt.contract');
const { LEGAL_PAGE_SLUGS, renderLegalPage } = require('./services/legal-page.service');
const {
  adminAuditMiddleware,
  adminAuthMiddleware,
  adminCsrfMiddleware,
  adminMutationRoleMiddleware,
} = require('./middlewares/auth.middleware');
const { requestBodySafetyMiddleware } = require('./middlewares/validation.middleware');

const app = express();
validateRuntimeConfig();

app.set('trust proxy', 1);
app.use(requestContextMiddleware);
app.use(safeErrorResponseMiddleware);
app.use(requestLoggingMiddleware);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: { policy: 'credentialless' },
  }),
);
app.use(contentSecurityPolicyMiddleware);

// Block high-confidence attack probes before request bodies, authentication or
// SPA fallbacks are evaluated, and rate-limit all HTTP traffic per client IP.
app.use(webApplicationFirewall);
app.use(siteRateLimit);

// Publish the isolated Tilda helper through the existing HTTPS virtual host.
// Register it before application CORS/auth/SPA middleware.
app.use('/tilda-copy-bot', tildaCopyProxy);

// Never let SPA fallbacks turn probes for secret dotfiles into a successful
// HTML response. The ACME path stays available for certificate renewal.
app.use((req, res, next) => {
  const segments = req.path.split('/').filter(Boolean);
  const hasBlockedDotfile = segments.some(
    (segment, index) => segment.startsWith('.') && !(index === 0 && segment === '.well-known'),
  );
  if (hasBlockedDotfile) return res.status(404).end();
  return next();
});

const configuredOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
const publicOrigin = (() => {
  try {
    return process.env.PUBLIC_BASE_URL ? new URL(process.env.PUBLIC_BASE_URL).origin : null;
  } catch {
    return null;
  }
})();
const allowedOrigins = new Set([...configuredOrigins, publicOrigin].filter(Boolean));
const allowLocalOrigins = process.env.NODE_ENV !== 'production';
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        (allowLocalOrigins && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed'));
    },
    credentials: true,
  }),
);

app.use('/api', globalApiRateLimit);
app.use(compression());
app.use(
  express.json({
    limit: '2mb',
    verify(req, _res, buffer) {
      if (req.originalUrl.split('?')[0] === '/webhooks/kaspi') {
        req.rawBody = Buffer.from(buffer);
      }
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(requestBodySafetyMiddleware);

app.locals.kaspiReady = process.env.KASPI_POS_ENABLED !== 'true';
let embeddedKaspiApp = null;
const sendLiveness = (_req, res) =>
  res
    .status(200)
    .set('Cache-Control', 'no-store')
    .json({ status: 'ok', uptimeSeconds: Math.floor(process.uptime()) });
app.get('/livez', sendLiveness);
app.get('/healthz', (_req, res) =>
  res.status(200).set('Cache-Control', 'no-store').json({ status: 'ok' }),
);
const requireOperationalBearer = (req, res, next) => {
  const expected = String(process.env.METRICS_BEARER_TOKEN || '');
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!expected) return res.status(404).end();
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  const authorized =
    suppliedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(suppliedBuffer, expectedBuffer);
  if (!authorized) {
    res.set('WWW-Authenticate', 'Bearer');
    return res.status(401).json({ error: 'Unauthorized', code: 'OPERATIONAL_AUTH_REQUIRED' });
  }
  return next();
};
app.get('/readyz', async (_req, res, next) => {
  try {
    const readiness = await readinessSnapshot({ kaspiReady: app.locals.kaspiReady });
    return res
      .status(readiness.ok ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({ status: readiness.ok ? 'ready' : 'not_ready' });
  } catch (error) {
    return next(error);
  }
});
app.get('/internal/readiness', requireOperationalBearer, async (_req, res, next) => {
  try {
    const readiness = await readinessSnapshot({ kaspiReady: app.locals.kaspiReady });
    return res
      .status(readiness.ok ? 200 : 503)
      .set('Cache-Control', 'no-store')
      .json({ status: readiness.ok ? 'ready' : 'not_ready', ...readiness });
  } catch (error) {
    return next(error);
  }
});
app.get('/internal/metrics', requireOperationalBearer, (_req, res) => {
  return res
    .status(200)
    .set({ 'Cache-Control': 'no-store', 'Content-Type': 'text/plain; version=0.0.4' })
    .send(`${renderPrometheusMetrics()}${renderWorkerMetrics()}`);
});

app.get('/.well-known/apple-app-site-association', (_req, res) => {
  const teamId = String(process.env.APPLE_TEAM_ID || 'GKRRT4JU9G').trim();
  const bundleId = String(process.env.APPLE_BUNDLE_ID || 'com.bulka.bonus').trim();
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json({
    applinks: {
      apps: [],
      details: teamId ? [{ appID: `${teamId}.${bundleId}`, paths: ['/orders', '/orders/*'] }] : [],
    },
  });
});

app.get('/.well-known/assetlinks.json', (_req, res) => {
  const fingerprints = String(process.env.ANDROID_APP_SHA256_CERT_FINGERPRINTS || '')
    .split(',')
    .map((value) => value.trim().toUpperCase())
    .filter((value) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(value));
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.json(
    fingerprints.length
      ? [
          {
            relation: ['delegate_permission/common.handle_all_urls'],
            target: {
              namespace: 'android_app',
              package_name: 'com.bulka.bonus',
              sha256_cert_fingerprints: fingerprints,
            },
          },
        ]
      : [],
  );
});

// Restrict the public web experience without interrupting the admin panel,
// mobile API, health checks or machine-to-machine integrations.
app.use(siteAccessMiddleware);

app.get('/robots.txt', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('text/plain').sendFile(path.join(process.cwd(), 'public', 'robots.txt'));
});

app.get('/sitemap.xml', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.type('application/xml').sendFile(path.join(process.cwd(), 'public', 'sitemap.xml'));
});

const adminStaticHeaders = (res, filePath) => {
  if (/index\.html$|flutter_service_worker\.js$/.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
};

const kaspiAdminStaticHeaders = (res, filePath) => {
  if (/index\.html$|app\.js$/.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
};

const appStaticHeaders = (res, filePath) => {
  if (
    /index\.html$|flutter_bootstrap\.js$|flutter_service_worker\.js$|firebase-messaging-sw\.js$|main\.dart\.(?:js|mjs|wasm)$|manifest\.json$/.test(
      filePath,
    )
  ) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
};

// API routes must be registered before the SPA fallbacks below. Otherwise
// GET /admin/api/* is swallowed by /admin/* and returns index.html with 200.
app.use(adminRoutes);
app.use(loyaltyRoutes);
app.use(walletRoutes);
app.use(publicRoutes);
app.use(yandexMapRoutes);
app.use(legacyRoutes);

const requireEmbeddedKaspi = (req, res, next) => {
  if (!embeddedKaspiApp) {
    return res.status(503).json({
      error: 'Kaspi Pay модуль ещё не готов.',
      code: 'KASPI_MODULE_UNAVAILABLE',
      retryable: true,
    });
  }
  return embeddedKaspiApp(req, res, next);
};

const requireKaspiAdminRole = (req, res, next) => {
  if (req.admin?.role === 'admin') return next();
  return res.status(403).json({ error: 'Kaspi Pay доступен только администратору' });
};

// Internal checkout integration. The embedded app independently verifies the
// bearer secret supplied by kaspi.service.js.
app.use('/kaspi-pos', requireEmbeddedKaspi);

// Protected Kaspi reconnection console inside the existing admin session.
// Browser requests never receive the internal bearer secret.
app.use(
  '/admin/kaspi-pos',
  adminAuthMiddleware,
  requireKaspiAdminRole,
  express.static(path.join(process.cwd(), 'kaspi-pos-automation-main/public'), {
    setHeaders: kaspiAdminStaticHeaders,
  }),
);
app.use(
  '/admin/kaspi-pos',
  adminAuthMiddleware,
  requireKaspiAdminRole,
  adminCsrfMiddleware,
  adminMutationRoleMiddleware,
  adminAuditMiddleware,
  (req, _res, next) => {
    req.headers.authorization = `Bearer ${String(process.env.KASPI_INTERNAL_SECRET || '')}`;
    next();
  },
  requireEmbeddedKaspi,
);

app.use(
  '/admin',
  express.static(path.join(process.cwd(), 'admin-ui/dist'), { setHeaders: adminStaticHeaders }),
);
app.use('/admin/assets', (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.status(404).type('text/plain').send('Admin asset not found');
});
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'admin-ui/dist', 'index.html'));
});

// Serve Flutter Web App
app.use(
  '/app',
  express.static(path.join(process.cwd(), 'public/app'), { setHeaders: appStaticHeaders }),
);
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'public/app', 'index.html'));
});

const sendLegalPage = (slug, language) => (_req, res) => {
  const html = renderLegalPage(slug, language);
  if (!html) return res.status(404).end();
  res.set({
    'Cache-Control': 'no-cache, must-revalidate',
    'Content-Language': language,
  });
  return res.type('html').send(html);
};

for (const slug of LEGAL_PAGE_SLUGS) {
  app.get([`/${slug}`, `/${slug}/`], sendLegalPage(slug, 'ru'));
  app.get([`/kk/${slug}`, `/kk/${slug}/`], sendLegalPage(slug, 'kk'));
  app.get([`/en/${slug}`, `/en/${slug}/`], sendLegalPage(slug, 'en'));
}

app.get('/assets/legal/legal.css', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('text/css').sendFile(path.join(process.cwd(), 'public/legal/legal.css'));
});
app.get('/assets/legal/payment-receipt.css', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.type('text/css').sendFile(path.join(process.cwd(), 'public/legal/payment-receipt.css'));
});
app.get('/assets/legal/payment-receipt.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res
    .type('application/javascript')
    .sendFile(path.join(process.cwd(), 'public/legal/payment-receipt.js'));
});
app.get('/assets/legal/account-deletion.js', (_req, res) => {
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res
    .type('application/javascript')
    .sendFile(path.join(process.cwd(), 'public/legal/account-deletion.js'));
});
app.get('/payment-receipts/:receiptId', async (req, res, next) => {
  try {
    const language = normalizeReceiptLanguage(req.query.lang);
    const errors = {
      ru: { invalid: 'Ссылка на чек недействительна', missing: 'Чек не найден' },
      kk: { invalid: 'Чек сілтемесі жарамсыз', missing: 'Чек табылмады' },
      en: { invalid: 'The receipt link is invalid', missing: 'Receipt not found' },
    }[language];
    res.set({
      'Cache-Control': 'private, no-store',
      'Content-Language': language,
      'Referrer-Policy': 'no-referrer',
      'X-Robots-Tag': 'noindex, nofollow, noarchive',
    });
    const validatedParams = paymentReceiptParamsSchema.safeParse(req.params);
    const validatedQuery = paymentReceiptQuerySchema.safeParse(req.query);
    if (!validatedParams.success || !validatedQuery.success) {
      return res.status(403).type('text/plain').send(errors.invalid);
    }
    const { receiptId } = validatedParams.data;
    const { token, expires, lang } = validatedQuery.data;
    if (!verifyReceiptSignature(receiptId, token, expires, process.env)) {
      return res.status(403).type('text/plain').send(errors.invalid);
    }
    const receipt = await getPaymentReceipt(receiptId);
    if (!receipt) return res.status(404).type('text/plain').send(errors.missing);
    const receiptLanguage = normalizeReceiptLanguage(lang || receipt.language);
    res.setHeader('Content-Language', receiptLanguage);
    res.set({
      'Content-Disposition': `inline; filename="bulka-receipt-${receipt.order_number}.html"`,
    });
    return res.type('html').send(
      renderPaymentReceipt(receipt, receiptLanguage, {
        token,
        expiresAt: expires,
      }),
    );
  } catch (error) {
    return next(error);
  }
});
for (const [route, language, filename] of [
  ['/account-deletion', 'ru', 'account-deletion.html'],
  ['/kk/account-deletion', 'kk', 'account-deletion.kk.html'],
  ['/en/account-deletion', 'en', 'account-deletion.en.html'],
]) {
  app.get([route, `${route}/`], (_req, res) => {
    res.set({
      'Cache-Control': 'no-cache, must-revalidate',
      'Content-Language': language,
    });
    res.sendFile(path.join(process.cwd(), 'public/legal', filename));
  });
}
app.get('/courier', (_req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(process.cwd(), 'public/courier.html'));
});

// Serve the Flutter build at the domain root as the canonical web app.
// Explicit API, admin, wallet and legacy routes are registered above, so
// only Flutter assets fall through to this static middleware.
app.use(express.static(path.join(process.cwd(), 'public/app'), { setHeaders: appStaticHeaders }));
app.get(
  ['/orders', '/orders/*', '/catalog', '/catalog/*', '/cart', '/promos', '/profile'],
  (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(path.join(process.cwd(), 'public/app', 'index.html'));
  },
);

// Error handling middleware
app.use((err, req, res, _next) => {
  const statusCode = Number(err.statusCode) >= 400 ? Number(err.statusCode) : 500;
  req.log?.error(
    {
      err,
      event: 'unhandled_request_error',
      method: req.method,
      path: req.path,
      statusCode,
      errorCode: err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
    },
    'Unhandled request error',
  );
  const response = {
    error:
      statusCode >= 500
        ? 'Internal Server Error'
        : err.expose === false
          ? 'Request failed'
          : err.message || 'Request failed',
    code: err.code || (statusCode >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'),
    requestId: req.id,
  };
  if (statusCode < 500 && Array.isArray(err.fields)) response.fields = err.fields;
  res.status(statusCode).json(response);
});

if (process.env.NODE_ENV !== 'test' && process.env.KASPI_POS_ENABLED === 'true') {
  process.env.KASPI_MOUNTED = 'true';
  (async () => {
    try {
      const kaspiModule = await import('../kaspi-pos-automation-main/server.js');
      embeddedKaspiApp = kaspiModule.kaspiApp;
      kaspiModule.startPolling();
      app.locals.kaspiReady = true;
      logger.info({ event: 'kaspi_module_mounted' }, 'Kaspi POS Automation mounted');
    } catch (err) {
      app.locals.kaspiReady = false;
      logger.error({ err, event: 'kaspi_module_mount_failed' }, 'Failed to mount Kaspi module');
    }
  })();
}

module.exports = app;

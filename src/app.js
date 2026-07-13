const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');
const { validateRuntimeConfig } = require('./config/env');

const adminRoutes = require('./routes/admin.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const walletRoutes = require('./routes/wallet.routes');
const publicRoutes = require('./routes/public.routes');
const legacyRoutes = require('./routes/legacy.routes');
const { globalApiRateLimit } = require('./middlewares/rate-limit.middleware');

const app = express();
validateRuntimeConfig();
const isProduction =
  process.env.NODE_ENV === 'production' || Boolean(process.env.RENDER || process.env.VERCEL);

app.set('trust proxy', 1);

// Security headers
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "'unsafe-eval'",
          "'wasm-unsafe-eval'",
          'https://cdn.tailwindcss.com',
          'https://www.gstatic.com',
        ],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
        connectSrc: ["'self'", 'https:', 'http:', 'ws:', 'wss:'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com', 'https://fonts.googleapis.com'],
        objectSrc: ["'none'"],
        workerSrc: ["'self'", 'blob:'],
        childSrc: ["'self'", 'blob:'],
        baseUri: ["'self'"],
        frameAncestors: ["'self'"],
        scriptSrcAttr: ["'unsafe-inline'"],
      },
    },
    crossOriginEmbedderPolicy: { policy: 'credentialless' },
  }),
);

// Request logging
app.use(
  morgan(isProduction ? 'combined' : 'dev', {
    skip: (req) =>
      req.path.startsWith('/wallet/') ||
      req.path.startsWith('/api/wallet/download/') ||
      req.path.startsWith('/api/wallet/google/download/'),
  }),
);

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
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.has(origin) ||
        /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
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
      if (req.originalUrl === '/webhooks/kaspi') req.rawBody = Buffer.from(buffer);
    },
  }),
);
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.locals.kaspiReady = process.env.KASPI_POS_ENABLED !== 'true';
app.get('/healthz', (_req, res) => {
  if (process.env.NODE_ENV !== 'test' && !app.locals.kaspiReady) {
    return res.status(503).json({ status: 'degraded', dependency: 'kaspi-pos' });
  }
  res.status(200).json({ status: 'ok' });
});

const adminStaticHeaders = (res, filePath) => {
  if (/index\.html$|flutter_service_worker\.js$/.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
};

const appStaticHeaders = (res, filePath) => {
  if (/index\.html$|flutter_service_worker\.js$/.test(filePath)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  } else {
    res.setHeader('Cache-Control', 'public, max-age=3600, must-revalidate');
  }
};

app.use(
  '/admin',
  express.static(path.join(process.cwd(), 'admin-ui/dist'), { setHeaders: adminStaticHeaders }),
);
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

app.use(adminRoutes);
app.use(loyaltyRoutes);
app.use(walletRoutes);
app.use(publicRoutes);
app.use(legacyRoutes);

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error(err.stack);
  const response = { error: 'Internal Server Error' };
  if (!isProduction) response.details = err.message;
  res.status(err.statusCode || 500).json(response);
});

if (process.env.NODE_ENV !== 'test' && process.env.KASPI_POS_ENABLED === 'true') {
  process.env.KASPI_MOUNTED = 'true';
  (async () => {
    try {
      const kaspiModule = await import('../kaspi-pos-automation-main/server.js');
      app.use('/kaspi-pos', kaspiModule.kaspiApp);
      kaspiModule.startPolling();
      app.locals.kaspiReady = true;
      console.log('✅ Kaspi POS Automation mounted at /kaspi-pos');
    } catch (err) {
      app.locals.kaspiReady = false;
      console.error('❌ Failed to mount Kaspi POS Automation:', err.message);
    }
  })();
}

module.exports = app;

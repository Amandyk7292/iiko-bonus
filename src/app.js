const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');
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
        scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.tailwindcss.com'],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        connectSrc: ["'self'", 'https://api.mymemory.translated.net'],
        fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
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

const allowedOrigins = String(process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);
app.use(
  cors({
    origin(origin, callback) {
      if (
        !origin ||
        allowedOrigins.includes(origin) ||
        (!isProduction && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))
      ) {
        return callback(null, true);
      }
      return callback(new Error('Origin is not allowed'));
    },
    credentials: false,
  }),
);

app.use('/api', globalApiRateLimit);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

app.use(adminRoutes);
app.use(loyaltyRoutes);
app.use(walletRoutes);
app.use(publicRoutes);
app.use(legacyRoutes);

app.use('/admin', express.static(path.join(process.cwd(), 'admin-ui/dist')));
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'admin-ui/dist', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, _next) => {
  console.error(err.stack);
  const response = { error: 'Internal Server Error' };
  if (!isProduction) response.details = err.message;
  res.status(err.statusCode || 500).json(response);
});

module.exports = app;

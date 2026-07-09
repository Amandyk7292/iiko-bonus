const express = require('express');
const cors = require('cors');
const path = require('path');
const helmet = require('helmet');
const morgan = require('morgan');

const adminRoutes = require('./routes/admin.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const walletRoutes = require('./routes/wallet.routes');
const publicRoutes = require('./routes/public.routes');

const app = express();

app.set('trust proxy', 1);

// Security headers
app.use(helmet({
  contentSecurityPolicy: false, // Disabling CSP temporarily to avoid breaking existing inline scripts/styles in app.html/admin.html
  crossOriginEmbedderPolicy: false
}));

// Request logging
app.use(morgan('dev'));

app.use(cors({
  origin(origin, callback) {
    callback(null, true);
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use(adminRoutes);
app.use(loyaltyRoutes);
app.use(walletRoutes);
app.use(publicRoutes);

app.use('/admin', express.static(path.join(process.cwd(), 'admin-ui/dist')));
app.get('/admin/*', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'admin-ui/dist', 'index.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Internal Server Error', details: err.message });
});

module.exports = app;

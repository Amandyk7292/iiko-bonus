import express from 'express';
import path from 'path';
import { PORT, ROOT_DIR } from './src/config.js';
import authRoutes from './src/routes/auth.js';
import invoiceRoutes from './src/routes/invoice.js';
import qrRoutes from './src/routes/qr.js';
import historyRoutes from './src/routes/history.js';
import refundRoutes from './src/routes/refund.js';
import sessionRoutes from './src/routes/session.js';
import { startPolling } from './src/polling.js';
import 'dotenv/config';

const app = express();

app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public')));

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/auth', authRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/refund', refundRoutes);
app.use('/api/session', sessionRoutes);

// Public endpoint — no Kaspi auth required. Returns payment status from in-memory tracker.
import { getTrackedPayments } from './src/polling.js';
app.get('/api/payment/status/:id', (req, res) => {
  const allTracked = getTrackedPayments();
  const entry = allTracked[req.params.id];
  if (!entry) {
    // Payment not tracked (already resolved or never existed)
    return res.json({ found: false, status: 'unknown' });
  }
  res.json({ found: true, status: entry.status, type: entry.type });
});

if (!process.env.KASPI_MOUNTED) {
  app.listen(PORT, () => {
    console.log(`\n  🟢 Kaspi Pay App running at http://localhost:${PORT}\n`);
    startPolling();
  });
}

export const kaspiApp = app;
export { startPolling };

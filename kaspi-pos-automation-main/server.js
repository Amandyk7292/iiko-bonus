import express from 'express';
import path from 'path';
import fetch from 'node-fetch';
import { PORT, ROOT_DIR, KASPI_QRPAY_URL } from './src/config.js';
import authRoutes from './src/routes/auth.js';
import invoiceRoutes from './src/routes/invoice.js';
import qrRoutes from './src/routes/qr.js';
import historyRoutes from './src/routes/history.js';
import refundRoutes from './src/routes/refund.js';
import sessionRoutes from './src/routes/session.js';
import { startPolling } from './src/polling.js';
import { getGlobalSession } from './src/sessionStorage.js';
import { decryptSecret } from './src/crypto.js';
import { signedQrPayHeaders } from './src/helpers.js';
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

// ─── Public endpoint: direct Kaspi API status check (no auth from caller) ───
app.get('/api/payment/check/:id', async (req, res) => {
  try {
    const globalSession = getGlobalSession();
    if (!globalSession) {
      return res.json({ success: false, error: 'no_session', kaspiStatus: null });
    }

    let decrypted;
    try {
      decrypted = decryptSecret(globalSession.vtokenSecret);
    } catch {
      return res.json({ success: false, error: 'decrypt_failed', kaspiStatus: null });
    }

    const session = {
      tokenSN: globalSession.tokenSN,
      decryptedSecret: decrypted,
      profileId: globalSession.profileId,
    };

    // Try multiple Kaspi endpoints to find payment status
    const endpoints = [
      `${KASPI_QRPAY_URL}/v02/remote/details?operationId=${req.params.id}`,
      `${KASPI_QRPAY_URL}/v01/remote/details?operationId=${req.params.id}`,
      `${KASPI_QRPAY_URL}/v01/remote/details?qrOperationId=${req.params.id}`,
      `${KASPI_QRPAY_URL}/v02/kaspi-qr/status?qrOperationId=${req.params.id}`,
    ];

    for (const url of endpoints) {
      try {
        const headers = signedQrPayHeaders(url, session);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        const resp = await fetch(url, { headers, signal: controller.signal });
        clearTimeout(timer);

        const json = await resp.json();
        const status = json?.Data?.Status || null;

        console.log(`[payment/check] ${req.params.id} → ${url.split('qrpay.kaspi.kz')[1]} → status: ${status}, code: ${json?.StatusCode}`);

        if (status) {
          return res.json({ success: true, kaspiStatus: status, raw: json });
        }
        // StatusCode 0 with no Status means endpoint worked but maybe different format
        if (json?.StatusCode === 0 && json?.Data) {
          return res.json({ success: true, kaspiStatus: json.Data.Status || 'unknown', raw: json });
        }
      } catch (err) {
        console.log(`[payment/check] ${url.split('qrpay.kaspi.kz')[1]} failed: ${err.message}`);
      }
    }

    console.log(`[payment/check] ${req.params.id} → all endpoints failed`);
  } catch (err) {
    console.error(`[payment/check] Error for ${req.params.id}:`, err.message);
    res.json({ success: false, error: err.message, kaspiStatus: null });
  }
});

if (!process.env.KASPI_MOUNTED) {
  app.listen(PORT, () => {
    console.log(`\n  🟢 Kaspi Pay App running at http://localhost:${PORT}\n`);
    startPolling();
  });
}

export const kaspiApp = app;
export { startPolling };

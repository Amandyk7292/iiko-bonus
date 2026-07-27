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
import { clearGlobalSession, getGlobalSession } from './src/sessionStorage.js';
import { decryptSecret } from './src/crypto.js';
import { signedQrPayHeaders } from './src/helpers.js';
import { requireInternalApi } from './src/internalAuth.js';
import { clearActiveSession, inactiveSessionResponse } from './src/activeSession.js';
import { isKaspiSessionExpired } from './src/kaspiResponse.js';
import 'dotenv/config';

const app = express();

app.use(express.json());
if (!process.env.KASPI_MOUNTED && process.env.NODE_ENV !== 'production') {
  app.use(express.static(path.join(ROOT_DIR, 'public')));
}

app.get('/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api', requireInternalApi);
app.use('/api/auth', authRoutes);
app.use('/api/invoice', invoiceRoutes);
app.use('/api/qr', qrRoutes);
app.use('/api/history', historyRoutes);
app.use('/api/refund', refundRoutes);
app.use('/api/session', sessionRoutes);

app.get('/api/payment/availability', (_req, res) => {
  res.json({ success: true, available: Boolean(getGlobalSession()) });
});

app.get('/api/payment/check/:id', async (req, res) => {
  try {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(String(req.params.id || ''))) {
      return res.status(400).json({ success: false, error: 'invalid_operation_id' });
    }
    const globalSession = getGlobalSession();
    if (!globalSession) {
      return res.status(401).json({ success: false, ...inactiveSessionResponse(), kaspiStatus: null });
    }

    let decrypted;
    try {
      decrypted = decryptSecret(globalSession.vtokenSecret);
    } catch {
      clearActiveSession(globalSession.tokenSN);
      clearGlobalSession('kaspi_session_decrypt_failed', globalSession);
      return res.status(401).json({ success: false, ...inactiveSessionResponse(), kaspiStatus: null });
    }

    const session = {
      tokenSN: globalSession.tokenSN,
      decryptedSecret: decrypted,
      profileId: globalSession.profileId,
    };

    // Try multiple Kaspi endpoints to find payment status
    const endpoints = [
      `${KASPI_QRPAY_URL}/v01/remote/details?qrOperationId=${req.params.id}`,
      `${KASPI_QRPAY_URL}/v02/kaspi-qr/status?qrOperationId=${req.params.id}`,
    ];

    for (const url of endpoints) {
      try {
        const headers = signedQrPayHeaders(url, session);
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 8000);
        let resp;
        try {
          resp = await fetch(url, { headers, signal: controller.signal });
        } finally {
          clearTimeout(timer);
        }

        const json = await resp.json().catch(() => ({}));
        if (isKaspiSessionExpired(json)) {
          clearActiveSession(globalSession.tokenSN);
          clearGlobalSession('kaspi_session_expired', globalSession);
          return res
            .status(401)
            .json({ success: false, ...inactiveSessionResponse(), kaspiStatus: null });
        }
        const status = json?.Data?.Status || null;

        console.log(
          `[payment/check] ${req.params.id} → ${url.split('qrpay.kaspi.kz')[1]} → status: ${status}, code: ${json?.StatusCode}`,
        );

        if (status) {
          return res.json({ success: true, kaspiStatus: status });
        }
        // StatusCode 0 with no Status means endpoint worked but maybe different format
        if (json?.StatusCode === 0 && json?.Data) {
          return res.json({ success: true, kaspiStatus: json.Data.Status || 'unknown' });
        }
      } catch (err) {
        console.log(`[payment/check] ${url.split('qrpay.kaspi.kz')[1]} failed: ${err.message}`);
      }
    }

    console.log(`[payment/check] ${req.params.id} → all endpoints failed`);
    res.json({ success: true, kaspiStatus: null, error: 'not_found_in_any_endpoint' });
  } catch (err) {
    console.error(`[payment/check] Error for ${req.params.id}:`, err.message);
    res.json({ success: false, error: err.message, kaspiStatus: null });
  }
});

if (!process.env.KASPI_MOUNTED) {
  app.listen(PORT, () => {
    console.log(`\n Kaspi Pay App running at http://localhost:${PORT}\n`);
    startPolling();
  });
}

export const kaspiApp = app;
export { startPolling };
